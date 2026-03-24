"""
pipeline_diagonal.py — Pipeline H & I : détection murs diagonaux
=================================================================

Stratégie simplifiée :
  1. Portes/fenêtres  → modèle principal (même que A), 2 passes
  2. Murs             → wall-detection-xi9ox/1 (même que prod D/G), 2 passes
                        masque utilisé DIRECTEMENT sans post-traitement
  3. Empreinte        → _compute_footprint_diagonal (kernel elliptique)
                        FIX: kernel rectangulaire standard ne ferme pas
                        les coins diagonaux → brèches → floodFill déborde
  4. Surface          → calcul standard
  5. Pièces           → segment_rooms_diagonal (kernel elliptique adaptatif)
                        FIX: double dilatation 5×5 cross+ellipse trop agressive
                        → couloirs/SDB entièrement bouchés → 0 pièce
  6. Stats diagonales → Hough sur le masque IA, pour info/overlay uniquement
                        (ne modifie PAS le masque murs)

Pipeline I (spécifique) :
  - Murs OTSU (_detect_walls_pixel) : pas de biais H/V, aucune IA
  - Portes/fenêtres : modèle A (IA)
  - Empreinte : _rebuild_walls_for_footprint (Hough maxLineGap ~80 cm)
                puis _compute_footprint_diagonal
                FIX: les murs OTSU ont des brèches aux portes → flood fill
                déborde sur plan diagonal.  Le Hough ponte les brèches SANS
                détecter explicitement les ouvertures.  Utilisé UNIQUEMENT
                pour l'empreinte, m_walls original intact pour les pièces.

Ce module est importé par pipeline.py et exécuté uniquement en mode admin
via la route /compare (pipeline_id="H").

CHANGELOG
---------
- _compute_footprint_diagonal : kernel MORPH_ELLIPSE au lieu de MORPH_RECT,
  iterations adaptatives selon densité murs, fallback convex hull
- segment_rooms_diagonal : taille kernel adaptée au ppm, une seule passe
  de dilatation elliptique, seuil surface min abaissé pour petites pièces
- logging amélioré pour diagnostiquer les plans sans empreinte
- _rebuild_walls_for_footprint (Pipeline I) : Hough maxLineGap ~80 cm pour
  reconstituer les lignes de murs et ponte les brèches (portes/fenêtres)
  avant le calcul d'empreinte — masque m_walls original conservé intact
"""

import math
import logging
import numpy as np
import cv2

logger = logging.getLogger(__name__)

MODEL_H_WALLS = "wall-detection-xi9ox/1"
MODEL_J_WALLS = "architecture-plan/wall-detection-qpxun/2"  # modèle test universe


# ============================================================
# FOOTPRINT DIAGONAL — kernel elliptique pour fermer les coins obliques
# ============================================================

def _compute_footprint_diagonal(walls: np.ndarray, m_doors: np.ndarray,
                                 m_windows: np.ndarray, H: int, W: int):
    """Calcule l'empreinte du bâtiment en gérant les murs diagonaux."""
    try:
        walls_density = cv2.countNonZero(walls) / max(H * W, 1)

        if walls_density < 0.03:
            k_size = 19
            iterations = 4
        elif walls_density < 0.07:
            k_size = 13
            iterations = 3
        else:
            k_size = 9
            iterations = 2

        walls_for_outline = cv2.bitwise_or(walls, cv2.bitwise_or(m_doors, m_windows))

        kernel_e = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))
        closed = cv2.morphologyEx(walls_for_outline, cv2.MORPH_CLOSE, kernel_e,
                                   iterations=iterations)

        k_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        closed = cv2.dilate(closed, k_small, iterations=1)

        inv = cv2.bitwise_not(closed)
        flood = np.zeros((H + 2, W + 2), np.uint8)
        cv2.floodFill(inv, flood, (0, 0), 255)
        filled = cv2.bitwise_not(inv)

        cnts, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if cnts:
            cnt = max(cnts, key=cv2.contourArea)
            area_ratio = cv2.contourArea(cnt) / (H * W)
            if area_ratio > 0.01:
                logger.info("[H-fp] Empreinte OK : k=%d iter=%d area=%.1f%%",
                            k_size, iterations, area_ratio * 100)
                return cnt, filled

        logger.warning("[H-fp] floodFill a échoué (k=%d iter=%d) → fallback convex hull",
                       k_size, iterations)
        pts = cv2.findNonZero(walls_for_outline)
        if pts is not None and len(pts) >= 4:
            hull = cv2.convexHull(pts)
            hull_mask = np.zeros((H, W), np.uint8)
            cv2.fillPoly(hull_mask, [hull], 255)
            cnts_h, _ = cv2.findContours(hull_mask, cv2.RETR_EXTERNAL,
                                          cv2.CHAIN_APPROX_SIMPLE)
            if cnts_h:
                cnt_h = max(cnts_h, key=cv2.contourArea)
                logger.info("[H-fp] Convex hull : %d pts, area=%.1f%%",
                            len(hull), cv2.contourArea(cnt_h) / (H * W) * 100)
                return cnt_h, hull_mask

    except Exception as e:
        logger.warning("[H-fp] Erreur empreinte : %s", e)

    return None, None


# ============================================================
# HOUGH STATS — lecture seule, ne modifie pas le masque murs
# ============================================================

def _hough_stats(walls_mask: np.ndarray, H: int, W: int) -> tuple:
    """Extrait les segments Hough pour les stats et l'overlay diagonal."""
    if cv2.countNonZero(walls_mask) == 0:
        return [], [], [], []

    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    mask_d = cv2.dilate(walls_mask, k, iterations=1)

    lines = cv2.HoughLinesP(
        mask_d, rho=1, theta=np.pi / 180,
        threshold=20, minLineLength=15, maxLineGap=8,
    )

    all_segs, diag_segs, h_segs, v_segs = [], [], [], []
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = map(int, line[0])
            length_px = float(np.hypot(x2 - x1, y2 - y1))
            angle_deg = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180

            is_h = angle_deg < 15 or angle_deg > 165
            is_v = 75 < angle_deg < 105
            is_d = not (is_h or is_v)

            seg = {
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "x1_norm": round(x1 / W, 4), "y1_norm": round(y1 / H, 4),
                "x2_norm": round(x2 / W, 4), "y2_norm": round(y2 / H, 4),
                "length_px": length_px,
                "angle_deg": round(angle_deg, 1),
                "is_horizontal": is_h,
                "is_vertical": is_v,
                "is_diagonal": is_d,
            }
            all_segs.append(seg)
            if is_d: diag_segs.append(seg)
            elif is_h: h_segs.append(seg)
            else: v_segs.append(seg)

    return all_segs, diag_segs, h_segs, v_segs


