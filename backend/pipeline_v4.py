"""
pipeline_v4.py — Pipeline W : détection murs pure CV multi-angles
==================================================================

Stratégie : 100% Computer Vision pour les murs (aucun modèle Roboflow murs),
combinée avec IA pour portes/fenêtres uniquement.

Pourquoi ça marche mieux sur les plans en biais :
  - OTSU/IA sont biaisés vers l'horizontal/vertical
  - Ici : LSD (Line Segment Detector) détecte les segments à tout angle
  - Morphologie directionnelle : kernels orientés selon les angles dominants
  - Filtrage par épaisseur : seuls les traits assez épais sont des murs
  - Color-aware : exclut meubles/décoration sur plans colorés

Pipeline :
  1. Murs         → _detect_walls_v4 (LSD + morpho directionnelle + filtrage)
  2. Portes/Fen.  → modèle IA principal (A) + passes diagonales adaptatives
  3. Empreinte    → _compute_footprint_diagonal (kernel elliptique)
  4. Surface      → calcul standard
  5. Pièces       → segment_rooms_diagonal (kernel elliptique adaptatif)
  6. Stats        → Hough pour overlay info

CHANGELOG
---------
- v4.0 : création — LSD + morpho directionnelle + color filtering
"""

import math
import time
import logging
import numpy as np
import cv2

logger = logging.getLogger(__name__)


# ============================================================
# WALL DETECTION V4 — Pure CV, angle-agnostic
# ============================================================

def _detect_walls_v4(img_rgb: np.ndarray,
                     wall_thickness_range: tuple = (3, 50),
                     text_max_area: int = 300) -> np.ndarray:
    """Détection de murs pure CV, optimisée pour plans avec murs en biais.

    Étapes :
      1. Filtrage couleur HSV → exclure meubles/mobilier coloré
      2. Seuillage adaptatif + OTSU → capturer lignes sombres
      3. Filtrage par épaisseur → garder uniquement les traits d'épaisseur "mur"
      4. LSD (Line Segment Detector) → détecter les segments à tout angle
      5. Reconstruction directionnelle → épaissir les segments LSD
      6. Fusion seuil + LSD → masque final robuste

    Retourne un masque binaire uint8 (0/255).
    """
    H, W = img_rgb.shape[:2]
    min_thick, max_thick = wall_thickness_range

    # ── 1. Color-aware preprocessing ──────────────────────────
    hsv = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2HSV)
    _, s_ch, v_ch = cv2.split(hsv)
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # Masque couleur : zones saturées = meubles/déco (exclure)
    _, color_mask = cv2.threshold(s_ch, 45, 255, cv2.THRESH_BINARY)
    # Dilater légèrement pour couvrir les bords des meubles
    k_color = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    color_mask = cv2.dilate(color_mask, k_color, iterations=1)

    # ── 2. Double seuillage (OTSU + adaptatif) ───────────────
    # OTSU global
    _, binary_otsu = cv2.threshold(v_ch, 0, 255,
                                   cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Adaptatif local (rattrape les murs dans les zones de contraste variable)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    binary_adapt = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, blockSize=51, C=12)

    # Union des deux seuillages
    binary = cv2.bitwise_or(binary_otsu, binary_adapt)

    # Soustraire les zones colorées (meubles, mobilier)
    binary = cv2.subtract(binary, color_mask)

    # ── 3. Filtrage morphologique par épaisseur ──────────────
    # Open pour supprimer le texte et les lignes fines (< min_thick px)
    k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                       (min_thick, min_thick))
    walls_thick = cv2.morphologyEx(binary, cv2.MORPH_OPEN, k_open, iterations=1)

    # Fermeture pour reconnecter les segments de murs interrompus
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    walls_thick = cv2.morphologyEx(walls_thick, cv2.MORPH_CLOSE,
                                   k_close, iterations=2)

    # Supprimer les petits composants (texte résiduel, artefacts)
    walls_thick = _remove_small_components(walls_thick, min_area=text_max_area)

    logger.info("[W-walls] after thickness filter: %d px (%.1f%%)",
                cv2.countNonZero(walls_thick),
                cv2.countNonZero(walls_thick) / (H * W) * 100)

    # ── 4. LSD (Line Segment Detector) — détecte segments à tout angle ──
    lsd_mask = _detect_walls_lsd(gray, color_mask, H, W,
                                 min_length=max(15, int(min(H, W) * 0.015)),
                                 thickness=max(2, min_thick))

    # ── 5. Morphologie directionnelle sur angles dominants ───
    dominant_angles = _detect_dominant_angles_fast(walls_thick, H, W)
    if dominant_angles:
        directional_mask = _directional_close(walls_thick, dominant_angles,
                                              gap_px=max(8, int(min(H, W) * 0.008)))
        walls_thick = cv2.bitwise_or(walls_thick, directional_mask)
        logger.info("[W-walls] directional close at angles %s", dominant_angles)

    # ── 6. Fusion : seuil morpho + LSD ─────────────────────
    # LSD capture les murs fins que le seuil rate, et vice-versa
    combined = cv2.bitwise_or(walls_thick, lsd_mask)

    # Nettoyage final léger
    k_final = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, k_final, iterations=1)
    combined = _remove_small_components(combined, min_area=200)

    logger.info("[W-walls] final: %d px (%.1f%%)",
                cv2.countNonZero(combined),
                cv2.countNonZero(combined) / (H * W) * 100)

    return combined


