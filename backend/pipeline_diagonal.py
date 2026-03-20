"""
pipeline_diagonal.py — Pipeline H : IA murs + segmentation diagonale
=====================================================================

Stratégie simplifiée :
  1. Portes/fenêtres  → modèle principal (même que A), 2 passes
  2. Murs             → wall-detection-xi9ox/1 (même que prod D/G), 2 passes
                        masque utilisé DIRECTEMENT sans post-traitement
  3. Empreinte        → pip._compute_footprint standard
  4. Surface          → calcul standard
  5. Pièces           → segment_rooms_diagonal (kernels elliptiques + croisé 45°)
                        → seule vraie différence vs G pour les plans inclinés
  6. Stats diagonales → Hough sur le masque IA, pour info/overlay uniquement
                        (ne modifie PAS le masque murs)

Ce module est importé par pipeline.py et exécuté uniquement en mode admin
via la route /compare (pipeline_id="H").
"""

import math
import logging
import numpy as np
import cv2

logger = logging.getLogger(__name__)

MODEL_H_WALLS = "wall-detection-xi9ox/1"


# ============================================================
# HOUGH STATS — lecture seule, ne modifie pas le masque murs
# ============================================================

def _hough_stats(walls_mask: np.ndarray, H: int, W: int) -> tuple:
    """Extrait les segments Hough pour les stats et l'overlay diagonal.

    Ne modifie PAS le masque murs — utilisé uniquement pour :
    - compter les murs diagonaux détectés
    - dessiner l'overlay orange
    """
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
            if is_d:
                diag_segs.append(seg)
            elif is_h:
                h_segs.append(seg)
            else:
                v_segs.append(seg)

    return all_segs, diag_segs, h_segs, v_segs


# ============================================================
# SEGMENTATION PIÈCES ADAPTÉE AUX MURS INCLINÉS
# ============================================================

def segment_rooms_diagonal(walls: np.ndarray, m_doors: np.ndarray,
                            m_windows: np.ndarray, building_cnt,
                            H: int, W: int, ppm) -> list:
    """Segmentation pièces avec kernels elliptiques + croisé 45°.

    Ferme mieux les jonctions diagonales que le kernel rectangulaire (prod).
    """
    building = np.zeros((H, W), np.uint8)
    if building_cnt is not None:
        cv2.fillPoly(building, [building_cnt], 255)
    else:
        building[:] = 255

    boundaries = walls.copy()

    # Fermeture croisée (45°) puis elliptique
    k_cross = cv2.getStructuringElement(cv2.MORPH_CROSS, (5, 5))
    b1 = cv2.dilate(boundaries, k_cross, iterations=1)
    k_ellipse = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    boundaries_closed = cv2.dilate(b1, k_ellipse, iterations=1)

    interior = cv2.subtract(building, boundaries_closed)

    k_clean = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    interior = cv2.morphologyEx(interior, cv2.MORPH_OPEN, k_clean, iterations=1)

    logger.info("[ROOMS-H] walls_px=%d, interior_px=%d, H=%d, W=%d",
                cv2.countNonZero(walls), cv2.countNonZero(interior), H, W)

    min_area_px = max(200, int(0.3 * ppm ** 2)) if ppm else 500
    num_labels, labels_map = cv2.connectedComponents(interior, connectivity=8)

    from pipeline import _classify_room_by_area

    rooms_raw = []
    for i in range(1, num_labels):
        mask_i = (labels_map == i).astype(np.uint8) * 255
        area_px = int(cv2.countNonZero(mask_i))
        if area_px < min_area_px:
            continue
        cnts_i, _ = cv2.findContours(mask_i, cv2.RETR_EXTERNAL,
                                     cv2.CHAIN_APPROX_SIMPLE)
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
# PIPELINE H
# ============================================================