# ============================================================
# RECONSTRUCTION MURS POUR EMPREINTE — Hough avec maxLineGap ~80 cm
# ============================================================

def _rebuild_walls_for_footprint(walls_mask: np.ndarray, H: int, W: int,
                                  ppm: float = None) -> np.ndarray:
    """Reconstruit les lignes de murs via HoughLinesP pour fermer l'empreinte."""
    if ppm is not None:
        max_gap = max(30, int(ppm * 0.85))
    else:
        max_gap = max(30, int(min(H, W) * 0.02))

    logger.info("[I-fp-rebuild] maxLineGap=%d px (ppm=%s)", max_gap, ppm)

    k2 = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    src = cv2.dilate(walls_mask, k2, iterations=1)

    lines = cv2.HoughLinesP(src, rho=1, theta=np.pi / 180, threshold=15,
                             minLineLength=12, maxLineGap=max_gap)

    rebuilt = walls_mask.copy()
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = map(int, line[0])
            cv2.line(rebuilt, (x1, y1), (x2, y2), 255, 3)
        logger.info("[I-fp-rebuild] %d segments Hough tracés", len(lines))
    else:
        logger.warning("[I-fp-rebuild] Hough n'a trouvé aucun segment")

    return rebuilt


# ============================================================
# SEGMENTATION PIÈCES ADAPTÉE AUX MURS INCLINÉS
# ============================================================

