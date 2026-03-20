"""
pipeline_diagonal.py — Pipeline H : Murs IA spécialiste + fix inclinaison
==========================================================================

Stratégie (mise à jour) :
  1. Murs : modèle IA spécialiste wall-detection-xi9ox/1
     → même modèle que la prod (G/D), meilleure précision de base
  2. Post-traitement Hough multi-angles sur le masque IA
     → vectorise + préserve les segments inclinés déjà détectés par l'IA
     → comble les petites interruptions dans les diagonales
  3. Segmentation pièces avec kernels elliptiques (vs rectangulaires en prod)
     → ferme mieux les jonctions diagonales

Différences vs Pipeline G (prod) :
  - Hough Lines probabilistes tous angles appliqué sur le masque murs IA
  - Segmentation pièces avec kernels elliptiques (pas rectangulaires)
  - Overlay orange des murs diagonaux détectés

Ce module est importé par pipeline.py et exécuté uniquement en mode admin
via la route /compare (pipeline_id="H").
"""

import math
import logging
import numpy as np
import cv2

logger = logging.getLogger(__name__)

# Modèle spécialiste murs — identique à celui utilisé en production (D/G)
MODEL_H_WALLS = "wall-detection-xi9ox/1"


# ============================================================
# STEP 1 — HOUGH LINES ADAPTATIF (tous angles)
# ============================================================

def extract_wall_lines_hough(walls_mask: np.ndarray, img_shape: tuple) -> list:
    """Extrait les segments de murs à tous les angles via HoughLinesP.

    Contrairement à vectorize_walls (qui filtre H/V), cette version
    conserve tous les angles et est donc adaptée aux murs inclinés.

    Retourne une liste de segments avec coordonnées normalisées.
    """
    H, W = img_shape[:2]

    if cv2.countNonZero(walls_mask) == 0:
        return []

    # Légère dilatation pour relier les segments proches avant Hough
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    mask_dilated = cv2.dilate(walls_mask, k, iterations=1)

    # HoughLinesP : résolution 1°, seuil bas pour capter les diagonales courtes
    lines = cv2.HoughLinesP(
        mask_dilated,
        rho=1,
        theta=np.pi / 180,   # résolution angulaire : 1°
        threshold=20,         # seuil de votes bas → détecte plus de segments
        minLineLength=15,     # longueur minimale (px)
        maxLineGap=8,         # gap maximal pour relier des segments
    )

    segments = []
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = map(int, line[0])
            length_px = float(np.hypot(x2 - x1, y2 - y1))
            angle_deg = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180

            segments.append({
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "x1_norm": round(x1 / W, 4),
                "y1_norm": round(y1 / H, 4),
                "x2_norm": round(x2 / W, 4),
                "y2_norm": round(y2 / H, 4),
                "length_px": length_px,
                "angle_deg": round(angle_deg, 1),
                "is_horizontal": angle_deg < 15 or angle_deg > 165,
                "is_vertical": 75 < angle_deg < 105,
                "is_diagonal": not (angle_deg < 15 or angle_deg > 165
                                    or 75 < angle_deg < 105),
            })

    return segments


# ============================================================
# STEP 2 — RECONSTRUCTION MASQUE DEPUIS SEGMENTS HOUGH
# ============================================================

def reconstruct_walls_from_lines(segments: list, H: int, W: int,
                                  line_thickness: int = 3) -> np.ndarray:
    """Reconstruit un masque de murs propre à partir des segments Hough.

    Chaque segment est redessiné avec épaisseur uniforme (LINE_AA).
    Une fermeture elliptique finale comble les micro-interruptions.
    """
    mask = np.zeros((H, W), np.uint8)

    for seg in segments:
        cv2.line(mask,
                 (seg["x1"], seg["y1"]),
                 (seg["x2"], seg["y2"]),
                 255, line_thickness, cv2.LINE_AA)

    # Fermeture finale pour combler les petites interruptions
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=1)

    return mask


# ============================================================
# STEP 3 — SEGMENTATION PIÈCES POUR MURS INCLINÉS
# ============================================================