def _detect_walls_lsd(gray: np.ndarray, color_mask: np.ndarray,
                      H: int, W: int,
                      min_length: int = 20,
                      thickness: int = 3) -> np.ndarray:
    """Détecte les segments de murs via LSD ou Canny+Hough (fallback).

    Tente LSD d'abord (meilleur pour les diagonales), puis fallback
    sur Canny+HoughLinesP si LSD n'est pas disponible (opencv-headless).
    """
    # Préparer l'image : lisser pour réduire le bruit texte
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)

    # Masquer les zones colorées (remplacer par blanc = fond)
    if color_mask is not None and cv2.countNonZero(color_mask) > 0:
        blurred[color_mask > 0] = 255

    mask = np.zeros((H, W), np.uint8)

    # ── Tenter LSD (disponible dans opencv-contrib ou opencv >= 4.8) ──
    try:
        lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
        lines_result = lsd.detect(blurred)
        segments = lines_result[0]
        widths = lines_result[1] if len(lines_result) > 1 else None

        if segments is not None:
            n_kept = 0
            for i, seg in enumerate(segments):
                x1, y1, x2, y2 = seg[0]
                length = math.hypot(x2 - x1, y2 - y1)
                if length < min_length:
                    continue
                width = widths[i][0] if widths is not None else 1.0
                if width < 1.5 and length < min_length * 3:
                    continue
                draw_thick = max(thickness, int(width * 0.8))
                cv2.line(mask, (int(x1), int(y1)), (int(x2), int(y2)),
                         255, draw_thick, cv2.LINE_AA)
                n_kept += 1
            logger.info("[W-lsd] LSD: %d/%d segments kept", n_kept, len(segments))
            return mask

    except (cv2.error, AttributeError):
        logger.info("[W-lsd] LSD not available, using Canny+Hough fallback")

    # ── Fallback : Canny + HoughLinesP (fonctionne partout) ──
    edges = cv2.Canny(blurred, 50, 150, apertureSize=3)

    # Masquer les zones colorées dans les edges aussi
    if color_mask is not None and cv2.countNonZero(color_mask) > 0:
        edges[color_mask > 0] = 0

    min_dim = min(H, W)
    max_gap = max(5, int(min_dim * 0.008))

    lines = cv2.HoughLinesP(edges, rho=1, theta=np.pi / 180,
                            threshold=20, minLineLength=min_length,
                            maxLineGap=max_gap)

    if lines is None:
        logger.info("[W-lsd] Hough fallback: no segments detected")
        return mask

    n_kept = 0
    for line in lines:
        x1, y1, x2, y2 = map(int, line[0])
        length = math.hypot(x2 - x1, y2 - y1)
        if length < min_length:
            continue
        cv2.line(mask, (x1, y1), (x2, y2), 255, thickness, cv2.LINE_AA)
        n_kept += 1

    logger.info("[W-lsd] Hough fallback: %d/%d segments kept",
                n_kept, len(lines))
    return mask