def segment_rooms_diagonal(walls: np.ndarray, m_doors: np.ndarray,
                            m_windows: np.ndarray, building_cnt,
                            H: int, W: int, ppm) -> list:
    """Segmentation pièces avec kernel elliptique adaptatif."""
    building = np.zeros((H, W), np.uint8)
    if building_cnt is not None:
        cv2.fillPoly(building, [building_cnt], 255)
    else:
        building[:] = 255
        logger.warning("[ROOMS-H] Pas d'empreinte — segmentation sur image entière")

    boundaries = walls.copy()

    if ppm is not None:
        gap_px = max(3, int(round(0.10 * ppm)))
    else:
        gap_px = max(3, int(round(min(H, W) * 0.008)))

    k_size = 2 * gap_px + 1
    k_ellipse = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))
    boundaries_closed = cv2.dilate(boundaries, k_ellipse, iterations=1)

    interior = cv2.subtract(building, boundaries_closed)

    k_clean_size = max(3, gap_px)
    k_clean = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_clean_size, k_clean_size))
    interior = cv2.morphologyEx(interior, cv2.MORPH_OPEN, k_clean, iterations=1)

    walls_px    = cv2.countNonZero(walls)
    interior_px = cv2.countNonZero(interior)
    logger.info("[ROOMS-H] walls_px=%d interior_px=%d gap_px=%d k_size=%d H=%d W=%d ppm=%s",
                walls_px, interior_px, gap_px, k_size, H, W, ppm)

    if interior_px == 0:
        logger.warning("[ROOMS-H] Intérieur vide après soustraction")
        return []

    min_area_px = max(150, int(0.15 * ppm ** 2)) if ppm else 300

    num_labels, labels_map = cv2.connectedComponents(interior, connectivity=8)
    logger.info("[ROOMS-H] composantes=%d min_area_px=%d", num_labels - 1, min_area_px)

    from pipeline import _classify_room_by_area

    rooms_raw = []
    for i in range(1, num_labels):
        mask_i = (labels_map == i).astype(np.uint8) * 255
        area_px = int(cv2.countNonZero(mask_i))
        if area_px < min_area_px:
            continue
        cnts_i, _ = cv2.findContours(mask_i, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts_i:
            continue
        cnt_i = max(cnts_i, key=cv2.contourArea)
        epsilon = 0.001 * cv2.arcLength(cnt_i, True)
        cnt_i = cv2.approxPolyDP(cnt_i, epsilon, True)
        x, y, w, h = cv2.boundingRect(cnt_i)
        cx, cy = float(x + w / 2), float(y + h / 2)
        area_m2 = area_px / (ppm ** 2) if ppm else None
        label, label_fr = _classify_room_by_area(area_m2)
        rooms_raw.append({
            "id": i, "type": label, "label_fr": label_fr,
            "centroid_norm": {"x": round(cx / W, 4), "y": round(cy / H, 4)},
            "bbox_norm": {"x": round(x / W, 4), "y": round(y / H, 4),
                          "w": round(w / W, 4), "h": round(h / H, 4)},
            "area_m2": round(area_m2, 2) if area_m2 else None,
            "area_px2": area_px,
            "_polygon": cnt_i.reshape(-1, 2).tolist(),
            "polygon_norm": [
                {"x": round(float(pt[0]) / W, 5), "y": round(float(pt[1]) / H, 5)}
                for pt in cnt_i.reshape(-1, 2).tolist()
            ],
        })

    rooms_raw.sort(key=lambda r: r["area_px2"], reverse=True)
    logger.info("[ROOMS-H] %d pièces gardées après filtre surface", len(rooms_raw))

    label_counters: dict = {}
    rooms = []
    for r in rooms_raw:
        lbl = r["type"]
        label_counters[lbl] = label_counters.get(lbl, 0) + 1
        n = label_counters[lbl]
        label_fr = {
            "living room": "Séjour" if n == 1 else f"Séjour {n}",
            "bedroom":     "Chambre" if n == 1 else f"Chambre {n}",
            "bathroom":    "Salle de bain" if n == 1 else f"SDB {n}",
            "hallway":     "Couloir" if n == 1 else f"Couloir {n}",
            "kitchen":     "Cuisine" if n == 1 else f"Cuisine {n}",
        }.get(lbl, f"Pièce {n}")
        rooms.append({**r, "label_fr": label_fr})

    return rooms


# ============================================================
# DÉTECTION DIAGONALE PORTES / FENÊTRES — rotation ±45°
# ============================================================

def _infer_diagonal_openings(img_rgb: np.ndarray, img_pil,
                              client, model_id: str,
                              angles: list,
                              conf_min_door: float,
                              conf_min_win: float,
                              cfg: dict) -> tuple:
    """Détecte les portes/fenêtres sur des versions pivotées de l'image."""
    from PIL import Image as PILImage
    import pipeline as pip

    H, W = img_rgb.shape[:2]
    cx, cy = W / 2.0, H / 2.0

    m_doors_total = np.zeros((H, W), np.uint8)
    m_wins_total  = np.zeros((H, W), np.uint8)

    for angle_deg in angles:
        try:
            M       = cv2.getRotationMatrix2D((cx, cy), angle_deg, 1.0)
            rotated = cv2.warpAffine(img_rgb, M, (W, H),
                                     flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_REPLICATE)
            img_pil_rot = PILImage.fromarray(rotated)

            _, _, md_rot, mw_rot, _, _, _ = pip.infer_pass(
                img_pil_rot, client, model_id,
                cfg["pass1_tile"], cfg["pass1_over"],
                write_rooms=False,
                conf_min_door=conf_min_door,
                conf_min_win=conf_min_win,
                cfg=cfg,
            )

            M_inv   = cv2.getRotationMatrix2D((cx, cy), -angle_deg, 1.0)
            md_back = cv2.warpAffine(md_rot, M_inv, (W, H))
            mw_back = cv2.warpAffine(mw_rot, M_inv, (W, H))

            _, md_back = cv2.threshold(md_back, 127, 255, cv2.THRESH_BINARY)
            _, mw_back = cv2.threshold(mw_back, 127, 255, cv2.THRESH_BINARY)

            m_doors_total = cv2.bitwise_or(m_doors_total, md_back)
            m_wins_total  = cv2.bitwise_or(m_wins_total,  mw_back)

            logger.info("[diag-passes] angle=%+d°  doors_px=%d  wins_px=%d",
                        angle_deg, cv2.countNonZero(md_back), cv2.countNonZero(mw_back))

        except Exception as e:
            logger.warning("[diag-passes] angle=%+d° échoué : %s", angle_deg, e)

    return m_doors_total, m_wins_total


# ============================================================
# PIPELINE H
# ============================================================

def run_pipeline_h(img_rgb: np.ndarray, img_pil,
                   client, ppm: float, cfg: dict) -> dict:
    """Pipeline H : murs IA directs + détection portes/fenêtres diagonale."""
    import time
    import pipeline as pip

    t0 = time.time()
    H, W = img_rgb.shape[:2]

    m_doors = m_wins = m_walls = np.zeros((H, W), np.uint8)
    interior_mask = cnt = footprint_mask = None
    footprint_area_m2 = walls_area_m2 = hab_area_m2 = None
    rooms_list = []; error = None
    all_segs = diag_segs = h_segs = v_segs = []
    doors_count = windows_count = 0; diagonal_pct = 0.0
    mask_doors_b64 = mask_windows_b64 = mask_walls_b64 = None
    mask_rooms_b64 = mask_footprint_b64 = mask_hab_b64 = mask_diagonal_b64 = None

    try:
        model_id = cfg.get("model_id", pip.DEFAULT_CONFIG["model_id"])

        _, _, md1, mw1, _, _, _ = pip.infer_pass(img_pil, client, model_id,
            cfg["pass1_tile"], cfg["pass1_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg)
        _, _, md2, mw2, _, _, _ = pip.infer_pass(img_pil, client, model_id,
            cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg)
        m_doors = cv2.bitwise_or(
            pip.clean_mask(md1, cfg["min_area_door_px"], cfg["clean_close_k_door"]),
            pip.clean_mask(md2, cfg["min_area_door_px"], cfg["clean_close_k_door"]))
        m_wins = cv2.bitwise_or(
            pip.clean_mask(mw1, cfg["min_area_win_px"], cfg["clean_close_k_win"]),
            pip.clean_mask(mw2, cfg["min_area_win_px"], cfg["clean_close_k_win"]))

        md_diag, mw_diag = _infer_diagonal_openings(img_rgb, img_pil, client, model_id,
            angles=[-45, 45], conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg)
        if cv2.countNonZero(md_diag) > 0:
            m_doors = cv2.bitwise_or(m_doors,
                pip.clean_mask(md_diag, cfg["min_area_door_px"], cfg["clean_close_k_door"]))
        if cv2.countNonZero(mw_diag) > 0:
            m_wins = cv2.bitwise_or(m_wins,
                pip.clean_mask(mw_diag, cfg["min_area_win_px"], cfg["clean_close_k_win"]))
        logger.info("[H] après passes diag : doors=%d px, wins=%d px",
                    cv2.countNonZero(m_doors), cv2.countNonZero(m_wins))

        _, _, _, _, _ww1, _, _ = pip.infer_pass(img_pil, client, MODEL_H_WALLS,
            cfg["pass1_tile"], cfg["pass1_over"], write_rooms=False,
            conf_min_door=0.01, conf_min_win=0.01, cfg=cfg)
        _, _, _, _, _ww2, _, _ = pip.infer_pass(img_pil, client, MODEL_H_WALLS,
            cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
            conf_min_door=0.01, conf_min_win=0.01, cfg=cfg)
        m_walls = cv2.bitwise_or(_ww1, _ww2)
        logger.info("[H] walls_ai=%d px, doors=%d px, windows=%d px",
                    cv2.countNonZero(m_walls), cv2.countNonZero(m_doors), cv2.countNonZero(m_wins))

        cnt, footprint_mask = _compute_footprint_diagonal(m_walls, m_doors, m_wins, H, W)
        if cnt is None: logger.warning("[H] Empreinte non trouvée")
        elif ppm is not None: footprint_area_m2 = float(cv2.contourArea(cnt)) / (ppm ** 2)

        if cnt is not None:
            building = np.zeros((H, W), np.uint8); cv2.fillPoly(building, [cnt], 255)
            walls_bin = (m_walls > 0).astype(np.uint8) * 255
            r_px = (max(1, int(round((cfg.get("wall_thickness_m", 0.20) * ppm) / 2.0)))
                    if ppm is not None else max(1, cfg.get("wall_thickness_px_fallback", 10) // 2))
            k_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r_px + 1, 2 * r_px + 1))
            walls_thick = cv2.bitwise_and(cv2.dilate(walls_bin, k_w), building)
            interior_mask = cv2.morphologyEx(cv2.subtract(building, walls_thick), cv2.MORPH_OPEN,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)
            if ppm is not None:
                walls_area_m2 = round(cv2.countNonZero(walls_thick) / ppm ** 2, 2)
                hab_area_m2   = round(cv2.countNonZero(interior_mask) / ppm ** 2, 2)

        rooms_list = segment_rooms_diagonal(m_walls, m_doors, m_wins, cnt, H, W, ppm)
        doors_count   = pip._count_connected_components(m_doors)
        windows_count = pip._count_connected_components(m_wins)
        all_segs, diag_segs, h_segs, v_segs = _hough_stats(m_walls, H, W)
        diagonal_pct = len(diag_segs) / max(len(all_segs), 1) * 100

        def _ov(mask, color, alpha):
            return (pip._np_to_b64(pip._mask_to_rgba(mask, color, alpha))
                    if cv2.countNonZero(mask) > 0 else None)
        mask_doors_b64     = _ov(m_doors,   (217, 70,  239), 90)
        mask_windows_b64   = _ov(m_wins,    (34,  211, 238), 90)
        mask_walls_b64     = _ov(m_walls,   (96,  165, 250), 90)
        mask_rooms_b64     = (pip._np_to_b64(pip._build_rooms_color_mask(rooms_list, H, W))
                              if rooms_list else None)
        mask_footprint_b64 = (pip._np_to_b64(pip._mask_to_rgba(footprint_mask, (251, 191, 36), 50))
                              if footprint_mask is not None and cv2.countNonZero(footprint_mask) > 0 else None)
        mask_hab_b64       = (pip._np_to_b64(pip._mask_to_rgba(interior_mask, (74, 222, 128), 60))
                              if interior_mask is not None and cv2.countNonZero(interior_mask) > 0 else None)
        diag_overlay = np.zeros((H, W), np.uint8)
        for seg in diag_segs:
            cv2.line(diag_overlay, (seg["x1"], seg["y1"]), (seg["x2"], seg["y2"]), 255, 3, cv2.LINE_AA)
        mask_diagonal_b64 = _ov(diag_overlay, (249, 115, 22), 200)

    except Exception as e:
        error = str(e); logger.error("Pipeline H failed: %s", e, exc_info=True)

    elapsed = time.time() - t0
    return {
        "id": "H", "name": "Diagonal (H)",
        "description": "Murs IA (xi9ox) + portes/fenêtres ±45° + segmentation diagonale",
        "color": "#06B6D4",
        "doors_count": doors_count, "windows_count": windows_count,
        "mask_doors_b64": mask_doors_b64, "mask_windows_b64": mask_windows_b64,
        "mask_walls_b64": mask_walls_b64, "mask_footprint_b64": mask_footprint_b64,
        "mask_hab_b64": mask_hab_b64,
        "footprint_area_m2": round(footprint_area_m2, 2) if footprint_area_m2 else None,
        "walls_area_m2": walls_area_m2, "hab_area_m2": hab_area_m2,
        "rooms_count": len(rooms_list),
        "rooms": [{k: v for k, v in r.items() if not k.startswith("_")} for r in rooms_list],
        "mask_rooms_b64": mask_rooms_b64, "timing_seconds": round(elapsed, 2), "error": error,
        "is_diagonal": True, "mask_diagonal_walls_b64": mask_diagonal_b64,
        "wall_segments": [{"x1_norm": s["x1_norm"], "y1_norm": s["y1_norm"],
             "x2_norm": s["x2_norm"], "y2_norm": s["y2_norm"],
             "length_m": round(s["length_px"] / ppm, 2) if ppm else None,
             "angle_deg": s["angle_deg"], "is_diagonal": s["is_diagonal"]} for s in all_segs],
        "diagonal_stats": {"total_segments": len(all_segs), "diagonal_segments": len(diag_segs),
            "horizontal_segments": len(h_segs), "vertical_segments": len(v_segs),
            "diagonal_pct": round(diagonal_pct, 1)},
        "_m_doors_raw": m_doors, "_m_windows_raw": m_wins, "_m_walls_raw": m_walls,
    }


# ============================================================
# PIPELINE J — Modèle test : wall-detection-qpxun/2
# ============================================================

def run_pipeline_j(img_rgb: np.ndarray, img_pil,
                   client, ppm: float, cfg: dict) -> dict:
    """Pipeline J : test du modèle wall-detection-qpxun/2."""
    import time
    import pipeline as pip

    t0 = time.time()
    H, W = img_rgb.shape[:2]
    m_doors = m_wins = m_walls = np.zeros((H, W), np.uint8)
    interior_mask = cnt = footprint_mask = None
    footprint_area_m2 = walls_area_m2 = hab_area_m2 = None
    rooms_list = []; error = None
    all_segs = diag_segs = h_segs = v_segs = []
    doors_count = windows_count = 0; diagonal_pct = 0.0
    mask_doors_b64 = mask_windows_b64 = mask_walls_b64 = None
    mask_rooms_b64 = mask_footprint_b64 = mask_hab_b64 = mask_diagonal_b64 = None

    try:
        model_id = cfg.get("model_id", pip.DEFAULT_CONFIG["model_id"])

        _, _, md1, mw1, _, _, _ = pip.infer_pass(img_pil, client, model_id,
            cfg["pass1_tile"], cfg["pass1_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg)
        _, _, md2, mw2, _, _, _ = pip.infer_pass(img_pil, client, model_id,
            cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg)
        m_doors = cv2.bitwise_or(
            pip.clean_mask(md1, cfg["min_area_door_px"], cfg["clean_close_k_door"]),
            pip.clean_mask(md2, cfg["min_area_door_px"], cfg["clean_close_k_door"]))
        m_wins = cv2.bitwise_or(
            pip.clean_mask(mw1, cfg["min_area_win_px"], cfg["clean_close_k_win"]),
            pip.clean_mask(mw2, cfg["min_area_win_px"], cfg["clean_close_k_win"]))

        md_diag, mw_diag = _infer_diagonal_openings(img_rgb, img_pil, client, model_id,
            angles=[-45, 45], conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg)
        if cv2.countNonZero(md_diag) > 0:
            m_doors = cv2.bitwise_or(m_doors,
                pip.clean_mask(md_diag, cfg["min_area_door_px"], cfg["clean_close_k_door"]))
        if cv2.countNonZero(mw_diag) > 0:
            m_wins = cv2.bitwise_or(m_wins,
                pip.clean_mask(mw_diag, cfg["min_area_win_px"], cfg["clean_close_k_win"]))
        logger.info("[J] après passes diag : doors=%d px, wins=%d px",
                    cv2.countNonZero(m_doors), cv2.countNonZero(m_wins))

        _, _, _, _, _ww1, _, _ = pip.infer_pass(img_pil, client, MODEL_J_WALLS,
            cfg["pass1_tile"], cfg["pass1_over"], write_rooms=False,
            conf_min_door=0.01, conf_min_win=0.01, cfg=cfg)
        _, _, _, _, _ww2, _, _ = pip.infer_pass(img_pil, client, MODEL_J_WALLS,
            cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
            conf_min_door=0.01, conf_min_win=0.01, cfg=cfg)
        m_walls = cv2.bitwise_or(_ww1, _ww2)
        logger.info("[J] walls_ai=%d px (qpxun), doors=%d px, windows=%d px",
                    cv2.countNonZero(m_walls), cv2.countNonZero(m_doors), cv2.countNonZero(m_wins))

        cnt, footprint_mask = _compute_footprint_diagonal(m_walls, m_doors, m_wins, H, W)
        if cnt is None: logger.warning("[J] Empreinte non trouvée")
        elif ppm is not None: footprint_area_m2 = float(cv2.contourArea(cnt)) / (ppm ** 2)

        if cnt is not None:
            building = np.zeros((H, W), np.uint8); cv2.fillPoly(building, [cnt], 255)
            walls_bin = (m_walls > 0).astype(np.uint8) * 255
            r_px = (max(1, int(round((cfg.get("wall_thickness_m", 0.20) * ppm) / 2.0)))
                    if ppm is not None else max(1, cfg.get("wall_thickness_px_fallback", 10) // 2))
            k_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r_px + 1, 2 * r_px + 1))
            walls_thick = cv2.bitwise_and(cv2.dilate(walls_bin, k_w), building)
            interior_mask = cv2.morphologyEx(cv2.subtract(building, walls_thick), cv2.MORPH_OPEN,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)
            if ppm is not None:
                walls_area_m2 = round(cv2.countNonZero(walls_thick) / ppm ** 2, 2)
                hab_area_m2   = round(cv2.countNonZero(interior_mask) / ppm ** 2, 2)

        rooms_list = segment_rooms_diagonal(m_walls, m_doors, m_wins, cnt, H, W, ppm)
        doors_count   = pip._count_connected_components(m_doors)
        windows_count = pip._count_connected_components(m_wins)
        all_segs, diag_segs, h_segs, v_segs = _hough_stats(m_walls, H, W)
        diagonal_pct = len(diag_segs) / max(len(all_segs), 1) * 100

        def _ov(mask, color, alpha):
            return (pip._np_to_b64(pip._mask_to_rgba(mask, color, alpha))
                    if cv2.countNonZero(mask) > 0 else None)
        mask_doors_b64     = _ov(m_doors,   (217, 70,  239), 90)
        mask_windows_b64   = _ov(m_wins,    (34,  211, 238), 90)
        mask_walls_b64     = _ov(m_walls,   (96,  165, 250), 90)
        mask_rooms_b64     = (pip._np_to_b64(pip._build_rooms_color_mask(rooms_list, H, W))
                              if rooms_list else None)
        mask_footprint_b64 = (pip._np_to_b64(pip._mask_to_rgba(footprint_mask, (251, 191, 36), 50))
                              if footprint_mask is not None and cv2.countNonZero(footprint_mask) > 0 else None)
        mask_hab_b64       = (pip._np_to_b64(pip._mask_to_rgba(interior_mask, (74, 222, 128), 60))
                              if interior_mask is not None and cv2.countNonZero(interior_mask) > 0 else None)
        diag_overlay = np.zeros((H, W), np.uint8)
        for seg in diag_segs:
            cv2.line(diag_overlay, (seg["x1"], seg["y1"]), (seg["x2"], seg["y2"]), 255, 3, cv2.LINE_AA)
        mask_diagonal_b64 = _ov(diag_overlay, (249, 115, 22), 200)

    except Exception as e:
        error = str(e); logger.error("Pipeline J failed: %s", e, exc_info=True)

    elapsed = time.time() - t0
    return {
        "id": "J", "name": "Test qpxun (J)",
        "description": "Murs wall-detection-qpxun/2 + portes/fenetres ±45° + segmentation diagonale",
        "color": "#f97316",
        "doors_count": doors_count, "windows_count": windows_count,
        "mask_doors_b64": mask_doors_b64, "mask_windows_b64": mask_windows_b64,
        "mask_walls_b64": mask_walls_b64, "mask_footprint_b64": mask_footprint_b64,
        "mask_hab_b64": mask_hab_b64,
        "footprint_area_m2": round(footprint_area_m2, 2) if footprint_area_m2 else None,
        "walls_area_m2": walls_area_m2, "hab_area_m2": hab_area_m2,
        "rooms_count": len(rooms_list),
        "rooms": [{k: v for k, v in r.items() if not k.startswith("_")} for r in rooms_list],
        "mask_rooms_b64": mask_rooms_b64, "timing_seconds": round(elapsed, 2), "error": error,
        "is_diagonal": True, "mask_diagonal_walls_b64": mask_diagonal_b64,
        "wall_segments": [{"x1_norm": s["x1_norm"], "y1_norm": s["y1_norm"],
             "x2_norm": s["x2_norm"], "y2_norm": s["y2_norm"],
             "length_m": round(s["length_px"] / ppm, 2) if ppm else None,
             "angle_deg": s["angle_deg"], "is_diagonal": s["is_diagonal"]} for s in all_segs],
        "diagonal_stats": {"total_segments": len(all_segs), "diagonal_segments": len(diag_segs),
            "horizontal_segments": len(h_segs), "vertical_segments": len(v_segs),
            "diagonal_pct": round(diagonal_pct, 1)},
        "_m_doors_raw": m_doors, "_m_windows_raw": m_wins, "_m_walls_raw": m_walls,
    }


# ============================================================
# PIPELINE I — Pixel (OTSU) murs + IA portes/fenêtres + segmentation diagonale
# ============================================================

def run_pipeline_i(img_rgb: np.ndarray, img_pil,
                   client, ppm: float, cfg: dict) -> dict:
    """Pipeline I : murs OTSU + portes/fenêtres IA + segmentation diagonale."""
    import time
    import pipeline as pip

    t0 = time.time()
    H, W = img_rgb.shape[:2]
    m_doors = m_wins = m_walls = np.zeros((H, W), np.uint8)
    interior_mask = cnt = footprint_mask = None
    footprint_area_m2 = walls_area_m2 = hab_area_m2 = None
    rooms_list = []; error = None
    all_segs = diag_segs = h_segs = v_segs = []
    doors_count = windows_count = 0; diagonal_pct = 0.0
    mask_doors_b64 = mask_windows_b64 = mask_walls_b64 = None
    mask_rooms_b64 = mask_footprint_b64 = mask_hab_b64 = mask_diagonal_b64 = None

    try:
        model_id = cfg.get("model_id", pip.DEFAULT_CONFIG["model_id"])

        m_walls = pip._detect_walls_pixel(img_rgb)
        logger.info("[I] walls_pixel=%d px", cv2.countNonZero(m_walls))

        _, _, md1, mw1, _, _, _ = pip.infer_pass(img_pil, client, model_id,
            cfg["pass1_tile"], cfg["pass1_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg)
        _, _, md2, mw2, _, _, _ = pip.infer_pass(img_pil, client, model_id,
            cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg)
        m_doors = cv2.bitwise_or(
            pip.clean_mask(md1, cfg["min_area_door_px"], cfg["clean_close_k_door"]),
            pip.clean_mask(md2, cfg["min_area_door_px"], cfg["clean_close_k_door"]))
        m_wins = cv2.bitwise_or(
            pip.clean_mask(mw1, cfg["min_area_win_px"], cfg["clean_close_k_win"]),
            pip.clean_mask(mw2, cfg["min_area_win_px"], cfg["clean_close_k_win"]))
        logger.info("[I] doors=%d px, windows=%d px",
                    cv2.countNonZero(m_doors), cv2.countNonZero(m_wins))

        m_walls_for_fp = _rebuild_walls_for_footprint(m_walls, H, W, ppm)
        cnt, footprint_mask = _compute_footprint_diagonal(m_walls_for_fp, m_doors, m_wins, H, W)
        if cnt is None: logger.warning("[I] Empreinte non trouvée même après reconstruction Hough")
        elif ppm is not None: footprint_area_m2 = float(cv2.contourArea(cnt)) / (ppm ** 2)

        if cnt is not None:
            building = np.zeros((H, W), np.uint8); cv2.fillPoly(building, [cnt], 255)
            walls_bin = (m_walls > 0).astype(np.uint8) * 255
            r_px = (max(1, int(round((cfg.get("wall_thickness_m", 0.20) * ppm) / 2.0)))
                    if ppm is not None else max(1, cfg.get("wall_thickness_px_fallback", 10) // 2))
            k_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r_px + 1, 2 * r_px + 1))
            walls_thick = cv2.bitwise_and(cv2.dilate(walls_bin, k_w), building)
            interior_mask = cv2.morphologyEx(cv2.subtract(building, walls_thick), cv2.MORPH_OPEN,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)
            if ppm is not None:
                walls_area_m2 = round(cv2.countNonZero(walls_thick) / ppm ** 2, 2)
                hab_area_m2   = round(cv2.countNonZero(interior_mask) / ppm ** 2, 2)

        rooms_list = segment_rooms_diagonal(m_walls, m_doors, m_wins, cnt, H, W, ppm)
        doors_count   = pip._count_connected_components(m_doors)
        windows_count = pip._count_connected_components(m_wins)
        all_segs, diag_segs, h_segs, v_segs = _hough_stats(m_walls, H, W)
        diagonal_pct = len(diag_segs) / max(len(all_segs), 1) * 100

        def _ov(mask, color, alpha):
            return (pip._np_to_b64(pip._mask_to_rgba(mask, color, alpha))
                    if cv2.countNonZero(mask) > 0 else None)
        mask_doors_b64     = _ov(m_doors,   (217, 70,  239), 90)
        mask_windows_b64   = _ov(m_wins,    (34,  211, 238), 90)
        mask_walls_b64     = _ov(m_walls,   (96,  165, 250), 90)
        mask_rooms_b64     = (pip._np_to_b64(pip._build_rooms_color_mask(rooms_list, H, W))
                              if rooms_list else None)
        mask_footprint_b64 = (pip._np_to_b64(pip._mask_to_rgba(footprint_mask, (251, 191, 36), 50))
                              if footprint_mask is not None and cv2.countNonZero(footprint_mask) > 0 else None)
        mask_hab_b64       = (pip._np_to_b64(pip._mask_to_rgba(interior_mask, (74, 222, 128), 60))
                              if interior_mask is not None and cv2.countNonZero(interior_mask) > 0 else None)
        diag_overlay = np.zeros((H, W), np.uint8)
        for seg in diag_segs:
            cv2.line(diag_overlay, (seg["x1"], seg["y1"]), (seg["x2"], seg["y2"]), 255, 3, cv2.LINE_AA)
        mask_diagonal_b64 = _ov(diag_overlay, (249, 115, 22), 200)

    except Exception as e:
        error = str(e); logger.error("Pipeline I failed: %s", e, exc_info=True)

    elapsed = time.time() - t0
    return {
        "id": "I", "name": "Pixel+IA (I)",
        "description": "Murs OTSU pixel (E) + portes/fenêtres IA (A) + segmentation diagonale",
        "color": "#84cc16",
        "doors_count": doors_count, "windows_count": windows_count,
        "mask_doors_b64": mask_doors_b64, "mask_windows_b64": mask_windows_b64,
        "mask_walls_b64": mask_walls_b64, "mask_footprint_b64": mask_footprint_b64,
        "mask_hab_b64": mask_hab_b64,
        "footprint_area_m2": round(footprint_area_m2, 2) if footprint_area_m2 else None,
        "walls_area_m2": walls_area_m2, "hab_area_m2": hab_area_m2,
        "rooms_count": len(rooms_list),
        "rooms": [{k: v for k, v in r.items() if not k.startswith("_")} for r in rooms_list],
        "mask_rooms_b64": mask_rooms_b64, "timing_seconds": round(elapsed, 2), "error": error,
        "is_diagonal": True, "mask_diagonal_walls_b64": mask_diagonal_b64,
        "wall_segments": [{"x1_norm": s["x1_norm"], "y1_norm": s["y1_norm"],
             "x2_norm": s["x2_norm"], "y2_norm": s["y2_norm"],
             "length_m": round(s["length_px"] / ppm, 2) if ppm else None,
             "angle_deg": s["angle_deg"], "is_diagonal": s["is_diagonal"]} for s in all_segs],
        "diagonal_stats": {"total_segments": len(all_segs), "diagonal_segments": len(diag_segs),
            "horizontal_segments": len(h_segs), "vertical_segments": len(v_segs),
            "diagonal_pct": round(diagonal_pct, 1)},
        "_m_doors_raw": m_doors, "_m_windows_raw": m_wins, "_m_walls_raw": m_walls,
    }


# ============================================================
# UTILS — détection automatique des angles dominants du plan
# ============================================================

def _detect_dominant_angles(img_rgb: np.ndarray,
                             ortho_tolerance: float = 15.0,
                             min_line_length_ratio: float = 0.03,
                             max_gap_ratio: float = 0.01,
                             max_angles: int = 3) -> list:
    """Détecte les angles dominants non-orthogonaux dans le plan via Hough.

    Retourne une liste d'angles en degrés (dans [0, 90[) qui représentent
    des directions de murs significatives NON alignées sur H/V.
    Ces angles seront utilisés par le pipeline K pour choisir les rotations
    d'inférence.
    """
    H, W = img_rgb.shape[:2]
    min_dim = min(H, W)

    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)

    min_len = max(20, int(min_dim * min_line_length_ratio))
    max_gap = max(5,  int(min_dim * max_gap_ratio))

    lines = cv2.HoughLinesP(edges, rho=1, theta=np.pi / 180, threshold=30,
                             minLineLength=min_len, maxLineGap=max_gap)

    if lines is None:
        logger.info("[K-angles] Hough n'a trouvé aucun segment")
        return []

    raw_angles = []
    for line in lines:
        x1, y1, x2, y2 = map(int, line[0])
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180
        if angle >= 90:
            angle -= 90
        raw_angles.append(angle)

    if not raw_angles:
        return []

    diagonal_angles = [a for a in raw_angles
                       if ortho_tolerance < a < (90.0 - ortho_tolerance)]

    if not diagonal_angles:
        logger.info("[K-angles] Aucun angle diagonal détecté (tous orthogonaux)")
        return []

    diagonal_angles.sort()
    clusters = []

    for a in diagonal_angles:
        placed = False
        for idx, (centre, cnt_c) in enumerate(clusters):
            if abs(a - centre) <= 8.0:
                new_centre = (centre * cnt_c + a) / (cnt_c + 1)
                clusters[idx] = (new_centre, cnt_c + 1)
                placed = True
                break
        if not placed:
            clusters.append((a, 1))

    clusters.sort(key=lambda x: x[1], reverse=True)
    dominant = [round(centre, 1) for centre, cnt_c in clusters[:max_angles] if cnt_c > 2]

    logger.info("[K-angles] angles dominants : %s (sur %d segments diag)",
                dominant, len(diagonal_angles))
    return dominant


# ============================================================
# PIPELINE K — Rotation automatique adaptative
# ============================================================

def run_pipeline_k(img_rgb: np.ndarray, img_pil,
                   client, ppm: float, cfg: dict) -> dict:
    """Pipeline K : rotation automatique basée sur les angles Hough dominants.

    vs H (passes fixes ±45°) :
    - Détecte automatiquement les angles dominants du plan
    - Applique les rotations exactes correspondantes (pas hardcodées)
    - Plan orthogonal → 0 rotation supplémentaire (= plus rapide que H)
    - Plans avec N directions diagonales → N×2 passes adaptées
    """
    import time
    import pipeline as pip

    t0 = time.time()
    H, W = img_rgb.shape[:2]

    m_doors = m_wins = m_walls = np.zeros((H, W), np.uint8)
    interior_mask = cnt = footprint_mask = None
    footprint_area_m2 = walls_area_m2 = hab_area_m2 = None
    rooms_list = []
    error = None
    all_segs = diag_segs = h_segs = v_segs = []
    doors_count = windows_count = 0
    diagonal_pct = 0.0
    mask_doors_b64 = mask_windows_b64 = mask_walls_b64 = None
    mask_rooms_b64 = mask_footprint_b64 = mask_hab_b64 = None
    mask_diagonal_b64 = None
    detected_angles = []

    try:
        model_id = cfg.get("model_id", pip.DEFAULT_CONFIG["model_id"])

        # 0. Détection automatique des angles dominants
        detected_angles = _detect_dominant_angles(img_rgb)
        logger.info("[K] angles dominants : %s", detected_angles)

        # 1. Passes orthogonales standard
        _, _, md1, mw1, _, _, _ = pip.infer_pass(
            img_pil, client, model_id, cfg["pass1_tile"], cfg["pass1_over"],
            write_rooms=False, conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg)
        _, _, md2, mw2, _, _, _ = pip.infer_pass(
            img_pil, client, model_id, cfg["pass2_tile"], cfg["pass2_over"],
            write_rooms=False, conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg)
        m_doors = cv2.bitwise_or(
            pip.clean_mask(md1, cfg["min_area_door_px"], cfg["clean_close_k_door"]),
            pip.clean_mask(md2, cfg["min_area_door_px"], cfg["clean_close_k_door"]))
        m_wins = cv2.bitwise_or(
            pip.clean_mask(mw1, cfg["min_area_win_px"], cfg["clean_close_k_win"]),
            pip.clean_mask(mw2, cfg["min_area_win_px"], cfg["clean_close_k_win"]))

        # 1b. Passes adaptatives selon les angles détectés
        if detected_angles:
            rotation_angles = []
            for a in detected_angles:
                rotation_angles.append(-a)
                rotation_angles.append(-(a - 90.0))

            seen = set()
            filtered_angles = []
            for ra in rotation_angles:
                ra_norm = ra % 360
                close_to_ortho = any(
                    abs((ra_norm - o) % 360) < 10 or abs((ra_norm - o) % 360) > 350
                    for o in [0, 90, 180, 270])
                key = round(ra_norm, 0)
                if not close_to_ortho and key not in seen:
                    seen.add(key)
                    filtered_angles.append(ra)

            logger.info("[K] rotations appliquées : %s", filtered_angles)
            md_auto, mw_auto = _infer_diagonal_openings(
                img_rgb, img_pil, client, model_id, angles=filtered_angles,
                conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg)
            if cv2.countNonZero(md_auto) > 0:
                m_doors = cv2.bitwise_or(m_doors,
                    pip.clean_mask(md_auto, cfg["min_area_door_px"], cfg["clean_close_k_door"]))
            if cv2.countNonZero(mw_auto) > 0:
                m_wins = cv2.bitwise_or(m_wins,
                    pip.clean_mask(mw_auto, cfg["min_area_win_px"], cfg["clean_close_k_win"]))
            logger.info("[K] après passes adaptatives : doors=%d px, wins=%d px",
                        cv2.countNonZero(m_doors), cv2.countNonZero(m_wins))
        else:
            logger.info("[K] Plan orthogonal — pas de passes supplémentaires")

        # 2. Murs IA (identique à H)
        _, _, _, _, _ww1, _, _ = pip.infer_pass(img_pil, client, MODEL_H_WALLS,
            cfg["pass1_tile"], cfg["pass1_over"], write_rooms=False,
            conf_min_door=0.01, conf_min_win=0.01, cfg=cfg)
        _, _, _, _, _ww2, _, _ = pip.infer_pass(img_pil, client, MODEL_H_WALLS,
            cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
            conf_min_door=0.01, conf_min_win=0.01, cfg=cfg)
        m_walls = cv2.bitwise_or(_ww1, _ww2)
        logger.info("[K] walls=%d px, doors=%d px, wins=%d px",
                    cv2.countNonZero(m_walls), cv2.countNonZero(m_doors), cv2.countNonZero(m_wins))

        # 3. Empreinte diagonale
        cnt, footprint_mask = _compute_footprint_diagonal(m_walls, m_doors, m_wins, H, W)
        if cnt is None:
            logger.warning("[K] Empreinte non trouvée")
        elif ppm is not None:
            footprint_area_m2 = float(cv2.contourArea(cnt)) / (ppm ** 2)

        # 4. Surface habitable
        if cnt is not None:
            building = np.zeros((H, W), np.uint8)
            cv2.fillPoly(building, [cnt], 255)
            walls_bin = (m_walls > 0).astype(np.uint8) * 255
            r_px = (max(1, int(round((cfg.get("wall_thickness_m", 0.20) * ppm) / 2.0)))
                    if ppm is not None else max(1, cfg.get("wall_thickness_px_fallback", 10) // 2))
            k_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r_px + 1, 2 * r_px + 1))
            walls_thick = cv2.bitwise_and(cv2.dilate(walls_bin, k_w), building)
            interior_mask = cv2.morphologyEx(cv2.subtract(building, walls_thick),
                cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)
            if ppm is not None:
                walls_area_m2 = round(cv2.countNonZero(walls_thick) / ppm ** 2, 2)
                hab_area_m2   = round(cv2.countNonZero(interior_mask) / ppm ** 2, 2)

        # 5. Pièces diagonales
        rooms_list = segment_rooms_diagonal(m_walls, m_doors, m_wins, cnt, H, W, ppm)

        # 6. Comptages
        doors_count   = pip._count_connected_components(m_doors)
        windows_count = pip._count_connected_components(m_wins)

        # 7. Hough stats
        all_segs, diag_segs, h_segs, v_segs = _hough_stats(m_walls, H, W)
        diagonal_pct = len(diag_segs) / max(len(all_segs), 1) * 100

        # 8. Overlays
        def _ov(mask, color, alpha):
            return (pip._np_to_b64(pip._mask_to_rgba(mask, color, alpha))
                    if cv2.countNonZero(mask) > 0 else None)

        mask_doors_b64     = _ov(m_doors,     (217, 70,  239), 90)
        mask_windows_b64   = _ov(m_wins,      (34,  211, 238), 90)
        mask_walls_b64     = _ov(m_walls,     (96,  165, 250), 90)
        mask_rooms_b64     = (pip._np_to_b64(pip._build_rooms_color_mask(rooms_list, H, W))
                              if rooms_list else None)
        mask_footprint_b64 = (pip._np_to_b64(pip._mask_to_rgba(footprint_mask, (251, 191, 36), 50))
                              if footprint_mask is not None and cv2.countNonZero(footprint_mask) > 0 else None)
        mask_hab_b64       = (pip._np_to_b64(pip._mask_to_rgba(interior_mask, (74, 222, 128), 60))
                              if interior_mask is not None and cv2.countNonZero(interior_mask) > 0 else None)
        diag_overlay = np.zeros((H, W), np.uint8)
        for seg in diag_segs:
            cv2.line(diag_overlay, (seg["x1"], seg["y1"]), (seg["x2"], seg["y2"]), 255, 3, cv2.LINE_AA)
        mask_diagonal_b64 = _ov(diag_overlay, (249, 115, 22), 200)

    except Exception as e:
        error = str(e)
        logger.error("Pipeline K failed: %s", e, exc_info=True)

    elapsed = time.time() - t0
    return {
        "id": "K",
        "name": "Auto-rotate (K)",
        "description": "Rotation automatique Hough + inférence adaptative multi-angles",
        "color": "#ec4899",
        "doors_count": doors_count, "windows_count": windows_count,
        "mask_doors_b64": mask_doors_b64, "mask_windows_b64": mask_windows_b64,
        "mask_walls_b64": mask_walls_b64, "mask_footprint_b64": mask_footprint_b64,
        "mask_hab_b64": mask_hab_b64,
        "footprint_area_m2": round(footprint_area_m2, 2) if footprint_area_m2 else None,
        "walls_area_m2": walls_area_m2, "hab_area_m2": hab_area_m2,
        "rooms_count": len(rooms_list),
        "rooms": [{k: v for k, v in r.items() if not k.startswith("_")} for r in rooms_list],
        "mask_rooms_b64": mask_rooms_b64,
        "timing_seconds": round(elapsed, 2), "error": error,
        "is_diagonal": True,
        "mask_diagonal_walls_b64": mask_diagonal_b64,
        "wall_segments": [
            {"x1_norm": s["x1_norm"], "y1_norm": s["y1_norm"],
             "x2_norm": s["x2_norm"], "y2_norm": s["y2_norm"],
             "length_m": round(s["length_px"] / ppm, 2) if ppm else None,
             "angle_deg": s["angle_deg"], "is_diagonal": s["is_diagonal"]}
            for s in all_segs],
        "diagonal_stats": {
            "total_segments": len(all_segs), "diagonal_segments": len(diag_segs),
            "horizontal_segments": len(h_segs), "vertical_segments": len(v_segs),
            "diagonal_pct": round(diagonal_pct, 1),
            "detected_angles": detected_angles,
        },
        "_m_doors_raw": m_doors, "_m_windows_raw": m_wins, "_m_walls_raw": m_walls,
    }