def segment_rooms_diagonal(walls: np.ndarray, m_doors: np.ndarray,
                            m_windows: np.ndarray, building_cnt,
                            H: int, W: int, ppm) -> list:
    """Segmentation des pièces améliorée pour les murs inclinés.

    Différences clés vs segment_rooms_from_walls (prod) :
    1. Fermeture croisée (45°) avant fermeture elliptique
       → couvre les jonctions en diagonale que le kernel rect manque
    2. Nettoyage par ouverture elliptique (vs rectangulaire)
    3. Epsilon adaptatif plus fin pour des contours plus précis
    """
    # 1. Masque bâtiment
    building = np.zeros((H, W), np.uint8)
    if building_cnt is not None:
        cv2.fillPoly(building, [building_cnt], 255)
    else:
        building[:] = 255

    # 2. Frontières = murs uniquement
    boundaries = walls.copy()

    # 3. Fermeture multi-direction
    #    a) Kernel croisé pour les jonctions à 45°
    k_cross = cv2.getStructuringElement(cv2.MORPH_CROSS, (5, 5))
    b1 = cv2.dilate(boundaries, k_cross, iterations=1)
    #    b) Kernel elliptique pour les courbes et arrondis
    k_ellipse = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    boundaries_closed = cv2.dilate(b1, k_ellipse, iterations=1)

    # 4. Espace navigable
    interior = cv2.subtract(building, boundaries_closed)

    # 5. Nettoyage (kernel elliptique — préserve les coins diagonaux)
    k_clean = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    interior = cv2.morphologyEx(interior, cv2.MORPH_OPEN, k_clean, iterations=1)

    logger.info("[ROOMS-H] walls_px=%d, interior_px=%d, H=%d, W=%d",
                cv2.countNonZero(walls), cv2.countNonZero(interior), H, W)

    # 6. Surface minimale
    min_area_px = max(200, int(0.3 * ppm ** 2)) if ppm else 500

    # 7. Composantes connexes
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

        # Epsilon plus fin → contours plus précis pour les diagonales
        epsilon = 0.001 * cv2.arcLength(cnt_i, True)
        cnt_i = cv2.approxPolyDP(cnt_i, epsilon, True)

        x, y, w, h = cv2.boundingRect(cnt_i)
        cx = float(x + w / 2)
        cy = float(y + h / 2)
        area_m2 = area_px / (ppm ** 2) if ppm else None
        label, label_fr = _classify_room_by_area(area_m2)

        rooms_raw.append({
            "id": i,
            "type": label,
            "label_fr": label_fr,
            "centroid_norm": {"x": round(cx / W, 4), "y": round(cy / H, 4)},
            "bbox_norm": {
                "x": round(x / W, 4), "y": round(y / H, 4),
                "w": round(w / W, 4), "h": round(h / H, 4),
            },
            "area_m2": round(area_m2, 2) if area_m2 else None,
            "area_px2": area_px,
            "_polygon": cnt_i.reshape(-1, 2).tolist(),
            "polygon_norm": [
                {"x": round(float(pt[0]) / W, 5), "y": round(float(pt[1]) / H, 5)}
                for pt in cnt_i.reshape(-1, 2).tolist()
            ],
        })

    rooms_raw.sort(key=lambda r: r["area_px2"], reverse=True)

    # Labeling final avec compteurs par type
    label_counters: dict = {}
    rooms = []
    for r in rooms_raw:
        lbl = r["type"]
        label_counters[lbl] = label_counters.get(lbl, 0) + 1
        n = label_counters[lbl]
        if lbl == "living room":
            label_fr = "Séjour" if n == 1 else f"Séjour {n}"
        elif lbl == "bedroom":
            label_fr = "Chambre" if n == 1 else f"Chambre {n}"
        elif lbl == "bathroom":
            label_fr = "Salle de bain" if n == 1 else f"SDB {n}"
        elif lbl == "hallway":
            label_fr = "Couloir" if n == 1 else f"Couloir {n}"
        elif lbl == "kitchen":
            label_fr = "Cuisine" if n == 1 else f"Cuisine {n}"
        else:
            label_fr = f"Pièce {n}"
        rooms.append({**r, "label_fr": label_fr})

    return rooms


# ============================================================
# STEP 4 — PIPELINE H COMPLET
# ============================================================