def run_pipeline_h(img_rgb: np.ndarray, img_pil,
                   client, ppm: float, cfg: dict) -> dict:
    """Pipeline H : murs IA directs + segmentation pièces diagonale.

    Identique à G pour la détection (même modèle murs, même footprint),
    mais avec une segmentation pièces adaptée aux murs inclinés
    (kernels elliptiques + croisé 45° au lieu de rectangulaires).
    Les stats Hough + overlay orange restent disponibles pour comparaison.
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

    try:
        model_id = cfg.get("model_id", pip.DEFAULT_CONFIG["model_id"])

        # ── 1. Portes / fenêtres : modèle principal (identique à A) ──────────
        _, _, md1, mw1, _, _, _ = pip.infer_pass(
            img_pil, client, model_id,
            cfg["pass1_tile"], cfg["pass1_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg,
        )
        _, _, md2, mw2, _, _, _ = pip.infer_pass(
            img_pil, client, model_id,
            cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg,
        )
        m_doors = cv2.bitwise_or(
            pip.clean_mask(md1, cfg["min_area_door_px"], cfg["clean_close_k_door"]),
            pip.clean_mask(md2, cfg["min_area_door_px"], cfg["clean_close_k_door"]),
        )
        m_wins = cv2.bitwise_or(
            pip.clean_mask(mw1, cfg["min_area_win_px"], cfg["clean_close_k_win"]),
            pip.clean_mask(mw2, cfg["min_area_win_px"], cfg["clean_close_k_win"]),
        )

        # ── 2. Murs : modèle IA spécialiste (identique à D/G) ────────────────
        _, _, _, _, _ww1, _, _ = pip.infer_pass(
            img_pil, client, MODEL_H_WALLS,
            cfg["pass1_tile"], cfg["pass1_over"], write_rooms=False,
            conf_min_door=0.01, conf_min_win=0.01, cfg=cfg,
        )
        _, _, _, _, _ww2, _, _ = pip.infer_pass(
            img_pil, client, MODEL_H_WALLS,
            cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
            conf_min_door=0.01, conf_min_win=0.01, cfg=cfg,
        )
        # Masque IA utilisé directement — pas de Hough, pas d'OTSU
        m_walls = cv2.bitwise_or(_ww1, _ww2)

        logger.info("[H] walls_ai=%d px, doors=%d px, windows=%d px",
                    cv2.countNonZero(m_walls),
                    cv2.countNonZero(m_doors),
                    cv2.countNonZero(m_wins))

        # ── 3. Empreinte : standard (même que tous les autres pipelines) ──────
        cnt, footprint_mask = pip._compute_footprint(m_walls, m_doors, m_wins, H, W)
        if cnt is not None and ppm is not None:
            footprint_area_m2 = float(cv2.contourArea(cnt)) / (ppm ** 2)

        # ── 4. Surface habitable ───────────────────────────────────────────────
        if cnt is not None:
            building = np.zeros((H, W), np.uint8)
            cv2.fillPoly(building, [cnt], 255)
            walls_bin = (m_walls > 0).astype(np.uint8) * 255
            r_px = (max(1, int(round((cfg.get("wall_thickness_m", 0.20) * ppm) / 2.0)))
                    if ppm is not None
                    else max(1, cfg.get("wall_thickness_px_fallback", 10) // 2))
            k_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                            (2 * r_px + 1, 2 * r_px + 1))
            walls_thick = cv2.bitwise_and(cv2.dilate(walls_bin, k_w), building)
            interior_mask = cv2.morphologyEx(
                cv2.subtract(building, walls_thick),
                cv2.MORPH_OPEN,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
                iterations=1,
            )
            if ppm is not None:
                walls_area_m2 = round(cv2.countNonZero(walls_thick) / ppm ** 2, 2)
                hab_area_m2   = round(cv2.countNonZero(interior_mask) / ppm ** 2, 2)

        # ── 5. Pièces : segmentation diagonale (kernels elliptiques) ──────────
        rooms_list = segment_rooms_diagonal(m_walls, m_doors, m_wins,
                                            cnt, H, W, ppm)

        # ── 6. Comptages ───────────────────────────────────────────────────────
        doors_count   = pip._count_connected_components(m_doors)
        windows_count = pip._count_connected_components(m_wins)

        # ── 7. Stats Hough (lecture seule — ne modifie pas m_walls) ───────────
        all_segs, diag_segs, h_segs, v_segs = _hough_stats(m_walls, H, W)
        diagonal_pct = len(diag_segs) / max(len(all_segs), 1) * 100

        # ── 8. Overlays ────────────────────────────────────────────────────────
        def _ov(mask, color, alpha):
            return (pip._np_to_b64(pip._mask_to_rgba(mask, color, alpha))
                    if cv2.countNonZero(mask) > 0 else None)

        mask_doors_b64     = _ov(m_doors,       (217, 70,  239), 90)
        mask_windows_b64   = _ov(m_wins,         (34,  211, 238), 90)
        mask_walls_b64     = _ov(m_walls,        (96,  165, 250), 90)
        mask_rooms_b64     = (pip._np_to_b64(pip._build_rooms_color_mask(rooms_list, H, W))
                              if rooms_list else None)
        mask_footprint_b64 = (pip._np_to_b64(pip._mask_to_rgba(footprint_mask, (251, 191, 36), 50))
                              if footprint_mask is not None
                              and cv2.countNonZero(footprint_mask) > 0 else None)
        mask_hab_b64       = (pip._np_to_b64(pip._mask_to_rgba(interior_mask, (74, 222, 128), 60))
                              if interior_mask is not None
                              and cv2.countNonZero(interior_mask) > 0 else None)

        # Overlay orange : murs diagonaux détectés par Hough
        diag_overlay = np.zeros((H, W), np.uint8)
        for seg in diag_segs:
            cv2.line(diag_overlay,
                     (seg["x1"], seg["y1"]), (seg["x2"], seg["y2"]),
                     255, 3, cv2.LINE_AA)
        mask_diagonal_b64 = _ov(diag_overlay, (249, 115, 22), 200)

    except Exception as e:
        error = str(e)
        logger.error("Pipeline H failed: %s", e, exc_info=True)
        doors_count = windows_count = 0
        diagonal_pct = 0.0
        all_segs = diag_segs = h_segs = v_segs = []
        mask_doors_b64 = mask_windows_b64 = mask_walls_b64 = None
        mask_rooms_b64 = mask_footprint_b64 = mask_hab_b64 = None
        mask_diagonal_b64 = None

    elapsed = time.time() - t0

    return {
        "id": "H",
        "name": "Diagonal (H)",
        "description": "Murs IA directs (wall-detection-xi9ox) + segmentation pièces diagonale",
        "color": "#06B6D4",
        "doors_count": doors_count,
        "windows_count": windows_count,
        "mask_doors_b64": mask_doors_b64,
        "mask_windows_b64": mask_windows_b64,
        "mask_walls_b64": mask_walls_b64,
        "mask_footprint_b64": mask_footprint_b64,
        "mask_hab_b64": mask_hab_b64,
        "footprint_area_m2": round(footprint_area_m2, 2) if footprint_area_m2 else None,
        "walls_area_m2": walls_area_m2,
        "hab_area_m2": hab_area_m2,
        "rooms_count": len(rooms_list),
        "rooms": [{k: v for k, v in r.items() if not k.startswith("_")}
                  for r in rooms_list],
        "mask_rooms_b64": mask_rooms_b64,
        "timing_seconds": round(elapsed, 2),
        "error": error,
        "is_diagonal": True,
        "mask_diagonal_walls_b64": mask_diagonal_b64,
        "wall_segments": [
            {
                "x1_norm": s["x1_norm"], "y1_norm": s["y1_norm"],
                "x2_norm": s["x2_norm"], "y2_norm": s["y2_norm"],
                "length_m": round(s["length_px"] / ppm, 2) if ppm else None,
                "angle_deg": s["angle_deg"],
                "is_diagonal": s["is_diagonal"],
            }
            for s in all_segs
        ],
        "diagonal_stats": {
            "total_segments": len(all_segs),
            "diagonal_segments": len(diag_segs),
            "horizontal_segments": len(h_segs),
            "vertical_segments": len(v_segs),
            "diagonal_pct": round(diagonal_pct, 1),
        },
        "_m_doors_raw": m_doors,
        "_m_windows_raw": m_wins,
        "_m_walls_raw": m_walls,
    }