def _detect_dominant_angles_fast(walls_mask: np.ndarray,
                                 H: int, W: int,
                                 ortho_tolerance: float = 12.0,
                                 max_angles: int = 4) -> list:
    """Détecte rapidement les angles dominants non-orthogonaux.

    Utilise Hough sur le masque de murs existant (pas besoin de Canny).
    Retourne les angles en degrés (0-180) des directions significatives.
    """
    if cv2.countNonZero(walls_mask) == 0:
        return []

    min_dim = min(H, W)
    min_len = max(15, int(min_dim * 0.02))
    max_gap = max(5, int(min_dim * 0.008))

    lines = cv2.HoughLinesP(walls_mask, rho=1, theta=np.pi / 180,
                            threshold=25, minLineLength=min_len,
                            maxLineGap=max_gap)
    if lines is None:
        return []

    angles = []
    for line in lines:
        x1, y1, x2, y2 = map(int, line[0])
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180
        # Filtrer les angles orthogonaux
        if ortho_tolerance < angle < (180.0 - ortho_tolerance) and \
           not (90.0 - ortho_tolerance < angle < 90.0 + ortho_tolerance):
            angles.append(angle)

    if not angles:
        return []

    # Clustering simple
    angles.sort()
    clusters = []
    for a in angles:
        placed = False
        for idx, (centre, cnt) in enumerate(clusters):
            if abs(a - centre) <= 6.0:
                clusters[idx] = ((centre * cnt + a) / (cnt + 1), cnt + 1)
                placed = True
                break
        if not placed:
            clusters.append((a, 1))

    clusters.sort(key=lambda x: x[1], reverse=True)
    result = [round(c, 1) for c, n in clusters[:max_angles] if n >= 3]

    return result


def _directional_close(mask: np.ndarray, angles: list,
                       gap_px: int = 10) -> np.ndarray:
    """Fermeture morphologique directionnelle selon les angles dominants.

    Pour chaque angle dominant, crée un kernel linéaire orienté et applique
    une fermeture. Cela ponte les micro-interruptions dans les murs
    en biais sans affecter les murs orthogonaux.
    """
    H, W = mask.shape[:2]
    result = np.zeros((H, W), np.uint8)

    for angle_deg in angles:
        # Créer un kernel linéaire orienté
        k_len = max(5, gap_px)
        k = _make_line_kernel(k_len, angle_deg)

        # Fermeture directionnelle
        closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=1)

        # Garder uniquement les pixels ajoutés qui sont proches de murs existants
        added = cv2.subtract(closed, mask)
        # Dilater le masque original légèrement pour définir la zone de proximité
        k_prox = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                           (gap_px * 2 + 1, gap_px * 2 + 1))
        proximity = cv2.dilate(mask, k_prox, iterations=1)
        added = cv2.bitwise_and(added, proximity)

        result = cv2.bitwise_or(result, added)

    return result


def _make_line_kernel(length: int, angle_deg: float) -> np.ndarray:
    """Crée un kernel morphologique linéaire orienté."""
    size = max(3, length)
    if size % 2 == 0:
        size += 1
    center = size // 2

    k = np.zeros((size, size), np.uint8)
    angle_rad = math.radians(angle_deg)
    dx = math.cos(angle_rad)
    dy = math.sin(angle_rad)

    for i in range(-center, center + 1):
        x = int(round(center + i * dx))
        y = int(round(center + i * dy))
        if 0 <= x < size and 0 <= y < size:
            k[y, x] = 1

    # S'assurer que le kernel n'est pas vide
    if np.sum(k) == 0:
        k[center, center] = 1

    return k


def _remove_small_components(mask: np.ndarray, min_area: int = 200) -> np.ndarray:
    """Supprime les composantes connexes plus petites que min_area."""
    if cv2.countNonZero(mask) == 0:
        return mask

    num, labels, stats, _ = cv2.connectedComponentsWithStats(
        (mask > 0).astype(np.uint8), connectivity=8)

    out = np.zeros_like(mask)
    for i in range(1, num):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            out[labels == i] = 255

    return out


# ============================================================
# PIPELINE W — Point d'entrée principal
# ============================================================