def run_pipeline_h(img_rgb: np.ndarray, img_pil,
                   client, ppm: float, cfg: dict) -> dict:
    """Pipeline H : murs IA spécialiste + post-traitement diagonal.

    Stratégie :
    1. Portes/fenêtres : inférence 2 passes avec le modèle principal (même que A)
    2. Murs : modèle IA wall-detection-xi9ox/1 (même que la prod D/G),
       2 passes union — meilleure base de détection
    3. Post-traitement Hough multi-angles sur le masque murs IA :
       → vectorise tous les segments (y compris inclinés)
       → reconstruction masque propre depuis segments → union avec IA
    4. Segmentation pièces avec kernels elliptiques (ferme mieux les diagonales)
    5. Overlay orange des murs diagonaux pour comparaison visuelle
    """
    import time
    import pipeline as pip

    t0 = time.time()
    H, W = img_rgb.shape[:2]

    m_doors        = np.zeros((H, W), np.uint8)
    m_wins         = np.zeros((H, W), np.uint8)
    m_walls        = np.zeros((H, W), np.uint8)
    interior_mask  = None
    rooms_list     = []
    cnt            = None
    footprint_mask = None
    footprint_area_m2 = None
    walls_area_m2  = None
    hab_area_m2    = None
    error          = None
    wall_segments_all = []

    try:
        model_id = cfg.get("model_id", pip.DEFAULT_CONFIG["model_id"])

        # ── 1. Portes/fenêtres : modèle principal 2 passes (identique à A) ───
        _, _, md1, mw1, _, _, _ = pip.infer_pass(
            img_pil, client, model_id,
            cfg["pass1_tile"], cfg["pass1_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg,
        )
        md1 = pip.clean_mask(md1, cfg["min_area_door_px"], cfg["clean_close_k_door"])
        mw1 = pip.clean_mask(mw1, cfg["min_area_win_px"],  cfg["clean_close_k_win"])

        _, _, md2, mw2, _, _, _ = pip.infer_pass(
            img_pil, client, model_id,
            cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
            conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg,
        )
        md2 = pip.clean_mask(md2, cfg["min_area_door_px"], cfg["clean_close_k_door"])
        mw2 = pip.clean_mask(mw2, cfg["min_area_win_px"],  cfg["clean_close_k_win"])

        m_doors = cv2.bitwise_or(md1, md2)
        m_wins  = cv2.bitwise_or(mw1, mw2)

        # ── 2. Murs : modèle IA spécialiste (même que la prod D/G) ───────────
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
        m_walls_ai = cv2.bitwise_or(_ww1, _ww2)

        logger.info("[H] walls_ai=%d px, doors=%d px, windows=%d px",
                    cv2.countNonZero(m_walls_ai),
                    cv2.countNonZero(m_doors),
                    cv2.countNonZero(m_wins))

        # ── 3. Post-traitement diagonal sur le masque IA ──────────────────────
        # Hough vectorise les segments à tous les angles (y compris inclinés)
        segments = extract_wall_lines_hough(m_walls_ai, (H, W))
        wall_segments_all = segments

        if segments:
            # Reconstruction masque depuis les segments Hough (épaisseur uniforme)
            m_walls_hough = reconstruct_walls_from_lines(segments, H, W,
                                                         line_thickness=3)
            # Union : garde tout ce que l'IA a détecté + segments Hough vectorisés
            m_walls = cv2.bitwise_or(m_walls_ai, m_walls_hough)
        else:
            m_walls = m_walls_ai

        # ── 4. Empreinte (footprint) ───────────────────────────────────────────
        cnt, footprint_mask = pip._compute_footprint(m_walls, m_doors, m_wins, H, W)
        if cnt is not None and ppm is not None:
            footprint_area_m2 = float(cv2.contourArea(cnt)) / (ppm ** 2)

        # ── 5. Surface habitable ───────────────────────────────────────────────
        if cnt is not None:
            building = np.zeros((H, W), np.uint8)
            cv2.fillPoly(building, [cnt], 255)
            walls_bin = (m_walls > 0).astype(np.uint8) * 255
            if ppm is not None:
                wall_t_m = cfg.get("wall_thickness_m", 0.20)
                r_px = max(1, int(round((wall_t_m * ppm) / 2.0)))
            else:
                r_px = max(1, cfg.get("wall_thickness_px_fallback", 10) // 2)
            k_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                            (2 * r_px + 1, 2 * r_px + 1))
            walls_thick = cv2.dilate(walls_bin, k_w, iterations=1)
            walls_thick = cv2.bitwise_and(walls_thick, building)
            interior_mask = cv2.subtract(building, walls_thick)
            k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            interior_mask = cv2.morphologyEx(interior_mask, cv2.MORPH_OPEN,
                                             k2, iterations=1)
            if ppm is not None:
                walls_area_m2 = round(
                    float(cv2.countNonZero(walls_thick)) / (ppm ** 2), 2)
                hab_area_m2 = round(
                    float(cv2.countNonZero(interior_mask)) / (ppm ** 2), 2)

        # ── 6. Segmentation pièces (kernels elliptiques) ──────────────────────
        rooms_list = segment_rooms_diagonal(m_walls, m_doors, m_wins,
                                            cnt, H, W, ppm)

        # ── 7. Comptages ───────────────────────────────────────────────────────
        doors_count   = pip._count_connected_components(m_doors)
        windows_count = pip._count_connected_components(m_wins)

        # ── 8. Statistiques murs diagonaux ────────────────────────────────────
        diagonal_segments = [s for s in segments if s.get("is_diagonal")]
        h_segments        = [s for s in segments if s.get("is_horizontal")]
        v_segments        = [s for s in segments if s.get("is_vertical")]
        diagonal_pct = len(diagonal_segments) / max(len(segments), 1) * 100

        # ── 9. Overlays RGBA ───────────────────────────────────────────────────
        mask_doors_b64 = (
            pip._np_to_b64(pip._mask_to_rgba(m_doors, (217, 70, 239), 90))
            if cv2.countNonZero(m_doors) > 0 else None
        )
        mask_windows_b64 = (
            pip._np_to_b64(pip._mask_to_rgba(m_wins, (34, 211, 238), 90))
            if cv2.countNonZero(m_wins) > 0 else None
        )
        mask_walls_b64 = (
            pip._np_to_b64(pip._mask_to_rgba(m_walls, (96, 165, 250), 90))
            if cv2.countNonZero(m_walls) > 0 else None
        )
        mask_rooms_b64 = (
            pip._np_to_b64(pip._build_rooms_color_mask(rooms_list, H, W))
            if rooms_list else None
        )
        mask_footprint_b64 = (
            pip._np_to_b64(pip._mask_to_rgba(footprint_mask, (251, 191, 36), 50))
            if footprint_mask is not None
            and cv2.countNonZero(footprint_mask) > 0 else None
        )
        mask_hab_b64 = (
            pip._np_to_b64(pip._mask_to_rgba(interior_mask, (74, 222, 128), 60))
            if interior_mask is not None
            and cv2.countNonZero(interior_mask) > 0 else None
        )

        # Overlay spécial : murs diagonaux en orange
        mask_diagonal_walls = np.zeros((H, W), np.uint8)
        for seg in diagonal_segments:
            cv2.line(mask_diagonal_walls,
                     (seg["x1"], seg["y1"]), (seg["x2"], seg["y2"]),
                     255, 3, cv2.LINE_AA)
        mask_diagonal_b64 = (
            pip._np_to_b64(pip._mask_to_rgba(mask_diagonal_walls,
                                              (249, 115, 22), 200))
            if cv2.countNonZero(mask_diagonal_walls) > 0 else None
        )

    except Exception as e:
        error = str(e)
        logger.error("Pipeline H failed: %s", e, exc_info=True)
        doors_count = windows_count = 0
        diagonal_pct = 0.0
        diagonal_segments = h_segments = v_segments = []
        mask_doors_b64 = mask_windows_b64 = mask_walls_b64 = None
        mask_rooms_b64 = mask_footprint_b64 = mask_hab_b64 = None
        mask_diagonal_b64 = None

    elapsed = time.time() - t0

    # Sérialiser les segments pour le JSON
    wall_segments_json = [
        {
            "x1_norm": s["x1_norm"], "y1_norm": s["y1_norm"],
            "x2_norm": s["x2_norm"], "y2_norm": s["y2_norm"],
            "length_m": round(s["length_px"] / ppm, 2) if ppm else None,
            "angle_deg": s["angle_deg"],
            "is_diagonal": s["is_diagonal"],
        }
        for s in wall_segments_all
    ]

    return {
        "id": "H",
        "name": "Diagonal (H)",
        "description": "Murs IA (wall-detection-xi9ox) + Hough multi-angles → murs inclinés",
        "color": "#06B6D4",  # cyan
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
        # Champs spécifiques Pipeline H
        "is_diagonal": True,
        "mask_diagonal_walls_b64": mask_diagonal_b64,
        "wall_segments": wall_segments_json,
        "diagonal_stats": {
            "total_segments": len(wall_segments_all),
            "diagonal_segments": len(diagonal_segments),
            "horizontal_segments": len(h_segments),
            "vertical_segments": len(v_segments),
            "diagonal_pct": round(diagonal_pct, 1),
        },
        # Raw masks pour consensus éventuel
        "_m_doors_raw": m_doors,
        "_m_windows_raw": m_wins,
        "_m_walls_raw": m_walls,
    }