def run_pipeline_w(img_rgb: np.ndarray, img_pil,
                   client, ppm: float, cfg: dict) -> dict:
    """Pipeline W : murs pure CV (LSD + morpho directionnelle) + IA portes/fenêtres.

    Avantages vs pipelines existants :
    - Murs détectés par CV pure → fonctionne à tout angle
    - LSD détecte les segments diagonaux que Roboflow rate
    - Morphologie directionnelle ferme les gaps dans les murs en biais
    - Color-aware : exclut le mobilier illustré
    """
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

    try:
        # ── 0. Sélection du modèle IA pour portes/fenêtres ───
        _mid = cfg.get("model_id", pip.DEFAULT_CONFIG["model_id"])
        model_id = pip.DEFAULT_CONFIG["model_id"] if _mid == "pure_cv_walls" else _mid

        # ── 1. Murs par CV pure ──────────────────────────────
        # Adapter l'épaisseur min selon le ppm si disponible
        if ppm is not None:
            # Mur minimum ~5cm en pixels, max ~40cm
            min_thick_px = max(2, int(0.05 * ppm))
            max_thick_px = max(10, int(0.40 * ppm))
            text_max_area = max(200, int(0.08 * ppm ** 2))  # ~0.08 m²
        else:
            min_thick_px = 3
            max_thick_px = 50
            text_max_area = 300

        m_walls = _detect_walls_v4(img_rgb,
                                   wall_thickness_range=(min_thick_px, max_thick_px),
                                   text_max_area=text_max_area)
        logger.info("[W] walls_cv=%d px", cv2.countNonZero(m_walls))

        # ── 2. Portes/fenêtres par IA (2 passes standard) ───
        _, _, md1, mw1, _, _, _ = pip.infer_pass(
            img_pil, client, model_id,
            cfg["pass1_tile"], cfg["pass1_over"],
            write_rooms=False,
            conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg)
        _, _, md2, mw2, _, _, _ = pip.infer_pass(
            img_pil, client, model_id,
            cfg["pass2_tile"], cfg["pass2_over"],
            write_rooms=False,
            conf_min_door=cfg["conf_min_door"],
            conf_min_win=cfg["conf_min_win"], cfg=cfg)
        m_doors = cv2.bitwise_or(
            pip.clean_mask(md1, cfg["min_area_door_px"], cfg["clean_close_k_door"]),
            pip.clean_mask(md2, cfg["min_area_door_px"], cfg["clean_close_k_door"]))
        m_wins = cv2.bitwise_or(
            pip.clean_mask(mw1, cfg["min_area_win_px"], cfg["clean_close_k_win"]),
            pip.clean_mask(mw2, cfg["min_area_win_px"], cfg["clean_close_k_win"]))

        # ── 2b. Passes diagonales adaptatives pour portes/fenêtres ──
        dominant_angles = _detect_dominant_angles_fast(m_walls, H, W)
        if dominant_angles:
            from pipeline_diagonal import _infer_diagonal_openings
            rotation_angles = []
            for a in dominant_angles:
                # Rotation pour aligner les diagonales sur l'horizontale
                rotation_angles.append(-(a - 90.0))
                rotation_angles.append(-a)

            # Filtrer les quasi-orthogonaux
            filtered = []
            seen = set()
            for ra in rotation_angles:
                ra_norm = ra % 360
                close_to_ortho = any(
                    abs((ra_norm - o) % 360) < 10 or abs((ra_norm - o) % 360) > 350
                    for o in [0, 90, 180, 270])
                key = round(ra_norm, 0)
                if not close_to_ortho and key not in seen:
                    seen.add(key)
                    filtered.append(ra)

            if filtered:
                logger.info("[W] diagonal door/win passes at angles: %s", filtered)
                md_diag, mw_diag = _infer_diagonal_openings(
                    img_rgb, img_pil, client, model_id, angles=filtered,
                    conf_min_door=cfg["conf_min_door"],
                    conf_min_win=cfg["conf_min_win"], cfg=cfg)
                if cv2.countNonZero(md_diag) > 0:
                    m_doors = cv2.bitwise_or(m_doors,
                        pip.clean_mask(md_diag, cfg["min_area_door_px"],
                                       cfg["clean_close_k_door"]))
                if cv2.countNonZero(mw_diag) > 0:
                    m_wins = cv2.bitwise_or(m_wins,
                        pip.clean_mask(mw_diag, cfg["min_area_win_px"],
                                       cfg["clean_close_k_win"]))

        logger.info("[W] doors=%d px, windows=%d px",
                    cv2.countNonZero(m_doors), cv2.countNonZero(m_wins))

        # ── 3. Empreinte (méthode diagonale elliptique) ──────
        from pipeline_diagonal import (_compute_footprint_diagonal,
                                       _rebuild_walls_for_footprint,
                                       segment_rooms_diagonal,
                                       _hough_stats)

        m_walls_for_fp = _rebuild_walls_for_footprint(m_walls, H, W, ppm)
        cnt, footprint_mask = _compute_footprint_diagonal(
            m_walls_for_fp, m_doors, m_wins, H, W)

        if cnt is None:
            logger.warning("[W] Footprint not found, trying standard method")
            cnt, footprint_mask = pip._compute_footprint(m_walls, m_doors, m_wins, H, W)

        if cnt is not None and ppm is not None:
            footprint_area_m2 = float(cv2.contourArea(cnt)) / (ppm ** 2)

        # ── 4. Surface habitable ─────────────────────────────
        if cnt is not None:
            building = np.zeros((H, W), np.uint8)
            cv2.fillPoly(building, [cnt], 255)
            walls_bin = (m_walls > 0).astype(np.uint8) * 255
            r_px = (max(1, int(round(
                (cfg.get("wall_thickness_m", 0.20) * ppm) / 2.0)))
                if ppm is not None
                else max(1, cfg.get("wall_thickness_px_fallback", 10) // 2))
            k_w = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (2 * r_px + 1, 2 * r_px + 1))
            walls_thick = cv2.bitwise_and(
                cv2.dilate(walls_bin, k_w), building)
            interior_mask = cv2.morphologyEx(
                cv2.subtract(building, walls_thick),
                cv2.MORPH_OPEN,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
                iterations=1)
            if ppm is not None:
                walls_area_m2 = round(
                    cv2.countNonZero(walls_thick) / ppm ** 2, 2)
                hab_area_m2 = round(
                    cv2.countNonZero(interior_mask) / ppm ** 2, 2)

        # ── 5. Segmentation pièces (méthode diagonale) ───────
        rooms_list = segment_rooms_diagonal(
            m_walls, m_doors, m_wins, cnt, H, W, ppm)

        # ── 6. Comptages ─────────────────────────────────────
        doors_count = pip._count_connected_components(m_doors)
        windows_count = pip._count_connected_components(m_wins)

        # ── 7. Stats Hough ───────────────────────────────────
        all_segs, diag_segs, h_segs, v_segs = _hough_stats(m_walls, H, W)
        diagonal_pct = len(diag_segs) / max(len(all_segs), 1) * 100

        # ── 8. Overlays ──────────────────────────────────────
        def _ov(mask, color, alpha):
            return (pip._np_to_b64(pip._mask_to_rgba(mask, color, alpha))
                    if cv2.countNonZero(mask) > 0 else None)

        mask_doors_b64 = _ov(m_doors, (217, 70, 239), 90)
        mask_windows_b64 = _ov(m_wins, (34, 211, 238), 90)
        mask_walls_b64 = _ov(m_walls, (96, 165, 250), 90)
        mask_rooms_b64 = (
            pip._np_to_b64(pip._build_rooms_color_mask(rooms_list, H, W))
            if rooms_list else None)
        mask_footprint_b64 = (
            pip._np_to_b64(pip._mask_to_rgba(footprint_mask, (251, 191, 36), 50))
            if footprint_mask is not None
            and cv2.countNonZero(footprint_mask) > 0 else None)
        mask_hab_b64 = (
            pip._np_to_b64(pip._mask_to_rgba(interior_mask, (74, 222, 128), 60))
            if interior_mask is not None
            and cv2.countNonZero(interior_mask) > 0 else None)

        # Overlay segments diagonaux
        diag_overlay = np.zeros((H, W), np.uint8)
        for seg in diag_segs:
            cv2.line(diag_overlay,
                     (seg["x1"], seg["y1"]),
                     (seg["x2"], seg["y2"]), 255, 3, cv2.LINE_AA)
        mask_diagonal_b64 = _ov(diag_overlay, (249, 115, 22), 200)

    except Exception as e:
        error = str(e)
        logger.error("Pipeline W failed: %s", e, exc_info=True)

    elapsed = time.time() - t0

    return {
        "id": "W",
        "name": "Pure CV Walls (W)",
        "description": "Murs LSD+morpho directionnelle (CV pure) "
                       "+ portes/fenêtres IA + segmentation diagonale",
        "color": "#06B6D4",  # cyan
        "doors_count": doors_count,
        "windows_count": windows_count,
        "mask_doors_b64": mask_doors_b64,
        "mask_windows_b64": mask_windows_b64,
        "mask_walls_b64": mask_walls_b64,
        "mask_footprint_b64": mask_footprint_b64,
        "mask_hab_b64": mask_hab_b64,
        "footprint_area_m2": (round(footprint_area_m2, 2)
                              if footprint_area_m2 else None),
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
                "length_m": (round(s["length_px"] / ppm, 2)
                             if ppm else None),
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
            "dominant_angles": _detect_dominant_angles_fast(m_walls, H, W)
                               if cv2.countNonZero(m_walls) > 0 else [],
        },
        # Masques bruts pour session storage (éditeur)
        "_m_doors_raw": m_doors,
        "_m_windows_raw": m_wins,
        "_m_walls_raw": m_walls,
    }
