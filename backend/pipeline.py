# pipeline.py — Logique extraite du notebook floor_plan_module_09_02
# Adaptée pour être appelée depuis FastAPI

import os, io, json, math, time, tempfile, base64, logging
import numpy as np
import cv2
from PIL import Image
import fitz  # PyMuPDF

logger = logging.getLogger(__name__)


# ============================================================
# CONFIG (peut être surchargée depuis les paramètres API)
# ============================================================
DEFAULT_CONFIG = {
    "api_key": "Kh56un5foPflRVreiNOM",
    "model_id": "cubicasa5k-2-qpmsa-1gd2e/1",
    "assumed_door_width_m": 0.80,
    "wall_thickness_m": 0.20,
    "wall_thickness_px_fallback": 10,
    "door_len_px_min": 25,
    "door_len_px_max": 90,
    "min_doors_for_scale": 3,
    "pass1_tile": 2048,
    "pass1_over": 512,
    "pass2_tile": 1024,
    "pass2_over": 256,
    "conf_min_door": 0.05,
    "conf_min_win": 0.15,
    "clean_close_k_door": 3,
    "clean_close_k_win": 5,
    "min_area_door_px": 6,
    "min_area_win_px": 15,
    "use_geom_filter_for_doors": False,
    "door_ar_min": 1.25,
    "door_len_min_px": 10,
    "door_len_max_px": 600,
    "door_area_max_px": 200000,
}

# Labels structurels à exclure des pièces détectées
SKIP_ROOM_LABELS: set = {
    "wall", "walls", "floor", "ceiling", "staircase", "stairs",
    "elevator", "lift", "void", "exterior", "outdoor", "background",
    "other", "unknown", "column", "pillar", "beam", "door", "window",
    "doorway", "opening",
}

# Correspondances labels Roboflow (anglais) → français
ROOM_LABELS_FR: dict = {
    "bedroom": "Chambre",
    "kitchen": "Cuisine",
    "bathroom": "Salle de bain",
    "living room": "Séjour",
    "living": "Séjour",
    "dining room": "Salle à manger",
    "hallway": "Couloir",
    "corridor": "Couloir",
    "office": "Bureau",
    "study": "Bureau",
    "wc": "WC",
    "toilet": "WC",
    "storage": "Rangement",
    "closet": "Rangement",
    "garage": "Garage",
    "balcony": "Balcon",
    "terrace": "Terrasse",
    "laundry": "Buanderie",
    "cellar": "Cave",
}


# ============================================================
# STEP 1 — PDF → PNG (zoom ×3)
# ============================================================
def get_pdf_page_count(pdf_bytes: bytes) -> int:
    """Retourne le nombre de pages d'un PDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return len(doc)
    finally:
        doc.close()

def pdf_to_image(pdf_bytes: bytes, zoom: float = 3.0, page_index: int = 0) -> np.ndarray:
    """Rendu d'une page d'un PDF en numpy RGB array."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_index = max(0, min(page_index, len(doc) - 1))
        page = doc[page_index]
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_pil = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        return np.array(img_pil)
    finally:
        doc.close()


# ============================================================
# STEP 2 — CROP
# ============================================================
def crop_image(img: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> np.ndarray:
    H, W = img.shape[:2]
    xa, xb = sorted([int(x0), int(x1)])
    ya, yb = sorted([int(y0), int(y1)])
    xa = max(0, min(xa, W-1)); xb = max(0, min(xb, W-1))
    ya = max(0, min(ya, H-1)); yb = max(0, min(yb, H-1))
    return img[ya:yb, xa:xb]


# ============================================================
# STEP 3 — CALIBRATION (optionnel, sinon auto depuis portes)
# ============================================================
def compute_scale(x1: float, y1: float, x2: float, y2: float, real_m: float) -> float:
    if real_m <= 0:
        raise ValueError("real_m must be > 0")
    dist_px = math.hypot(x2 - x1, y2 - y1)
    if dist_px < 1e-6:
        raise ValueError("Points are too close together")
    return dist_px / real_m


# ============================================================
# AUTO-CALIBRATION CROSS-CHECK (multi-source PPM consensus)
# ============================================================

def _ppm_from_doors(df_openings, cfg) -> dict | None:
    """Estimate PPM from detected door widths (existing method)."""
    if df_openings is None or df_openings.empty:
        return None
    doors = df_openings[df_openings["class"] == "door"]
    if len(doors) < 1:
        return None
    doors_f = doors[
        (doors["length_px"] >= cfg["door_len_px_min"]) &
        (doors["length_px"] <= cfg["door_len_px_max"])
    ]
    use = doors_f if len(doors_f) >= cfg["min_doors_for_scale"] else doors
    n_used = len(use)
    median_px = float(np.median(use["length_px"].values))
    std_px = float(np.std(use["length_px"].values)) if n_used > 1 else median_px * 0.3
    ppm = median_px / cfg["assumed_door_width_m"]
    # Confidence: more doors + lower std → higher confidence
    cv = std_px / median_px if median_px > 0 else 1.0  # coefficient of variation
    conf = min(0.85, 0.4 + 0.1 * min(n_used, 5) - cv * 0.3)
    conf = max(0.15, conf)
    return {"ppm": ppm, "confidence": round(conf, 2), "source": "doors",
            "detail": f"{n_used} doors, median={median_px:.1f}px, CV={cv:.2f}"}


def _ppm_from_dimension_lines(img_gray: np.ndarray, cfg) -> dict | None:
    """Detect dimension annotations (cotes cotées) via OCR + line proximity.

    Finds decimal numbers like '3.50' or '5,20' near horizontal/vertical lines
    and computes PPM = line_length_px / value_meters.
    """
    import re
    try:
        import pytesseract
    except ImportError:
        return None

    H, W = img_gray.shape[:2]

    # Run OCR with bounding box data
    try:
        ocr_data = pytesseract.image_to_data(
            img_gray, lang="fra+eng", output_type=pytesseract.Output.DICT,
            config="--psm 11"  # sparse text: find as much text as possible
        )
    except Exception:
        try:
            ocr_data = pytesseract.image_to_data(
                img_gray, output_type=pytesseract.Output.DICT,
                config="--psm 11"
            )
        except Exception as e:
            logger.warning("Dimension line OCR failed: %s", e)
            return None

    # Pattern: decimal numbers likely to be dimensions (0.50 → 15.00 range)
    dim_pattern = re.compile(r"^(\d{1,2})[.,](\d{2})$")

    # Collect dimension candidates: (value_m, cx, cy, text_w, text_h)
    dim_candidates = []
    n_words = len(ocr_data.get("text", []))
    for i in range(n_words):
        text = str(ocr_data["text"][i]).strip()
        conf_val = int(ocr_data["conf"][i]) if ocr_data["conf"][i] != "-1" else 0
        if conf_val < 40:
            continue
        m = dim_pattern.match(text)
        if not m:
            continue
        value_m = float(f"{m.group(1)}.{m.group(2)}")
        if value_m < 0.30 or value_m > 25.0:  # Plausible architectural range
            continue
        bx = int(ocr_data["left"][i])
        by = int(ocr_data["top"][i])
        bw = int(ocr_data["width"][i])
        bh = int(ocr_data["height"][i])
        cx = bx + bw / 2
        cy = by + bh / 2
        dim_candidates.append({
            "value_m": value_m, "cx": cx, "cy": cy,
            "bw": bw, "bh": bh, "text": text, "conf": conf_val,
        })

    if not dim_candidates:
        return None

    # Detect lines using Hough transform (looking for dimension/cote lines)
    blurred = cv2.GaussianBlur(img_gray, (3, 3), 0)
    edges = cv2.Canny(blurred, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=50,
                            minLineLength=max(30, min(W, H) * 0.02),
                            maxLineGap=10)
    if lines is None or len(lines) == 0:
        return None

    # Filter for near-horizontal or near-vertical lines
    hv_lines = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        dx, dy = abs(x2 - x1), abs(y2 - y1)
        length = math.hypot(dx, dy)
        if length < 20:
            continue
        angle = math.degrees(math.atan2(dy, dx))
        if angle < 8 or angle > 82:  # Near-horizontal or near-vertical
            hv_lines.append({
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "length": length,
                "mx": (x1 + x2) / 2, "my": (y1 + y2) / 2,
                "horizontal": angle < 8,
            })

    if not hv_lines:
        return None

    # Match each dimension text to the nearest line
    ppm_estimates = []
    search_radius = max(60, min(W, H) * 0.05)  # Search within 5% of image size

    for dim in dim_candidates:
        best_line = None
        best_dist = search_radius
        for ln in hv_lines:
            # Distance from text center to line midpoint
            dist = math.hypot(dim["cx"] - ln["mx"], dim["cy"] - ln["my"])
            # Also check if text is near the line itself (perpendicular distance)
            perp_dist = _point_to_segment_dist(dim["cx"], dim["cy"],
                                               ln["x1"], ln["y1"], ln["x2"], ln["y2"])
            effective_dist = min(dist, perp_dist * 1.5)
            if effective_dist < best_dist:
                best_dist = effective_dist
                best_line = ln

        if best_line is not None:
            ppm_est = best_line["length"] / dim["value_m"]
            # Sanity check: PPM should be reasonable (5 to 500 px/m for typical plans)
            if 5 < ppm_est < 500:
                ppm_estimates.append({
                    "ppm": ppm_est,
                    "text": dim["text"],
                    "value_m": dim["value_m"],
                    "line_px": best_line["length"],
                    "dist_to_line": best_dist,
                })

    if not ppm_estimates:
        return None

    # Use median of estimates (robust to outliers)
    ppms = [e["ppm"] for e in ppm_estimates]
    median_ppm = float(np.median(ppms))

    # Filter outliers (keep within 30% of median)
    inliers = [p for p in ppms if abs(p - median_ppm) / median_ppm < 0.30]
    if len(inliers) < 1:
        inliers = ppms

    final_ppm = float(np.median(inliers))
    std_ppm = float(np.std(inliers)) if len(inliers) > 1 else final_ppm * 0.2
    cv = std_ppm / final_ppm if final_ppm > 0 else 1.0

    # Confidence: more matching pairs + lower variance → higher
    conf = min(0.92, 0.45 + 0.12 * min(len(inliers), 5) - cv * 0.2)
    conf = max(0.20, conf)

    return {"ppm": final_ppm, "confidence": round(conf, 2), "source": "dimension_lines",
            "detail": f"{len(inliers)}/{len(ppm_estimates)} cotes, median={final_ppm:.1f}px/m, CV={cv:.2f}"}


def _ppm_from_cartouche_scale(img_rgb: np.ndarray) -> dict | None:
    """Try to extract scale from cartouche (e.g. 1:100) and estimate PPM.

    Without known DPI this is imprecise, but we can estimate DPI from image size:
    - A4 landscape = 297mm wide → at 150 DPI = 1754px, at 200 DPI = 2339px
    - A3 landscape = 420mm wide → at 150 DPI = 2480px, at 200 DPI = 3307px
    """
    import re
    try:
        import pytesseract
    except ImportError:
        return None

    H, W = img_rgb.shape[:2]

    # Extract cartouche text
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # Search bottom-right 45% x 35% for cartouche
    roi_x = int(W * 0.55)
    roi_y = int(H * 0.65)
    roi = gray[roi_y:, roi_x:]

    try:
        ocr_text = pytesseract.image_to_string(roi, lang="fra+eng")
    except Exception:
        try:
            ocr_text = pytesseract.image_to_string(roi)
        except Exception:
            return None

    # Find scale pattern
    scale_match = re.search(r"(?:échelle|echelle|scale|ech\.?)\s*[:;]?\s*1\s*[:/]\s*(\d+)", ocr_text, re.IGNORECASE)
    if not scale_match:
        scale_match = re.search(r"1\s*[:/]\s*(\d+)", ocr_text)
    if not scale_match:
        return None

    denominator = int(scale_match.group(1))
    if denominator < 10 or denominator > 1000:
        return None

    # Estimate DPI from image dimensions
    # Common architectural paper sizes (landscape): A4=297mm, A3=420mm, A2=594mm, A1=841mm, A0=1189mm
    paper_widths_mm = [297, 420, 594, 841, 1189]
    common_dpis = [72, 96, 150, 200, 300]

    best_dpi = 150  # default assumption
    best_score = 999

    for pw_mm in paper_widths_mm:
        for dpi in common_dpis:
            expected_px = pw_mm / 25.4 * dpi
            # How well does this match actual width?
            ratio = W / expected_px
            if 0.85 < ratio < 1.15:  # Within 15% match
                score = abs(ratio - 1.0)
                if score < best_score:
                    best_score = score
                    best_dpi = dpi

    # PPM = DPI / (25.4mm * scale_denominator) * 1000mm/m
    # = DPI / (0.0254 * scale_denominator)
    ppm = best_dpi / (0.0254 * denominator)

    # Low confidence because DPI is estimated
    conf = 0.35 if best_score < 0.10 else 0.25  # Slightly higher if paper size matched well

    return {"ppm": ppm, "confidence": round(conf, 2), "source": "cartouche_scale",
            "detail": f"1:{denominator}, est.DPI={best_dpi}, paper_match={best_score:.2f}"}


def _point_to_segment_dist(px, py, x1, y1, x2, y2) -> float:
    """Perpendicular distance from point to line segment."""
    dx, dy = x2 - x1, y2 - y1
    lenSq = dx * dx + dy * dy
    if lenSq == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
    cx = x1 + t * dx
    cy = y1 + t * dy
    return math.hypot(px - cx, py - cy)


def auto_calibrate_crosscheck(
    img_rgb: np.ndarray,
    df_openings,
    cfg: dict,
) -> dict:
    """Multi-source PPM estimation with cross-validation.

    Tries three sources:
      1. Dimension lines (cotes cotées) — highest potential reliability
      2. Door widths — existing method
      3. Cartouche scale notation — lowest reliability (DPI unknown)

    Returns dict with:
      - ppm: best estimate (float or None)
      - confidence: 0.0-1.0
      - method: winning method name
      - sources: list of all individual estimates
      - agreement: whether sources agree
    """
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # Gather estimates from all sources
    sources = []

    est_dims = _ppm_from_dimension_lines(gray, cfg)
    if est_dims:
        sources.append(est_dims)

    est_doors = _ppm_from_doors(df_openings, cfg)
    if est_doors:
        sources.append(est_doors)

    est_cartouche = _ppm_from_cartouche_scale(img_rgb)
    if est_cartouche:
        sources.append(est_cartouche)

    if not sources:
        return {"ppm": None, "confidence": 0.0, "method": "none",
                "sources": [], "agreement": False}

    # Single source — use it directly
    if len(sources) == 1:
        s = sources[0]
        return {"ppm": s["ppm"], "confidence": s["confidence"], "method": s["source"],
                "sources": sources, "agreement": False}

    # Multiple sources — cross-check
    # Check pairwise agreement (within 20%)
    agreements = []
    for i in range(len(sources)):
        for j in range(i + 1, len(sources)):
            ratio = sources[i]["ppm"] / sources[j]["ppm"] if sources[j]["ppm"] > 0 else 99
            agree = 0.80 < ratio < 1.20
            agreements.append({
                "a": sources[i]["source"], "b": sources[j]["source"],
                "ratio": round(ratio, 3), "agree": agree,
            })

    any_agreement = any(a["agree"] for a in agreements)

    if any_agreement:
        # Find the agreeing pair with highest combined confidence
        best_pair = None
        best_conf = 0
        for ag in agreements:
            if not ag["agree"]:
                continue
            src_a = next(s for s in sources if s["source"] == ag["a"])
            src_b = next(s for s in sources if s["source"] == ag["b"])
            combined_conf = (src_a["confidence"] + src_b["confidence"]) / 2 + 0.10  # bonus
            if combined_conf > best_conf:
                best_conf = combined_conf
                best_pair = (src_a, src_b)

        if best_pair:
            # Weighted average of agreeing sources
            w_a = best_pair[0]["confidence"]
            w_b = best_pair[1]["confidence"]
            w_total = w_a + w_b
            ppm = (best_pair[0]["ppm"] * w_a + best_pair[1]["ppm"] * w_b) / w_total
            conf = min(0.95, best_conf)
            method = f"consensus({best_pair[0]['source']}+{best_pair[1]['source']})"
            return {"ppm": ppm, "confidence": round(conf, 2), "method": method,
                    "sources": sources, "agreement": True,
                    "agreements": agreements}

    # No agreement — use highest confidence source
    sources_sorted = sorted(sources, key=lambda s: s["confidence"], reverse=True)
    best = sources_sorted[0]
    # Reduce confidence since no cross-validation
    reduced_conf = max(0.15, best["confidence"] - 0.10)
    return {"ppm": best["ppm"], "confidence": round(reduced_conf, 2),
            "method": best["source"],
            "sources": sources, "agreement": False,
            "agreements": agreements}


# ============================================================
# PIPELINE UTILS
# ============================================================
def clamp_box(x1, y1, x2, y2, WW, HH):
    return max(0, x1), max(0, y1), min(WW-1, x2), min(HH-1, y2)

def is_normalized_coords(vals):
    return float(np.max(vals)) <= 1.5

def iter_tiles(W, H, tile, overlap):
    step = tile - overlap
    xs = list(range(0, max(1, W - tile + 1), step))
    ys = list(range(0, max(1, H - tile + 1), step))
    if not xs or xs[-1] != max(0, W - tile): xs.append(max(0, W - tile))
    if not ys or ys[-1] != max(0, H - tile): ys.append(max(0, H - tile))
    for y0 in ys:
        for x0 in xs:
            yield x0, y0, min(W, x0 + tile), min(H, y0 + tile)

def clean_mask(mask, min_area, close_k):
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (close_k, close_k))
    m = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=1)
    num, lab, stats, _ = cv2.connectedComponentsWithStats((m > 0).astype(np.uint8), 8)
    out = np.zeros_like(mask)
    for i in range(1, num):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            out[lab == i] = 255
    return out


def extract_rooms(rooms_index: np.ndarray, legend: dict,
                  H: int, W: int, ppm) -> list:
    """Extrait les régions de pièces depuis rooms_index + legend CubiCasa.

    Retourne une liste de dicts Room prêts pour le JSON API.
    """
    rooms = []
    for rid_str, raw_label in legend.items():
        rid = int(rid_str)
        lbl_lower_pre = raw_label.lower().strip()
        # Exclure les régions structurelles (mur, sol, etc.) — on ne veut que les pièces
        if lbl_lower_pre in SKIP_ROOM_LABELS:
            continue
        # Exclure tout label qui commence par "wall" (wall_interior, wall_exterior…)
        if lbl_lower_pre.startswith("wall") or lbl_lower_pre.startswith("floor"):
            continue
        mask = ((rooms_index == rid).astype(np.uint8) * 255)
        num, _, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for i in range(1, num):
            area_px = int(stats[i, cv2.CC_STAT_AREA])
            if area_px < 400:   # ignorer les petits artefacts
                continue
            x = int(stats[i, cv2.CC_STAT_LEFT])
            y = int(stats[i, cv2.CC_STAT_TOP])
            w = int(stats[i, cv2.CC_STAT_WIDTH])
            h = int(stats[i, cv2.CC_STAT_HEIGHT])
            cx, cy = float(centroids[i][0]), float(centroids[i][1])
            lbl_lower = lbl_lower_pre
            label_fr = ROOM_LABELS_FR.get(lbl_lower, raw_label.capitalize())
            rooms.append({
                "id": rid,
                "type": lbl_lower,
                "label_fr": label_fr,
                "centroid_norm": {"x": round(cx / W, 4), "y": round(cy / H, 4)},
                "bbox_norm": {
                    "x": round(x / W, 4), "y": round(y / H, 4),
                    "w": round(w / W, 4), "h": round(h / H, 4),
                },
                "area_m2": round(area_px / (ppm ** 2), 2) if ppm else None,
                "area_px2": area_px,
            })
    return rooms


# ============================================================
# WALL DETECTION FROM IMAGE (robuste, sans dépendre du modèle IA)
# ============================================================
def detect_walls_from_image(img_rgb: np.ndarray) -> np.ndarray:
    """Détecte les murs directement depuis les pixels de l'image.

    Retourne un masque binaire uint8 (0/255).
    Fonctionne sur plans archi standard : fond blanc/clair, murs sombres.
    """
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # Seuillage OTSU : automatique, adapté à l'histogramme du plan
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Supprimer les éléments fins : texte, cotes, hachures (épaisseur < 4px)
    k_open = cv2.getStructuringElement(cv2.MORPH_RECT, (4, 4))
    walls = cv2.morphologyEx(binary, cv2.MORPH_OPEN, k_open, iterations=1)

    # Fermer les micro-interruptions dans les murs
    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, k_close, iterations=2)

    return walls


# ============================================================
# ROOM SEGMENTATION PAR FLOOD FILL
# ============================================================
ROOM_COLORS_RGB = {
    "bedroom":      (129, 140, 248),
    "living room":  ( 52, 211, 153),
    "kitchen":      (251, 191,  36),
    "bathroom":     ( 34, 211, 238),
    "dining room":  (244, 114, 182),
    "hallway":      (148, 163, 184),
    "office":       (253, 186,  78),
    "room":         (180, 180, 180),
}


def _classify_room_by_area(area_m2) -> tuple:
    """Classification heuristique basée sur la surface."""
    if area_m2 is None:
        return "room", "Pièce"
    if area_m2 < 2.5:
        return "bathroom", "Salle de bain"
    if area_m2 < 5.0:
        return "hallway", "Couloir"
    if area_m2 < 15.0:
        return "bedroom", "Chambre"
    return "living room", "Séjour"


def segment_rooms_from_walls(walls: np.ndarray, m_doors: np.ndarray,
                              m_windows: np.ndarray, building_cnt,
                              H: int, W: int, ppm) -> list:
    """Segmente les pièces par flood fill depuis le masque de murs.

    Retourne une liste de dicts Room compatibles avec l'interface frontend.
    """
    # 1. Masque bâtiment
    building = np.zeros((H, W), np.uint8)
    if building_cnt is not None:
        cv2.fillPoly(building, [building_cnt], 255)
    else:
        building[:] = 255

    # 2. N'utiliser QUE les murs comme frontières.
    #    Les masques portes/fenêtres sont de grandes bbox qui incluent l'arc
    #    de balayage et bloqueraient l'espace intérieur une fois dilatés.
    boundaries = walls.copy()

    # 3. Dilatation légère pour boucher les micro-interruptions dans les murs
    #    (5x5 au lieu de 9x9 pour rester moins agressif)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    boundaries_closed = cv2.dilate(boundaries, k, iterations=1)

    # 4. Espace navigable = bâtiment − frontières
    interior = cv2.subtract(building, boundaries_closed)

    # 5. Nettoyer le bruit résiduel (hachures, texte mal supprimé, mobilier)
    k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    interior = cv2.morphologyEx(interior, cv2.MORPH_OPEN, k2, iterations=1)

    print(f"[ROOMS] walls_px={cv2.countNonZero(walls)}, "
          f"interior_px={cv2.countNonZero(interior)}, "
          f"building={'cnt' if building_cnt is not None else 'full'}, "
          f"H={H}, W={W}, ppm={ppm}")

    # 6. Surface minimale : ≥ 0.3 m² si ppm connu, sinon 500 px²
    min_area_px = max(200, int(0.3 * ppm ** 2)) if ppm else 500

    # 7. Composantes connexes = pièces individuelles (connectivity=8 : plus robuste)
    num_labels, labels_map = cv2.connectedComponents(interior, connectivity=8)
    print(f"[ROOMS] num_labels={num_labels}, min_area_px={min_area_px}")

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
        # Simplify contour to reduce hundreds of points to clean vertices
        epsilon = 0.002 * cv2.arcLength(cnt_i, True)
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

    print(f"[ROOMS] kept {len(rooms_raw)} rooms after area filter")
    # 8. Trier par surface décroissante
    rooms_raw.sort(key=lambda r: r["area_px2"], reverse=True)

    # 9. Labeling final sans doublons de noms
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


def _build_rooms_color_mask(rooms: list, H: int, W: int) -> np.ndarray:
    """Construit un masque coloré RGBA : fond transparent, pièces semi-opaques."""
    rgb   = np.zeros((H, W, 3), dtype=np.uint8)
    alpha = np.zeros((H, W),    dtype=np.uint8)
    for room in rooms:
        poly = room.get("_polygon")
        if not poly or len(poly) < 3:
            continue
        color = ROOM_COLORS_RGB.get(room.get("type", "room"), (180, 180, 180))
        pts = np.array(poly, dtype=np.int32)
        cv2.fillPoly(rgb,   [pts], color)
        cv2.fillPoly(alpha, [pts], 160)   # semi-transparent (alpha 0-255)
    return np.dstack([rgb, alpha])


def edit_room_mask(mask_rgba: np.ndarray,
                   action: str, room_type: str,
                   x0=None, y0=None, x1=None, y1=None,
                   points=None) -> np.ndarray:
    """Modifie le masque RGBA des pièces en appliquant un dessin ou un effacement.

    Note: out[:, :, :3] on an RGBA array creates a non-contiguous view
    that is incompatible with cv::Mat (OpenCV ≥4.10). We must use
    np.ascontiguousarray() before passing to cv2.fillPoly / cv2.line.
    """
    color = ROOM_COLORS_RGB.get(room_type, (180, 180, 180))
    out = mask_rgba.copy()

    if action in ("add_rect", "add_poly"):
        if action == "add_rect":
            ya, yb = sorted([int(y0), int(y1)])
            xa, xb = sorted([int(x0), int(x1)])
            out[ya:yb, xa:xb, :3] = color
            out[ya:yb, xa:xb,  3] = 160
        else:  # add_poly
            pts = np.array(points, dtype=np.int32)
            rgb = np.ascontiguousarray(out[:, :, :3])
            cv2.fillPoly(rgb, [pts], color)
            out[:, :, :3] = rgb
            alpha_ch = out[:, :, 3].copy()
            cv2.fillPoly(alpha_ch, [pts], 160)
            out[:, :, 3] = alpha_ch

    elif action in ("erase_rect", "erase_poly"):
        if action == "erase_rect":
            ya, yb = sorted([int(y0), int(y1)])
            xa, xb = sorted([int(x0), int(x1)])
            out[ya:yb, xa:xb] = 0
        else:  # erase_poly
            pts = np.array(points, dtype=np.int32)
            rgb = np.ascontiguousarray(out[:, :, :3])
            cv2.fillPoly(rgb, [pts], (0, 0, 0))
            out[:, :, :3] = rgb
            alpha_ch = out[:, :, 3].copy()
            cv2.fillPoly(alpha_ch, [pts], 0)
            out[:, :, 3] = alpha_ch

    return out


def split_room_by_line(mask_rgba: np.ndarray, cut_pts_px: list, thickness: int = 5) -> np.ndarray:
    """Split a room by erasing a thick line through the mask.

    cut_pts_px: list of (x, y) pixel coordinate tuples forming the cut line.
    The line erases both RGB and alpha channels, so rooms_from_mask_rgba
    will see two separate connected components.
    """
    out = mask_rgba.copy()
    rgb = np.ascontiguousarray(out[:, :, :3])
    alpha_ch = out[:, :, 3].copy()
    for i in range(len(cut_pts_px) - 1):
        pt1 = tuple(int(v) for v in cut_pts_px[i])
        pt2 = tuple(int(v) for v in cut_pts_px[i + 1])
        cv2.line(rgb, pt1, pt2, (0, 0, 0), thickness)
        cv2.line(alpha_ch, pt1, pt2, 0, thickness)
    out[:, :, :3] = rgb
    out[:, :, 3] = alpha_ch
    return out


def rooms_from_mask_rgba(mask_rgba: np.ndarray, H: int, W: int, ppm) -> list:
    """Re-dérive la liste de pièces depuis le masque RGBA édité.

    Chaque couleur connue dans ROOM_COLORS_RGB correspond à un type de pièce.
    Les composantes connexes de chaque couleur deviennent des pièces individuelles.
    """
    rooms = []
    room_id = 1
    label_counters: dict = {}

    for room_type, color_rgb in ROOM_COLORS_RGB.items():
        if room_type == "room":
            continue  # couleur générique, ignorer
        # Masque binaire pour ce type
        color_arr = np.array(color_rgb, dtype=np.uint8)
        match = np.all(mask_rgba[:, :, :3] == color_arr, axis=2).astype(np.uint8) * 255
        if cv2.countNonZero(match) == 0:
            continue

        num_labels, labels_map = cv2.connectedComponents(match, connectivity=8)
        min_area_px = max(200, int(0.3 * ppm ** 2)) if ppm else 500

        for i in range(1, num_labels):
            mask_i = (labels_map == i).astype(np.uint8) * 255
            area_px = int(cv2.countNonZero(mask_i))
            if area_px < min_area_px:
                continue
            cnts_i, _ = cv2.findContours(mask_i, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not cnts_i:
                continue
            cnt_i = max(cnts_i, key=cv2.contourArea)
            # Simplify contour to reduce hundreds of points to clean vertices
            epsilon = 0.002 * cv2.arcLength(cnt_i, True)
            cnt_i = cv2.approxPolyDP(cnt_i, epsilon, True)
            x, y, w, h = cv2.boundingRect(cnt_i)
            cx, cy = float(x + w / 2), float(y + h / 2)
            area_m2 = area_px / (ppm ** 2) if ppm else None

            label_counters[room_type] = label_counters.get(room_type, 0) + 1
            n = label_counters[room_type]
            base_labels = {
                "living room": "Séjour",  "bedroom": "Chambre",
                "bathroom": "Salle de bain", "hallway": "Couloir",
                "kitchen": "Cuisine", "office": "Bureau",
                "wc": "WC", "dining room": "Salle à manger",
                "storage": "Rangement", "garage": "Garage",
                "balcony": "Balcon", "laundry": "Buanderie",
            }
            base = base_labels.get(room_type, room_type.capitalize())
            label_fr = base if n == 1 else f"{base} {n}"

            rooms.append({
                "id": room_id,
                "type": room_type,
                "label_fr": label_fr,
                "centroid_norm": {"x": round(cx / W, 4), "y": round(cy / H, 4)},
                "bbox_norm": {"x": round(x/W, 4), "y": round(y/H, 4),
                              "w": round(w/W, 4), "h": round(h/H, 4)},
                "area_m2": round(area_m2, 2) if area_m2 else None,
                "area_px2": area_px,
                "_polygon": cnt_i.reshape(-1, 2).tolist(),
                "polygon_norm": [
                    {"x": round(float(pt[0]) / W, 5), "y": round(float(pt[1]) / H, 5)}
                    for pt in cnt_i.reshape(-1, 2).tolist()
                ],
            })
            room_id += 1

    rooms.sort(key=lambda r: r["area_px2"], reverse=True)
    return rooms


def vectorize_walls(mask_walls: np.ndarray, H: int, W: int, ppm) -> list:
    """Vectorise le masque de murs en segments de lignes via HoughLinesP.

    Retourne une liste de dicts WallSegment normalisés (0-1).
    """
    if mask_walls is None or cv2.countNonZero(mask_walls) == 0:
        return []

    # Légère dilatation pour relier les segments discontinus
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    dilated = cv2.dilate(mask_walls, k, iterations=1)

    lines = cv2.HoughLinesP(
        dilated,
        rho=1,
        theta=np.pi / 180,
        threshold=30,
        minLineLength=18,
        maxLineGap=10,
    )
    segments = []
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = map(int, line[0])
            length_px = float(np.hypot(x2 - x1, y2 - y1))
            segments.append({
                "x1_norm": round(x1 / W, 4),
                "y1_norm": round(y1 / H, 4),
                "x2_norm": round(x2 / W, 4),
                "y2_norm": round(y2 / H, 4),
                "length_m": round(length_px / ppm, 2) if ppm else None,
            })
    return segments


# ============================================================
# STEP 4 — INFÉRENCE MULTI-SCALE
# ============================================================
def infer_pass(img_pil: Image.Image, client, model_id: str, tile_size: int, overlap: int,
               write_rooms: bool, conf_min_door: float, conf_min_win: float, cfg: dict):
    W, H = img_pil.size
    rooms_index = np.zeros((H, W), np.int32) if write_rooms else None
    legend = {}
    cls2id = {}
    nxt = 1

    def rid_for(lbl):
        nonlocal nxt
        if lbl not in cls2id:
            cls2id[lbl] = nxt
            legend[str(nxt)] = lbl
            nxt += 1
        return cls2id[lbl]

    m_doors = np.zeros((H, W), np.uint8)
    m_wins  = np.zeros((H, W), np.uint8)
    m_walls = np.zeros((H, W), np.uint8)
    rows = []
    tile_count = kept_doors = kept_wins = kept_walls = pred_count = 0

    with tempfile.TemporaryDirectory() as td:
        for (x0, y0, x1, y1) in iter_tiles(W, H, tile_size, overlap):
            tile_count += 1
            tile = img_pil.crop((x0, y0, x1, y1))
            tw, th = tile.size
            tile_path = f"{td}/tile_{tile_size}_{x0}_{y0}.png"
            tile.save(tile_path)

            try:
                res = client.infer(tile_path, model_id=model_id)
            except Exception as e:
                logger.warning("Tile inference failed: %s", e)
                continue

            preds = res.get("predictions", []) or res.get("data", [])
            if isinstance(preds, dict) and "predictions" in preds:
                preds = preds["predictions"]
            if not isinstance(preds, list) or not preds:
                continue

            pred_count += len(preds)

            for p in preds:
                lbl = str(p.get("class", "")).lower()
                conf = float(p.get("confidence", 1.0))

                is_door   = any(k in lbl for k in ["door","doors","porte","portes","doorway"])
                is_window = any(k in lbl for k in ["window","windows","fen","fenetre","fenetres"])

                if is_door and conf < conf_min_door: continue
                if is_window and conf < conf_min_win: continue

                # Polygon
                if "points" in p and isinstance(p["points"], list) and len(p["points"]) >= 3:
                    raw_pts = p["points"]
                    pts = None
                    if isinstance(raw_pts[0], dict) and "x" in raw_pts[0]:
                        try:
                            pts = np.array([[float(pt["x"]), float(pt["y"])] for pt in raw_pts], dtype=np.float32)
                        except Exception as e:
                            logger.warning("Failed to parse dict polygon points: %s", e)
                    elif isinstance(raw_pts[0], (list, tuple)) and len(raw_pts[0]) >= 2:
                        try:
                            pts = np.array([[float(pt[0]), float(pt[1])] for pt in raw_pts], dtype=np.float32)
                        except Exception as e:
                            logger.warning("Failed to parse list polygon points: %s", e)

                    if pts is None or pts.shape[0] < 3:
                        continue

                    if is_normalized_coords(pts):
                        pts[:, 0] *= tw; pts[:, 1] *= th

                    pts[:, 0] = np.clip(pts[:, 0], 0, tw - 1)
                    pts[:, 1] = np.clip(pts[:, 1], 0, th - 1)
                    pts[:, 0] += x0; pts[:, 1] += y0

                    poly = pts.astype(np.int32)
                    xmn, ymn = float(poly[:, 0].min()), float(poly[:, 1].min())
                    xmx, ymx = float(poly[:, 0].max()), float(poly[:, 1].max())
                    cxc, cyc = (xmn+xmx)/2.0, (ymn+ymx)/2.0

                    is_wall = lbl.startswith("wall")

                    if is_door:
                        cv2.fillPoly(m_doors, [poly], 255); kept_doors += 1
                    elif is_window:
                        cv2.fillPoly(m_wins, [poly], 255); kept_wins += 1
                    else:
                        if is_wall:
                            cv2.fillPoly(m_walls, [poly], 255); kept_walls += 1
                        if write_rooms and rooms_index is not None:
                            cv2.fillPoly(rooms_index, [poly], rid_for(lbl))

                    rows.append({"label": lbl, "type": "polygon",
                                 "x_px": cxc, "y_px": cyc,
                                 "width_px": xmx-xmn, "height_px": ymx-ymn,
                                 "confidence": conf, "pass_tile": tile_size})

                elif all(k in p for k in ("x","y","width","height")):
                    cx, cy = float(p["x"]), float(p["y"])
                    bw, bh = float(p["width"]), float(p["height"])
                    if max(cx, cy, bw, bh) <= 1.5:
                        cx *= tw; cy *= th; bw *= tw; bh *= th

                    x1t = int(cx-bw/2); y1t = int(cy-bh/2)
                    x2t = int(cx+bw/2); y2t = int(cy+bh/2)
                    x1t, y1t, x2t, y2t = clamp_box(x1t, y1t, x2t, y2t, tw, th)
                    x1g, y1g = x1t+x0, y1t+y0
                    x2g, y2g = x2t+x0, y2t+y0
                    x1g, y1g, x2g, y2g = clamp_box(x1g, y1g, x2g, y2g, W, H)
                    cxc, cyc = (x1g+x2g)/2, (y1g+y2g)/2

                    is_wall_bb = lbl.startswith("wall")

                    if is_door:
                        cv2.rectangle(m_doors, (x1g,y1g), (x2g,y2g), 255, -1); kept_doors += 1
                    elif is_window:
                        cv2.rectangle(m_wins, (x1g,y1g), (x2g,y2g), 255, -1); kept_wins += 1
                    else:
                        if is_wall_bb:
                            cv2.rectangle(m_walls, (x1g,y1g), (x2g,y2g), 255, -1); kept_walls += 1
                        if write_rooms and rooms_index is not None:
                            cv2.rectangle(rooms_index, (x1g,y1g), (x2g,y2g), rid_for(lbl), -1)

                    rows.append({"label": lbl, "type": "bbox",
                                 "x_px": cxc, "y_px": cyc,
                                 "width_px": x2g-x1g, "height_px": y2g-y1g,
                                 "confidence": conf, "pass_tile": tile_size})

    if rooms_index is None:
        rooms_index = np.zeros((H, W), np.int32)

    stats = dict(tile_size=tile_size, tiles=tile_count, preds=pred_count,
                 kept_doors=kept_doors, kept_windows=kept_wins, kept_walls=kept_walls)
    return rooms_index, legend, m_doors, m_wins, m_walls, rows, stats


# ============================================================
# STEP 4 — RUN FULL ANALYSIS
# ============================================================
def run_analysis(img_rgb: np.ndarray, pixels_per_meter: float = None,
                 cfg: dict = None) -> dict:
    if cfg is None:
        cfg = DEFAULT_CONFIG

    img_pil = Image.fromarray(img_rgb).convert("RGB")
    W, H = img_pil.size

    from inference_sdk import InferenceHTTPClient
    client = InferenceHTTPClient(
        api_url="https://serverless.roboflow.com",
        api_key=cfg["api_key"]
    )

    # === PASS 1 (2048) ===
    rooms_index, legend, m_doors_1, m_wins_1, m_walls_1, rows_1, st1 = infer_pass(
        img_pil, client, cfg["model_id"],
        cfg["pass1_tile"], cfg["pass1_over"], write_rooms=True,
        conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg
    )
    # ── DEBUG : log toutes les classes détectées par le modèle ──────────────
    print(f"[DEBUG] legend Pass1 ({len(legend)} classes): {legend}")
    unique_labels_in_rows = sorted(set(r["label"] for r in rows_1))
    print(f"[DEBUG] labels uniques rows1: {unique_labels_in_rows}")
    print(f"[DEBUG] rooms_index unique values (≠0): {list(np.unique(rooms_index[rooms_index != 0]))[:20]}")
    # ────────────────────────────────────────────────────────────────────────
    m_doors_1 = clean_mask(m_doors_1, cfg["min_area_door_px"], cfg["clean_close_k_door"])
    m_wins_1  = clean_mask(m_wins_1,  cfg["min_area_win_px"],  cfg["clean_close_k_win"])

    # === PASS 2 (1024) ===
    _, _, m_doors_2, m_wins_2, m_walls_2, rows_2, st2 = infer_pass(
        img_pil, client, cfg["model_id"],
        cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
        conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg
    )
    m_doors_2 = clean_mask(m_doors_2, cfg["min_area_door_px"], cfg["clean_close_k_door"])
    m_wins_2  = clean_mask(m_wins_2,  cfg["min_area_win_px"],  cfg["clean_close_k_win"])

    # === UNION ===
    m_doors    = cv2.bitwise_or(m_doors_1, m_doors_2)
    m_windows  = cv2.bitwise_or(m_wins_1,  m_wins_2)
    m_walls_ai = cv2.bitwise_or(m_walls_1, m_walls_2)
    print(f"[DEBUG] m_walls_ai pixels: {cv2.countNonZero(m_walls_ai)} (direct Roboflow wall predictions)")

    # === WALLS depuis rooms_index (frontières entre régions Roboflow) ===
    # Cette approche donne des murs fins et nets calqués sur les détections IA.
    # Fallback OTSU si le modèle n'a pas détecté de pièces.
    a = rooms_index
    walls = np.zeros((H, W), np.uint8)
    walls[1:,:]  |= (a[1:,:]  != a[:-1,:]).astype(np.uint8)
    walls[:-1,:] |= (a[:-1,:] != a[1:,:]).astype(np.uint8)
    walls[:,1:]  |= (a[:,1:]  != a[:,:-1]).astype(np.uint8)
    walls[:,:-1] |= (a[:,:-1] != a[:,1:]).astype(np.uint8)
    walls = (walls * 255).astype(np.uint8)
    if cv2.countNonZero(walls) > 0:
        kernel_w = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, kernel_w, iterations=1)
    else:
        walls = detect_walls_from_image(img_rgb)

    # === EMPRISE (contour extérieur) ===
    # Inclure portes + fenêtres pour boucher les trous du périmètre mural
    cnt = None
    try:
        walls_for_outline = cv2.bitwise_or(walls, cv2.bitwise_or(m_doors, m_windows))
        kernel_e = cv2.getStructuringElement(cv2.MORPH_RECT, (11,11))
        closed = cv2.morphologyEx(walls_for_outline, cv2.MORPH_CLOSE, kernel_e, iterations=3)
        inv = cv2.bitwise_not(closed)
        flood = np.zeros((H+2, W+2), np.uint8)
        cv2.floodFill(inv, flood, (0,0), 255)
        filled = cv2.bitwise_not(inv)
        cnts, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if cnts:
            cnt = max(cnts, key=cv2.contourArea)
    except Exception as e:
        logger.warning("Building outline detection failed: %s", e)

    # === Extraire ouvertures depuis masques ===
    _, md_binary = cv2.threshold(m_doors,   127, 255, cv2.THRESH_BINARY)
    _, mw_binary = cv2.threshold(m_windows, 127, 255, cv2.THRESH_BINARY)

    if cnt is not None:
        emp = np.zeros((H,W), np.uint8)
        cv2.fillPoly(emp, [cnt], 255)
        md_binary = cv2.bitwise_and(md_binary, emp)
        mw_binary = cv2.bitwise_and(mw_binary, emp)

    openings = _extract_openings(md_binary, "door", cfg) + \
               _extract_openings(mw_binary, "window", cfg)
    import pandas as pd
    df_openings = pd.DataFrame(openings)

    # === AUTO pixels_per_meter — cross-check multi-sources ===
    ppm = pixels_per_meter
    scale_info = None
    if ppm is None:
        scale_info = auto_calibrate_crosscheck(img_rgb, df_openings, cfg)
        ppm = scale_info.get("ppm")
        logger.info("Auto-calibration: method=%s, ppm=%s, confidence=%s",
                     scale_info.get("method"), ppm, scale_info.get("confidence"))
    else:
        scale_info = {"ppm": ppm, "confidence": 1.0, "method": "manual",
                      "sources": [], "agreement": True}

    if ppm is not None and not df_openings.empty:
        df_openings["length_m"] = df_openings["length_px"] / ppm
        df_openings["width_m"]  = df_openings["width_px"]  / ppm
        df_openings["height_m"] = df_openings["height_px"] / ppm

    # === DÉTECTION MURS PAR PIXEL (OTSU) — compare avec IA ===
    m_walls_pixel = _detect_walls_pixel(img_rgb, cnt)

    # === SURFACES & PÉRIMÈTRES ===
    surfaces = _compute_surfaces(img_rgb, cnt, walls, ppm, cfg)

    # Surfaces comparées : murs IA vs murs pixel
    if ppm is not None:
        if cv2.countNonZero(m_walls_ai) > 0:
            surfaces["area_walls_ai_m2"] = float(cv2.countNonZero(m_walls_ai)) / (ppm ** 2)
        if cv2.countNonZero(m_walls_pixel) > 0:
            surfaces["area_walls_pixel_m2"] = float(cv2.countNonZero(m_walls_pixel)) / (ppm ** 2)

    # === OVERLAYS ===
    overlay_openings = _build_overlay_openings(img_rgb, cnt, m_doors, m_windows)
    overlay_interior = _build_overlay_interior(img_rgb, surfaces.get("interior_mask"))

    # === PIÈCES via flood fill (robuste, indépendant du modèle) ===
    rooms_list    = segment_rooms_from_walls(walls, m_doors, m_windows, cnt, H, W, ppm)
    wall_segments = vectorize_walls(walls, H, W, ppm)

    # === MASQUE ROOMS coloré depuis les pièces segmentées ===
    mask_rooms_rgb = _build_rooms_color_mask(rooms_list, H, W)

    # === SÉPARATION murs béton / cloisons ===
    m_concrete, m_partitions = _split_walls_by_type(walls, cnt, ppm)

    return {
        "img_w": W, "img_h": H,
        "pixels_per_meter": ppm,
        "scale_info": scale_info,
        "doors_count": int((df_openings["class"] == "door").sum()) if not df_openings.empty else 0,
        "windows_count": int((df_openings["class"] == "window").sum()) if not df_openings.empty else 0,
        "openings": df_openings.to_dict(orient="records") if not df_openings.empty else [],
        "surfaces": surfaces,
        "stats": {"pass1": st1, "pass2": st2},
        # Pièces et murs vectorisés (on retire les champs internes _*)
        "rooms": [{k: v for k, v in r.items() if not k.startswith("_")} for r in rooms_list],
        "walls": wall_segments,
        # Plan brut sans annotations (pour toggle overlays côté frontend)
        "plan_b64": _np_to_b64(img_rgb),
        # Images encodées en base64 PNG
        "overlay_openings_b64": _np_to_b64(overlay_openings),
        "overlay_interior_b64": _np_to_b64(overlay_interior) if overlay_interior is not None else None,
        "mask_doors_b64":   _np_to_b64(m_doors),     # grayscale binary (white=door) → luminance mask works
        "mask_windows_b64": _np_to_b64(m_windows),  # grayscale binary (white=window) → luminance mask works
        "mask_walls_b64":   _np_to_b64(_mask_to_rgba(walls, (96, 165, 250), 90)),        # blue
        "mask_walls_ai_b64": _np_to_b64(_mask_to_rgba(m_walls_ai, (245, 158, 11), 100)) if cv2.countNonZero(m_walls_ai) > 0 else None,  # amber
        "mask_walls_pixel_b64": _np_to_b64(_mask_to_rgba(m_walls_pixel, (239, 68, 68), 80)) if cv2.countNonZero(m_walls_pixel) > 0 else None,  # red
        "mask_walls_concrete_b64": _np_to_b64(m_concrete),   # grayscale — béton (épais/périmètre)
        "mask_walls_partition_b64": _np_to_b64(m_partitions) if cv2.countNonZero(m_partitions) > 0 else None,  # grayscale — cloisons
        "mask_rooms_b64":   _np_to_b64(mask_rooms_rgb),
        # Masques bruts pour édition ultérieure
        "_m_doors": m_doors,
        "_m_windows": m_windows,
        "_walls": walls,
        "_m_walls_ai": m_walls_ai,
        "_cnt": cnt.tolist() if cnt is not None else None,
        "_mask_rooms_rgba": mask_rooms_rgb,  # numpy RGBA array pour édition
    }


def _extract_openings(mask, label, cfg):
    openings = []
    num, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    for i in range(1, num):
        x, y, w, h, area = stats[i]
        if label == "door" and area < cfg["min_area_door_px"]: continue
        if label == "window" and area < cfg["min_area_win_px"]: continue
        openings.append({
            "class": label,
            "x_px": float(x + w/2), "y_px": float(y + h/2),
            "width_px": float(w), "height_px": float(h),
            "length_px": float(max(w, h)), "area_px2": float(area),
        })
    return openings


def _compute_surfaces(img_rgb, cnt, walls, ppm, cfg):
    H, W = img_rgb.shape[:2]
    result = {}

    if cnt is None:
        return result

    building = np.zeros((H, W), np.uint8)
    cv2.fillPoly(building, [cnt], 255)

    walls_bin = (walls > 0).astype(np.uint8) * 255
    wall_thickness_m = cfg.get("wall_thickness_m", 0.20)
    wall_thickness_px_fallback = cfg.get("wall_thickness_px_fallback", 10)

    if ppm is not None:
        radius_px = max(1, int(round((wall_thickness_m * ppm) / 2.0)))
    else:
        radius_px = max(1, wall_thickness_px_fallback // 2)

    ksize = 2 * radius_px + 1
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
    walls_thick = cv2.dilate(walls_bin, k, iterations=1)
    walls_thick = cv2.bitwise_and(walls_thick, building)

    interior = cv2.subtract(building, walls_thick)
    k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    interior = cv2.morphologyEx(interior, cv2.MORPH_OPEN, k2, iterations=1)

    area_building_px2 = float(cv2.countNonZero(building))
    area_walls_px2    = float(cv2.countNonZero(walls_thick))
    area_interior_px2 = float(cv2.countNonZero(interior))

    perim_building_px = float(cv2.arcLength(cnt, True))
    interior_bin = (interior > 0).astype(np.uint8) * 255
    cnts_int, _ = cv2.findContours(interior_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    perim_interior_px = float(sum(cv2.arcLength(c, True) for c in cnts_int)) if cnts_int else 0.0

    result = {
        "area_building_px2": area_building_px2,
        "area_walls_px2": area_walls_px2,
        "area_interior_px2": area_interior_px2,
        "perim_building_px": perim_building_px,
        "perim_interior_px": perim_interior_px,
        "interior_mask": interior,
    }

    if ppm is not None:
        result["area_building_m2"] = area_building_px2 / (ppm ** 2)
        result["area_walls_m2"]    = area_walls_px2    / (ppm ** 2)
        result["area_hab_m2"]      = area_interior_px2 / (ppm ** 2)
        result["perim_building_m"] = perim_building_px / ppm
        result["perim_interior_m"] = perim_interior_px / ppm

    return result


def _build_overlay_openings(img_rgb, cnt, m_doors, m_windows):
    bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

    if cnt is not None:
        fill = np.zeros_like(bgr)
        cv2.fillPoly(fill, [cnt], (255, 0, 0))
        bgr = cv2.addWeighted(fill, 0.20, bgr, 0.80, 0)
        cv2.drawContours(bgr, [cnt], -1, (255, 0, 0), 3)

    cs_d, _ = cv2.findContours(m_doors,   cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cs_w, _ = cv2.findContours(m_windows, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    fill2 = np.zeros_like(bgr)
    if cs_d: cv2.fillPoly(fill2, cs_d, (255, 0, 255))
    if cs_w: cv2.fillPoly(fill2, cs_w, (255, 255, 0))
    out_bgr = cv2.addWeighted(fill2, 0.25, bgr, 0.75, 0)
    for c in cs_d: cv2.drawContours(out_bgr, [c], -1, (255, 0, 255), 2)
    for c in cs_w: cv2.drawContours(out_bgr, [c], -1, (255, 255, 0), 2)

    return cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)


def _build_overlay_interior(img_rgb, interior_mask):
    if interior_mask is None:
        return None
    overlay = img_rgb.copy()
    green = np.array([0, 255, 0], dtype=np.uint8)
    idx = (interior_mask > 0)
    overlay[idx] = (0.6 * overlay[idx] + 0.4 * green).astype(np.uint8)
    return overlay


def _detect_walls_pixel(img_rgb: np.ndarray, cnt: np.ndarray = None) -> np.ndarray:
    """Detect walls by pixel thresholding (OTSU) — dark lines = walls with real thickness."""
    H, W = img_rgb.shape[:2]
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # OTSU threshold: dark pixels = wall lines
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Restrict to building contour if available
    if cnt is not None:
        mask_building = np.zeros((H, W), np.uint8)
        cv2.fillPoly(mask_building, [cnt], 255)
        binary = cv2.bitwise_and(binary, mask_building)

    # Remove small noise (text, hatching) — keep only thick structures
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, k, iterations=2)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k, iterations=1)

    return binary


def _walls_ai_to_lines(m_walls: np.ndarray) -> np.ndarray:
    """Convert filled AI wall regions into thin wall lines (contours + morphological skeleton)."""
    if m_walls is None or cv2.countNonZero(m_walls) == 0:
        return m_walls

    H, W = m_walls.shape[:2]
    result = np.zeros((H, W), np.uint8)

    # 1) Draw contours of the filled wall regions (thickness 2)
    contours, _ = cv2.findContours(m_walls, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(result, contours, -1, 255, 2)

    # 2) Morphological skeleton of the filled regions for interior wall lines
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    skel = np.zeros_like(m_walls)
    temp = m_walls.copy()
    while True:
        eroded = cv2.erode(temp, element)
        opened = cv2.dilate(eroded, element)
        diff = cv2.subtract(temp, opened)
        skel = cv2.bitwise_or(skel, diff)
        temp = eroded
        if cv2.countNonZero(temp) == 0:
            break

    # 3) Merge contours + skeleton, dilate slightly for visibility
    result = cv2.bitwise_or(result, skel)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    result = cv2.dilate(result, k, iterations=1)

    return result


def _mask_to_rgba(mask: np.ndarray, color: tuple, alpha: int = 100) -> np.ndarray:
    """Convert a grayscale mask to an RGBA overlay image.
    White pixels (255) become colored with given alpha, black pixels become fully transparent."""
    H, W = mask.shape[:2]
    rgba = np.zeros((H, W, 4), np.uint8)
    white = mask > 127
    rgba[white, 0] = color[0]
    rgba[white, 1] = color[1]
    rgba[white, 2] = color[2]
    rgba[white, 3] = alpha
    return rgba


def _split_walls_by_type(walls_bin: np.ndarray, cnt, ppm) -> tuple:
    """Sépare le masque murs en :
    - béton : épais (survit à l'érosion) OU situé près du périmètre extérieur
    - cloisons : fins ET intérieurs
    Retourne (concrete_mask, partition_mask) — deux ndarrays grayscale binaires.
    """
    H, W = walls_bin.shape[:2]

    # — Classification par épaisseur : kernel ~13cm —
    k_r = max(2, int(round((0.13 * ppm) / 2))) if ppm else 3
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k_r + 1, 2 * k_r + 1))
    eroded = cv2.erode(walls_bin, k, iterations=1)
    concrete_thick = cv2.dilate(eroded, k, iterations=1)
    concrete_thick = cv2.bitwise_and(concrete_thick, walls_bin)

    # — Classification par position : zone ≈30 px autour du contour extérieur —
    concrete_perimeter = np.zeros((H, W), np.uint8)
    if cnt is not None:
        contour_img = np.zeros((H, W), np.uint8)
        cv2.drawContours(contour_img, [cnt], -1, 255, thickness=3)
        k_ext = cv2.getStructuringElement(cv2.MORPH_RECT, (31, 31))
        near_ext = cv2.dilate(contour_img, k_ext, iterations=1)
        concrete_perimeter = cv2.bitwise_and(near_ext, walls_bin)

    # — Combinaison —
    concrete = cv2.bitwise_or(concrete_thick, concrete_perimeter)
    concrete = cv2.bitwise_and(concrete, walls_bin)
    partitions = cv2.bitwise_and(walls_bin, cv2.bitwise_not(concrete))
    return concrete, partitions


def _np_to_b64(arr: np.ndarray) -> str:
    pil = Image.fromarray(arr.astype(np.uint8))
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


# ============================================================
# STEP 5 — RECALCUL SURFACES depuis masques édités
# FIX: retourne maintenant les overlays et masques mis à jour
# ============================================================
def recompute_from_edited_masks(img_rgb: np.ndarray, m_doors: np.ndarray,
                                 m_windows: np.ndarray, walls: np.ndarray,
                                 pixels_per_meter: float, cfg: dict,
                                 interior_mask_override: np.ndarray = None) -> dict:
    H, W = img_rgb.shape[:2]

    # Recompute emprise depuis walls + ouvertures pour périmètre continu
    cnt = None
    try:
        walls_for_outline = cv2.bitwise_or(walls, cv2.bitwise_or(m_doors, m_windows))
        kernel_e = cv2.getStructuringElement(cv2.MORPH_RECT, (11,11))
        closed = cv2.morphologyEx(walls_for_outline, cv2.MORPH_CLOSE, kernel_e, iterations=3)
        inv = cv2.bitwise_not(closed)
        flood = np.zeros((H+2, W+2), np.uint8)
        cv2.floodFill(inv, flood, (0,0), 255)
        filled = cv2.bitwise_not(inv)
        cnts, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if cnts:
            cnt = max(cnts, key=cv2.contourArea)
    except Exception as e:
        logger.warning("Building outline detection failed: %s", e)

    surfaces = _compute_surfaces(img_rgb, cnt, walls, pixels_per_meter, cfg)

    # Si un masque d'intérieur personnalisé est fourni, on l'utilise pour recalculer
    if interior_mask_override is not None:
        surfaces["interior_mask"] = interior_mask_override
        area_interior_px2 = float(cv2.countNonZero(interior_mask_override))
        surfaces["area_interior_px2"] = area_interior_px2
        if pixels_per_meter is not None:
            ppm = pixels_per_meter
            surfaces["area_hab_m2"] = area_interior_px2 / (ppm ** 2)
            interior_bin = (interior_mask_override > 0).astype(np.uint8) * 255
            cnts_int, _ = cv2.findContours(interior_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            perim_interior_px = float(sum(cv2.arcLength(c, True) for c in cnts_int)) if cnts_int else 0.0
            surfaces["perim_interior_px"] = perim_interior_px
            surfaces["perim_interior_m"] = perim_interior_px / ppm

    overlay_openings = _build_overlay_openings(img_rgb, cnt, m_doors, m_windows)
    overlay_interior = _build_overlay_interior(img_rgb, surfaces.get("interior_mask"))

    _, md_binary = cv2.threshold(m_doors,   127, 255, cv2.THRESH_BINARY)
    _, mw_binary = cv2.threshold(m_windows, 127, 255, cv2.THRESH_BINARY)
    openings = _extract_openings(md_binary, "door", cfg) + \
               _extract_openings(mw_binary, "window", cfg)

    surfaces_clean = {k: v for k, v in surfaces.items() if k != "interior_mask"}

    # Re-segmentation des pièces depuis les masques édités
    rooms_list = segment_rooms_from_walls(walls, m_doors, m_windows, cnt, H, W, pixels_per_meter)
    mask_rooms_rgb = _build_rooms_color_mask(rooms_list, H, W)

    # Séparation béton / cloisons sur les murs édités
    m_concrete_r, m_partitions_r = _split_walls_by_type(walls, cnt, pixels_per_meter)

    return {
        "doors_count": sum(1 for o in openings if o["class"] == "door"),
        "windows_count": sum(1 for o in openings if o["class"] == "window"),
        "openings": openings,
        "surfaces": surfaces_clean,
        "pixels_per_meter": pixels_per_meter,
        # Pièces re-segmentées
        "rooms": [{k: v for k, v in r.items() if not k.startswith("_")} for r in rooms_list],
        # Plan brut sans annotations
        "plan_b64": _np_to_b64(img_rgb),
        # FIX: overlays et masques régénérés depuis les masques édités
        "overlay_openings_b64": _np_to_b64(overlay_openings),
        "overlay_interior_b64": _np_to_b64(overlay_interior) if overlay_interior is not None else None,
        "mask_doors_b64":   _np_to_b64(m_doors),
        "mask_windows_b64": _np_to_b64(m_windows),
        "mask_walls_b64":   _np_to_b64(walls),
        "mask_walls_ai_b64": None,  # AI walls only available on initial analysis
        "mask_walls_concrete_b64": _np_to_b64(m_concrete_r),
        "mask_walls_partition_b64": _np_to_b64(m_partitions_r) if cv2.countNonZero(m_partitions_r) > 0 else None,
        "mask_rooms_b64":   _np_to_b64(mask_rooms_rgb),
        # Masques bruts pour nouvelle édition
        "_interior_mask": surfaces.get("interior_mask"),
    }



def _auto_bbox_from_click(image_rgb: np.ndarray, x: int, y: int, pad: int = 30) -> list:
    """Détecte la bbox de la région autour du point cliqué (identique au notebook)."""
    H, W = image_rgb.shape[:2]
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    inv = cv2.bitwise_not(edges)

    ffmask = np.zeros((H + 2, W + 2), np.uint8)
    ff = inv.copy()
    cx, cy = max(1, min(int(x), W-2)), max(1, min(int(y), H-2))
    cv2.floodFill(ff, ffmask, (cx, cy), 0)

    region = (inv != ff).astype(np.uint8) * 255
    ys, xs = np.where(region > 0)

    if len(xs) < 200:
        return [max(0, int(x)-250), max(0, int(y)-250),
                min(W-1, int(x)+250), min(H-1, int(y)+250)]

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    return [max(0, x0-pad), max(0, y0-pad),
            min(W-1, x1+pad), min(H-1, y1+pad)]

# ============================================================
# STEP 5b — SAM 2 : segmentation automatique par clic
# Utilise Meta SAM 2 (sam2) si disponible, sinon fallback OpenCV
# ============================================================

# Cache global du predictor SAM 2 (chargé une seule fois au démarrage)
_sam2_predictor = None
_sam2_current_image_hash = None  # pour éviter de re-encoder la même image

def _load_sam2_predictor():
    """Charge le predictor SAM v1 (vit_h) — identique au notebook Colab."""
    global _sam2_predictor
    if _sam2_predictor is not None:
        return _sam2_predictor

    try:
        import torch
        try:
            from segment_anything import sam_model_registry, SamPredictor
        except ImportError:
            import subprocess, sys
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-q",
                "git+https://github.com/facebookresearch/segment-anything.git"])
            from segment_anything import sam_model_registry, SamPredictor

        ckpt_path = "sam_vit_h_4b8939.pth"
        if not os.path.exists(ckpt_path):
            import urllib.request
            print("[SAM] Téléchargement du checkpoint sam_vit_h (~2.5 GB)...")
            urllib.request.urlretrieve(
                "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth",
                ckpt_path
            )
            print("[SAM] Checkpoint téléchargé.")

        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[SAM] Chargement sur {device}...")
        sam = sam_model_registry["vit_h"](checkpoint=ckpt_path)
        sam.to(device=device)
        _sam2_predictor = SamPredictor(sam)
        print("[SAM] ✓ Predictor SAM v1 prêt.")
        return _sam2_predictor

    except Exception as e:
        print(f"[SAM] Indisponible ({e}), fallback OpenCV activé.")
        return None


def sam_segment_point(img_rgb: np.ndarray, x: int, y: int,
                      mode: str = "interior") -> np.ndarray:
    """
    Segmentation automatique à partir d'un point de clic.
    Utilise SAM 2 si disponible, sinon fallback OpenCV (flood fill).
    Retourne un masque binaire (uint8, 0/255).
    """
    global _sam2_current_image_hash

    H, W = img_rgb.shape[:2]

    # ── Tentative SAM 2 ──────────────────────────────────────────────────────
    predictor = _load_sam2_predictor()

    if predictor is not None:
        try:
            import torch
            import hashlib

            # Re-encoder l'image seulement si elle a changé
            img_hash = hashlib.md5(img_rgb.tobytes()).hexdigest()
            if img_hash != _sam2_current_image_hash:
                predictor.set_image(img_rgb)
                _sam2_current_image_hash = img_hash

            point_coords = np.array([[float(x), float(y)]], dtype=np.float32)
            point_labels = np.array([1], dtype=np.int32)

            # Auto-bbox basée sur les contours (identique au notebook)
            auto_bb = _auto_bbox_from_click(img_rgb, x, y, pad=30)
            box = np.array(auto_bb, dtype=np.float32)

            masks, scores, _ = predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box,
                multimask_output=True,
            )

            best_idx = int(np.argmax(scores))
            result_mask = masks[best_idx].astype(np.uint8) * 255
            print(f"[SAM] ✓ score={scores[best_idx]:.3f} pixels={int(result_mask.sum()//255)}")
            return result_mask

        except Exception as e:
            print(f"[SAM] Erreur prédiction ({e}), fallback OpenCV.")

    # ── Fallback OpenCV (flood fill + contours) ───────────────────────────────
    print("[SAM] Fallback OpenCV activé.")
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    px_val = thresh[max(0, min(y, H-1)), max(0, min(x, W-1))]

    if mode == "flood":
        seed_mask = np.zeros((H+2, W+2), np.uint8)
        flood_img = thresh.copy()
        flags = 4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8)
        cv2.floodFill(flood_img, seed_mask, (x, y), 255, (10,), (10,), flags)
        return seed_mask[1:H+1, 1:W+1]

    work = thresh.copy() if px_val > 127 else cv2.bitwise_not(thresh)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    work = cv2.morphologyEx(work, cv2.MORPH_CLOSE, k, iterations=2)
    cnts, _ = cv2.findContours(work, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    result_mask = np.zeros((H, W), np.uint8)
    for c in cnts:
        if cv2.pointPolygonTest(c, (float(x), float(y)), False) >= 0:
            cv2.fillPoly(result_mask, [c], 255)
            break

    if cv2.countNonZero(result_mask) == 0:
        seed_mask = np.zeros((H+2, W+2), np.uint8)
        flood_img = thresh.copy()
        flags = 4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8)
        cv2.floodFill(flood_img, seed_mask, (x, y), 255, (10,), (10,), flags)
        result_mask = seed_mask[1:H+1, 1:W+1]

    return result_mask


# ============================================================
# HELPERS PDF communs (couleurs + utilitaires)
# ============================================================
def _pdf_colors():
    from reportlab.lib import colors
    return dict(
        WHITE  = colors.HexColor("#FFFFFF"),
        LIGHT  = colors.HexColor("#F8FAFC"),
        LIGHT2 = colors.HexColor("#F1F5F9"),
        BORDER = colors.HexColor("#E2E8F0"),
        DARK   = colors.HexColor("#1E293B"),
        DARK2  = colors.HexColor("#0F172A"),
        TEXT   = colors.HexColor("#1E293B"),
        MUTED  = colors.HexColor("#64748B"),
        BLUE   = colors.HexColor("#3B82F6"),
        BLUE2  = colors.HexColor("#1D4ED8"),
        CYAN   = colors.HexColor("#22D3EE"),
        GREEN  = colors.HexColor("#10B981"),
        ORANGE = colors.HexColor("#F97316"),
        RED    = colors.HexColor("#EF4444"),
        PURPLE = colors.HexColor("#8B5CF6"),
    )

def _pil_reader_from_arr(arr):
    from reportlab.lib.utils import ImageReader
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8)).save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)

def _pil_reader_from_b64(b64_str, mime="image/png"):
    from reportlab.lib.utils import ImageReader
    img_data = base64.b64decode(b64_str)
    img_pil = Image.open(io.BytesIO(img_data)).convert("RGB")
    arr = np.array(img_pil)
    return _pil_reader_from_arr(arr), arr.shape[1], arr.shape[0]

def _pdf_header(c, W_a4, H_a4, M, cols, title_right, subtitle_right, date_str):
    """Dessine l'en-tête du PDF (bandeau sombre)."""
    header_h = 68
    c.setFillColor(cols["DARK2"]); c.rect(0, H_a4-header_h, W_a4, header_h, stroke=0, fill=1)
    c.setFillColor(cols["BLUE"]);  c.rect(0, H_a4-header_h-3, W_a4, 3, stroke=0, fill=1)
    # Logo
    c.setFillColor(cols["WHITE"]); c.setFont("Helvetica-Bold", 17)
    c.drawString(M, H_a4-36, "FloorScan")
    c.setFillColor(cols["CYAN"]); c.setFont("Helvetica", 9)
    c.drawString(M, H_a4-52, "Analyse de plan de sol")
    # Titre droite
    c.setFillColor(cols["WHITE"]); c.setFont("Helvetica-Bold", 15)
    c.drawRightString(W_a4-M, H_a4-36, title_right)
    c.setFillColor(cols["MUTED"]); c.setFont("Helvetica", 9)
    c.drawRightString(W_a4-M, H_a4-52, subtitle_right)
    return header_h + 3  # height consumed

def _pdf_info_strip(c, W_a4, H_a4, M, cols, top_y, fields):
    """Dessine la bande infos projet (champs = list of (label, value))."""
    strip_h = 50
    y0 = top_y - strip_h
    c.setFillColor(cols["LIGHT2"]); c.rect(0, y0, W_a4, strip_h, stroke=0, fill=1)
    c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.5)
    c.line(0, y0, W_a4, y0); c.line(0, top_y, W_a4, top_y)
    col_w = (W_a4 - 2*M) / max(len(fields), 1)
    for i, (lbl, val) in enumerate(fields):
        x = M + i * col_w
        c.setFont("Helvetica", 7); c.setFillColor(cols["MUTED"])
        c.drawString(x, y0 + strip_h - 16, lbl.upper())
        c.setFont("Helvetica-Bold", 10); c.setFillColor(cols["TEXT"])
        c.drawString(x, y0 + strip_h - 32, val or "—")
    return strip_h  # height consumed

def _pdf_footer(c, W_a4, M, cols, date_str):
    """Dessine le pied de page."""
    c.setFillColor(cols["LIGHT2"]); c.rect(0, 0, W_a4, 26, stroke=0, fill=1)
    c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.5); c.line(0, 26, W_a4, 26)
    c.setFont("Helvetica", 7); c.setFillColor(cols["MUTED"])
    c.drawString(M, 8, f"Généré par FloorScan  •  {date_str}")
    c.drawRightString(W_a4-M, 8, "floorscan.app")

def _draw_image_in_area(c, img_arr, x, y, w, h, border_color=None):
    """Dessine une image centrée dans la zone donnée, avec cadre optionnel."""
    H_i, W_i = img_arr.shape[:2]
    scale = min(w / W_i, h / H_i)
    dw, dh = W_i * scale, H_i * scale
    ix = x + (w - dw) / 2
    iy = y + (h - dh) / 2
    if border_color:
        from reportlab.lib import colors as rlc
        c.setStrokeColor(border_color); c.setLineWidth(0.5)
        c.rect(ix-2, iy-2, dw+4, dh+4, stroke=1, fill=0)
    c.drawImage(_pil_reader_from_arr(img_arr), ix, iy, dw, dh)


# ============================================================
# STEP 6a — EXPORT RAPPORT PDF — Module IA (devis professionnel)
# ============================================================
def generate_pdf_report(img_rgb: np.ndarray, overlay_openings: np.ndarray,
                        overlay_interior, mask_doors, mask_windows, mask_walls,
                        surfaces: dict, doors_count: int, windows_count: int,
                        ppm: float,
                        project_name: str = "",
                        client_name: str = "") -> bytes:
    import datetime
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors

    W_a4, H_a4 = A4
    M = 40
    cols = _pdf_colors()
    date_str = datetime.date.today().strftime("%d/%m/%Y")

    def fmt(v, nd=2):
        if v is None: return "—"
        if isinstance(v, int): return str(v)
        return f"{v:.{nd}f}"

    buf_out = io.BytesIO()
    c = canvas.Canvas(buf_out, pagesize=A4)

    # ── PAGE 1 : Résumé + Plan + Overlay ────────────────────────────────────
    c.setFillColor(cols["WHITE"]); c.rect(0, 0, W_a4, H_a4, stroke=0, fill=1)
    hdr_h = _pdf_header(c, W_a4, H_a4, M, cols,
                        "RAPPORT D'ANALYSE IA",
                        "Multi-scale · Roboflow + CubiCasa5k",
                        date_str)
    info_h = _pdf_info_strip(c, W_a4, H_a4, M, cols,
                              H_a4 - hdr_h,
                              [("Projet", project_name), ("Client", client_name), ("Date", date_str)])
    top_y = H_a4 - hdr_h - info_h

    # KPIs row
    kpi_top = top_y - 6
    kpi_h = 52; kpi_gap = 8
    kpi_count = 5
    kpi_w = (W_a4 - 2*M - kpi_gap*(kpi_count-1)) / kpi_count

    def kpi(i, label, value, col):
        x = M + i*(kpi_w+kpi_gap)
        c.setFillColor(cols["LIGHT2"]); c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.5)
        c.roundRect(x, kpi_top-kpi_h, kpi_w, kpi_h, 6, stroke=1, fill=1)
        c.setFont("Helvetica", 7); c.setFillColor(cols["MUTED"])
        c.drawString(x+8, kpi_top-16, label.upper())
        c.setFont("Helvetica-Bold", 13); c.setFillColor(col)
        c.drawString(x+8, kpi_top-34, value)

    kpi(0, "Portes",    str(doors_count),   cols["BLUE"])
    kpi(1, "Fenêtres",  str(windows_count), cols["CYAN"])
    kpi(2, "Emprise",   f"{fmt(surfaces.get('area_building_m2'))} m²" if surfaces.get('area_building_m2') else "—", cols["ORANGE"])
    kpi(3, "Murs",      f"{fmt(surfaces.get('area_walls_m2'))} m²"    if surfaces.get('area_walls_m2')    else "—", cols["PURPLE"])
    kpi(4, "Habitable", f"{fmt(surfaces.get('area_hab_m2'))} m²"      if surfaces.get('area_hab_m2')      else "—", cols["GREEN"])

    # Two images side by side
    img_area_top = kpi_top - kpi_h - 8
    img_area_bottom = 36  # footer height
    img_area_h = img_area_top - img_area_bottom
    img_gap = 8
    img_w = (W_a4 - 2*M - img_gap) / 2

    # Left: plan de base
    c.setFillColor(cols["LIGHT2"]); c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.5)
    c.roundRect(M, img_area_bottom, img_w, img_area_h, 6, stroke=1, fill=1)
    c.setFont("Helvetica-Bold", 9); c.setFillColor(cols["TEXT"])
    c.drawString(M+8, img_area_bottom+img_area_h-14, "PLAN DE BASE")
    _draw_image_in_area(c, img_rgb, M+6, img_area_bottom+6, img_w-12, img_area_h-22)

    # Right: overlay ouvertures
    ox = M + img_w + img_gap
    c.setFillColor(cols["LIGHT2"]); c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.5)
    c.roundRect(ox, img_area_bottom, img_w, img_area_h, 6, stroke=1, fill=1)
    c.setFont("Helvetica-Bold", 9); c.setFillColor(cols["TEXT"])
    c.drawString(ox+8, img_area_bottom+img_area_h-14, "OVERLAY — PORTES & FENÊTRES")
    _draw_image_in_area(c, overlay_openings, ox+6, img_area_bottom+6, img_w-12, img_area_h-22)

    _pdf_footer(c, W_a4, M, cols, date_str)
    c.showPage()

    # ── PAGE 2 : Surfaces + Tableau ─────────────────────────────────────────
    c.setFillColor(cols["WHITE"]); c.rect(0, 0, W_a4, H_a4, stroke=0, fill=1)
    _pdf_header(c, W_a4, H_a4, M, cols, "SURFACES & MÉTRÉS", f"Échelle : {fmt(ppm)} px/m" if ppm else "Échelle non définie", date_str)
    hdr_h2 = 71

    # Surface habitable overlay
    if overlay_interior is not None:
        oi_top = H_a4 - hdr_h2 - 8
        oi_h = 240
        c.setFillColor(cols["LIGHT2"]); c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.5)
        c.roundRect(M, oi_top-oi_h, W_a4-2*M, oi_h, 6, stroke=1, fill=1)
        c.setFont("Helvetica-Bold", 9); c.setFillColor(cols["TEXT"])
        c.drawString(M+8, oi_top-14, "OVERLAY — SURFACE HABITABLE")
        _draw_image_in_area(c, overlay_interior, M+6, oi_top-oi_h+6, W_a4-2*M-12, oi_h-22)
        table_top = oi_top - oi_h - 16
    else:
        table_top = H_a4 - hdr_h2 - 16

    # Tableau récapitulatif
    rows = []
    if surfaces.get("area_building_m2"): rows.append(("Emprise totale",    f"{fmt(surfaces['area_building_m2'])} m²", f"{fmt(surfaces.get('perim_building_m'))} m", cols["BLUE"]))
    if surfaces.get("area_walls_m2"):    rows.append(("Surfaces de murs",  f"{fmt(surfaces['area_walls_m2'])} m²",    "—",                                             cols["PURPLE"]))
    if surfaces.get("area_hab_m2"):      rows.append(("Surface habitable", f"{fmt(surfaces['area_hab_m2'])} m²",      f"{fmt(surfaces.get('perim_interior_m'))} m",    cols["GREEN"]))

    col_widths = [W_a4-2*M-180, 90, 90]
    col_xs = [M, M+col_widths[0], M+col_widths[0]+col_widths[1]]
    row_h = 24; th = 26

    if rows:
        # Header
        c.setFillColor(cols["DARK2"]); c.rect(M, table_top-th, W_a4-2*M, th, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 8); c.setFillColor(cols["WHITE"])
        for i, lbl in enumerate(["TYPE DE SURFACE", "SURFACE", "PÉRIMÈTRE"]):
            c.drawString(col_xs[i]+8, table_top-th+8, lbl)
        # Rows
        for ri, (name, area, perim, color) in enumerate(rows):
            ry = table_top - th - (ri+1)*row_h
            c.setFillColor(cols["LIGHT"] if ri%2==0 else cols["LIGHT2"])
            c.rect(M, ry, W_a4-2*M, row_h, stroke=0, fill=1)
            c.setFillColor(color); c.circle(col_xs[0]+12, ry+row_h/2, 4, stroke=0, fill=1)
            c.setFont("Helvetica", 10); c.setFillColor(cols["TEXT"])
            c.drawString(col_xs[0]+24, ry+7, name)
            c.setFont("Helvetica-Bold", 10); c.drawString(col_xs[1]+8, ry+7, area)
            c.setFont("Helvetica", 10);      c.drawString(col_xs[2]+8, ry+7, perim)
            c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.4)
            c.line(M, ry, W_a4-M, ry)
        # Outer border
        c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.6)
        c.rect(M, table_top-th-len(rows)*row_h, W_a4-2*M, th+len(rows)*row_h, stroke=1, fill=0)

    # PPM info
    if ppm:
        c.setFont("Helvetica", 8); c.setFillColor(cols["MUTED"])
        c.drawString(M, table_top-th-len(rows)*row_h-14, f"Calibration : {fmt(ppm)} pixels/mètre")

    _pdf_footer(c, W_a4, M, cols, date_str)
    c.showPage()

    # ── PAGE 3 : Masques ─────────────────────────────────────────────────────
    masks = []
    if mask_doors   is not None: masks.append(("Masque Portes",    mask_doors))
    if mask_windows is not None: masks.append(("Masque Fenêtres",  mask_windows))
    if mask_walls   is not None: masks.append(("Masque Murs",      mask_walls))

    if masks:
        c.setFillColor(cols["WHITE"]); c.rect(0, 0, W_a4, H_a4, stroke=0, fill=1)
        _pdf_header(c, W_a4, H_a4, M, cols, "MASQUES DE DÉTECTION", "Résultats bruts du modèle", date_str)
        hdr_h3 = 71
        grid_top = H_a4 - hdr_h3 - 8
        grid_bottom = 36
        grid_h = grid_top - grid_bottom
        grid_w = W_a4 - 2*M
        gap_g = 10
        cell_w = (grid_w-gap_g)/2; cell_h = (grid_h-gap_g)/2
        positions = [(M, grid_bottom+cell_h+gap_g), (M+cell_w+gap_g, grid_bottom+cell_h+gap_g),
                     (M, grid_bottom), (M+cell_w+gap_g, grid_bottom)]
        for i, (title, arr) in enumerate(masks[:4]):
            xx, yy = positions[i]
            c.setFillColor(cols["LIGHT2"]); c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.5)
            c.roundRect(xx, yy, cell_w, cell_h, 6, stroke=1, fill=1)
            c.setFont("Helvetica-Bold", 9); c.setFillColor(cols["TEXT"])
            c.drawString(xx+8, yy+cell_h-14, title.upper())
            arr_rgb = cv2.cvtColor(arr, cv2.COLOR_GRAY2RGB) if arr.ndim==2 else arr
            _draw_image_in_area(c, arr_rgb, xx+6, yy+6, cell_w-12, cell_h-22)
        _pdf_footer(c, W_a4, M, cols, date_str)
        c.showPage()

    c.save()
    return buf_out.getvalue()


# ============================================================
# STEP 6b — EXPORT DEVIS PDF — Module Métré Manuel
# ============================================================
def generate_measure_pdf_devis(
    image_b64: str,
    surface_totals: list,   # [{name, color, area_m2, price_per_m2}]
    total_m2: float,
    ppm: float = None,
    project_name: str = "",
    client_name: str = "",
    date_str: str = "",
    tva_rate: float = 10.0,
) -> bytes:
    import datetime
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as rl_canvas

    W_a4, H_a4 = A4
    M = 40
    cols = _pdf_colors()
    if not date_str:
        date_str = datetime.date.today().strftime("%d/%m/%Y")

    # ── Calculs financiers ────────────────────────────────────────────────────
    has_prices = any((item.get("price_per_m2") or 0) > 0 for item in surface_totals)
    total_ht   = sum((item.get("area_m2") or 0) * (item.get("price_per_m2") or 0)
                     for item in surface_totals) if has_prices else 0.0
    tva_amount = total_ht * tva_rate / 100.0
    total_ttc  = total_ht + tva_amount

    def fmt_eur(v): return f"{v:,.2f} \u20ac".replace(",", "\u00a0")

    # ── Mise en page ──────────────────────────────────────────────────────────
    buf_out = io.BytesIO()
    c = rl_canvas.Canvas(buf_out, pagesize=A4)

    # ── PAGE 1 : Plan + Tableau ───────────────────────────────────────────────
    c.setFillColor(cols["WHITE"]); c.rect(0, 0, W_a4, H_a4, stroke=0, fill=1)
    hdr_h = _pdf_header(c, W_a4, H_a4, M, cols, "DEVIS DE MÉTRÉ", "Métré manuel de surfaces", date_str)
    info_h = _pdf_info_strip(c, W_a4, H_a4, M, cols,
                              H_a4 - hdr_h,
                              [("Projet", project_name), ("Client", client_name), ("Date", date_str)])
    top_y = H_a4 - hdr_h - info_h - 8

    # Hauteur de la section financière sous le tableau (HT / TVA / TTC)
    fin_row_h = 22
    finance_h = (3 * fin_row_h + 20) if (has_prices and total_ht > 0) else 0

    # Dimensions du tableau
    row_h = 26; th = 28
    n_rows = len(surface_totals)
    total_row_h = 30
    table_total_h = th + n_rows * row_h + total_row_h + 20
    table_bottom = 36 + 8 + finance_h  # footer + padding + section financière

    # Zone image (entre la bande info et le tableau)
    img_area_top    = top_y
    img_area_bottom = table_bottom + table_total_h + 10
    img_area_h = img_area_top - img_area_bottom
    img_area_w = W_a4 - 2 * M

    # Plan de sol
    if img_area_h > 40 and image_b64:
        try:
            ir, iw_nat, ih_nat = _pil_reader_from_b64(image_b64)
            scale = min(img_area_w / iw_nat, img_area_h / ih_nat)
            dw, dh = iw_nat * scale, ih_nat * scale
            ix = M + (img_area_w - dw) / 2
            iy = img_area_bottom + (img_area_h - dh) / 2
            c.setFillColor(cols["LIGHT2"]); c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.5)
            c.roundRect(M, img_area_bottom, img_area_w, img_area_h, 6, stroke=1, fill=1)
            c.setFont("Helvetica-Bold", 8); c.setFillColor(cols["MUTED"])
            c.drawString(M+8, img_area_bottom+img_area_h-14, "PLAN DE SOL")
            c.drawImage(ir, ix, iy, dw, dh)
        except Exception:
            pass

    # ── Colonnes du tableau ───────────────────────────────────────────────────
    TW = W_a4 - 2*M   # largeur totale du tableau (≈ 515 pt)
    if has_prices:
        # 5 colonnes : TYPE | SURFACE | PRIX/m² | MONTANT HT | %
        c_name = 190; c_surf = 75; c_prix = 75; c_ht = 90; c_pct = TW - c_name - c_surf - c_prix - c_ht
        col_xs = [M, M+c_name, M+c_name+c_surf, M+c_name+c_surf+c_prix, M+c_name+c_surf+c_prix+c_ht]
        headers = ["TYPE DE SURFACE", "SURFACE (m²)", "PRIX/m²", "MONTANT HT", "% TOTAL"]
    else:
        # 3 colonnes : TYPE | SURFACE | %
        c_name = TW - 200; c_surf = 100
        col_xs = [M, M+c_name, M+c_name+c_surf]
        headers = ["TYPE DE SURFACE", "SURFACE (m²)", "% DU TOTAL"]

    # Titre du tableau
    t_top = table_bottom + table_total_h - 20
    c.setFont("Helvetica-Bold", 11); c.setFillColor(cols["TEXT"])
    c.drawString(M, t_top + 8, "RÉCAPITULATIF DES SURFACES")

    # En-tête
    c.setFillColor(cols["DARK2"]); c.rect(M, t_top - th, TW, th, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 8); c.setFillColor(cols["WHITE"])
    for i, lbl in enumerate(headers):
        c.drawString(col_xs[i]+8, t_top-th+9, lbl)

    # Lignes de données
    from reportlab.lib import colors as rlc
    for ri, item in enumerate(surface_totals):
        ry = t_top - th - (ri+1)*row_h
        c.setFillColor(cols["LIGHT"] if ri%2==0 else cols["LIGHT2"])
        c.rect(M, ry, TW, row_h, stroke=0, fill=1)
        try:
            dot_col = rlc.HexColor(item.get("color", "#6B7280"))
        except Exception:
            dot_col = cols["MUTED"]
        c.setFillColor(dot_col); c.circle(col_xs[0]+12, ry+row_h/2, 5, stroke=0, fill=1)
        c.setFont("Helvetica", 10); c.setFillColor(cols["TEXT"])
        c.drawString(col_xs[0]+26, ry+8, item.get("name", "—"))
        area_val  = item.get("area_m2", 0) or 0
        price_val = item.get("price_per_m2", 0) or 0
        montant   = area_val * price_val
        pct = (area_val / total_m2 * 100) if total_m2 > 0 else 0
        c.setFont("Helvetica-Bold", 10)
        c.drawString(col_xs[1]+8, ry+8, f"{area_val:.2f} m\u00b2")
        if has_prices:
            c.setFont("Helvetica", 10); c.setFillColor(cols["MUTED"])
            c.drawString(col_xs[2]+8, ry+8, f"{price_val:.2f} \u20ac" if price_val else "\u2014")
            c.setFont("Helvetica-Bold", 10); c.setFillColor(cols["TEXT"])
            c.drawString(col_xs[3]+8, ry+8, fmt_eur(montant) if price_val else "\u2014")
            c.setFont("Helvetica", 10); c.setFillColor(cols["MUTED"])
            c.drawString(col_xs[4]+8, ry+8, f"{pct:.1f} %")
        else:
            c.setFont("Helvetica", 10); c.setFillColor(cols["MUTED"])
            c.drawString(col_xs[2]+8, ry+8, f"{pct:.1f} %")
        c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.3)
        c.line(M, ry, M+TW, ry)

    # Ligne TOTAL
    tot_y = t_top - th - n_rows*row_h - total_row_h
    c.setFillColor(cols["BLUE"]); c.rect(M, tot_y, TW, total_row_h, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 12); c.setFillColor(cols["WHITE"])
    c.drawString(col_xs[0]+26, tot_y+9, "TOTAL")
    c.drawString(col_xs[1]+8,  tot_y+9, f"{total_m2:.2f} m\u00b2")
    if has_prices:
        c.drawString(col_xs[3]+8, tot_y+9, fmt_eur(total_ht))
        c.drawString(col_xs[4]+8, tot_y+9, "100 %")
    else:
        c.drawString(col_xs[2]+8, tot_y+9, "100 %")

    # Bordure du tableau
    c.setStrokeColor(cols["BORDER"]); c.setLineWidth(0.6)
    c.rect(M, tot_y, TW, th + n_rows*row_h + total_row_h, stroke=1, fill=0)

    # ── Section financière HT / TVA / TTC ─────────────────────────────────────
    if has_prices and total_ht > 0:
        fin_right = M + TW
        fy = tot_y - 8
        fin_data = [
            ("Total HT",          fmt_eur(total_ht),  cols["TEXT"],  "Helvetica",      10),
            (f"TVA ({tva_rate:.0f} %)", fmt_eur(tva_amount), cols["MUTED"], "Helvetica", 10),
            ("Total TTC",         fmt_eur(total_ttc), cols["BLUE"],  "Helvetica-Bold", 12),
        ]
        for label, value, vcol, font, fsize in fin_data:
            fy -= fin_row_h
            c.setFont("Helvetica", 9); c.setFillColor(cols["MUTED"])
            c.drawString(fin_right - 195, fy + 5, label + " :")
            c.setFont(font, fsize); c.setFillColor(vcol)
            c.drawRightString(fin_right, fy + 5, value)
        # Souligner Total TTC
        c.setStrokeColor(cols["BLUE"]); c.setLineWidth(0.8)
        c.line(fin_right - 195, fy + fin_row_h, fin_right, fy + fin_row_h)

    # Note calibration
    note_y = table_bottom - 6
    if ppm:
        c.setFont("Helvetica", 8); c.setFillColor(cols["MUTED"])
        c.drawString(M, note_y, f"Calibration : {ppm:.1f} px/m")

    _pdf_footer(c, W_a4, M, cols, date_str)
    c.save()
    return buf_out.getvalue()


# ============================================================
# DXF EXPORT — AutoCAD format
# ============================================================
def generate_dxf(rooms: list, walls: list, openings: list,
                 img_w: int, img_h: int, ppm: float) -> bytes:
    """Generate a DXF file with rooms, walls, and openings.

    Coordinates are converted from normalized (0-1) or pixel to meters.
    DXF Y-axis is inverted relative to image Y.
    """
    import ezdxf

    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # Create layers
    doc.layers.add("Walls",      color=7)   # white
    doc.layers.add("Rooms",      color=3)   # green
    doc.layers.add("Doors",      color=6)   # magenta
    doc.layers.add("Windows",    color=4)   # cyan
    doc.layers.add("Labels",     color=2)   # yellow

    def norm_to_m(x_norm, y_norm):
        return (x_norm * img_w / ppm, (1.0 - y_norm) * img_h / ppm)

    def px_to_m(x_px, y_px):
        return (x_px / ppm, (img_h - y_px) / ppm)

    # ── Walls ──
    if walls:
        for w in walls:
            p1 = norm_to_m(w.get("x1_norm", 0), w.get("y1_norm", 0))
            p2 = norm_to_m(w.get("x2_norm", 0), w.get("y2_norm", 0))
            msp.add_line(p1, p2, dxfattribs={"layer": "Walls"})

    # ── Rooms ──
    if rooms:
        for room in rooms:
            poly = room.get("polygon_norm")
            if not poly or len(poly) < 3:
                continue
            points_m = [norm_to_m(p["x"], p["y"]) for p in poly]
            points_m.append(points_m[0])  # close
            msp.add_lwpolyline(points_m, dxfattribs={"layer": "Rooms"}, close=True)
            # Hatch fill
            try:
                hatch = msp.add_hatch(color=3, dxfattribs={"layer": "Rooms"})
                hatch.paths.add_polyline_path(
                    [(x, y, 0) for x, y in points_m], is_closed=True
                )
            except Exception:
                pass  # skip hatch if ezdxf version doesn't support it
            # Label
            cx, cy = norm_to_m(room["centroid_norm"]["x"], room["centroid_norm"]["y"])
            label = room.get("label_fr", room.get("type", ""))
            area_str = f" {room['area_m2']:.1f} m2" if room.get("area_m2") else ""
            msp.add_mtext(f"{label}{area_str}", dxfattribs={
                "layer": "Labels", "insert": (cx, cy), "char_height": 0.15,
            })

    # ── Openings ──
    if openings:
        for o in openings:
            layer_name = "Doors" if o.get("class") == "door" else "Windows"
            x0, y0 = px_to_m(o.get("x_px", 0), o.get("y_px", 0))
            x1, y1 = px_to_m(
                o.get("x_px", 0) + o.get("width_px", 0),
                o.get("y_px", 0) + o.get("height_px", 0),
            )
            corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
            msp.add_lwpolyline(corners, dxfattribs={"layer": layer_name}, close=True)

    stream = io.BytesIO()
    doc.write(stream)
    return stream.getvalue()


# ── Plan diff ─────────────────────────────────────────────────────────────────

def compute_plan_diff(img1_rgb: np.ndarray, img2_rgb: np.ndarray) -> dict:
    """Align two plan images and compute colour-coded diff overlay."""
    h1, w1 = img1_rgb.shape[:2]

    # Resize V2 to match V1 dimensions
    img2_resized = cv2.resize(img2_rgb, (w1, h1), interpolation=cv2.INTER_AREA)

    # ORB feature matching for alignment (patent-free)
    gray1 = cv2.cvtColor(img1_rgb, cv2.COLOR_RGB2GRAY)
    gray2 = cv2.cvtColor(img2_resized, cv2.COLOR_RGB2GRAY)

    try:
        orb = cv2.ORB_create(5000)
        kp1, des1 = orb.detectAndCompute(gray1, None)
        kp2, des2 = orb.detectAndCompute(gray2, None)

        if des1 is not None and des2 is not None and len(kp1) >= 4 and len(kp2) >= 4:
            bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
            matches = sorted(bf.match(des1, des2), key=lambda m: m.distance)[:50]

            if len(matches) >= 4:
                pts1 = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
                pts2 = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
                H, _ = cv2.findHomography(pts2, pts1, cv2.RANSAC, 5.0)
                if H is not None:
                    img2_resized = cv2.warpPerspective(img2_resized, H, (w1, h1),
                                                        borderMode=cv2.BORDER_REPLICATE)
    except Exception:
        pass  # fallback: use simple resize

    aligned_v2 = img2_resized

    # Pixel diff
    g1 = cv2.cvtColor(img1_rgb, cv2.COLOR_RGB2GRAY).astype(np.int16)
    g2 = cv2.cvtColor(aligned_v2, cv2.COLOR_RGB2GRAY).astype(np.int16)

    diff_abs = np.abs(g1 - g2).astype(np.uint8)
    _, diff_mask = cv2.threshold(diff_abs, 30, 255, cv2.THRESH_BINARY)

    # Colour overlay
    overlay = img1_rgb.copy()
    added = (g2 < g1 - 30)      # darker in V2 => new element drawn
    removed = (g1 < g2 - 30)    # lighter in V2 => element erased

    overlay[added]   = [0, 200, 0]    # green
    overlay[removed] = [200, 0, 0]    # red

    total_px = float(h1 * w1)
    return {
        "aligned_v1_b64": _np_to_b64(img1_rgb),
        "aligned_v2_b64": _np_to_b64(aligned_v2),
        "diff_overlay_b64": _np_to_b64(overlay),
        "diff_stats": {
            "changed_pixels_pct": round(float(np.count_nonzero(diff_mask)) / total_px * 100, 2),
            "added_area_pct":     round(float(np.count_nonzero(added))     / total_px * 100, 2),
            "removed_area_pct":   round(float(np.count_nonzero(removed))   / total_px * 100, 2),
        },
    }


# ── Cartouche / legend extraction ─────────────────────────────────────────────

def extract_cartouche(img_rgb: np.ndarray) -> dict:
    """Detect cartouche zone in bottom-right and run OCR."""
    import re
    try:
        import pytesseract
    except ImportError:
        # Return empty result if pytesseract not installed
        return {
            "cartouche_bbox_norm": None,
            "cartouche_b64": None,
            "fields": [],
            "raw_text": "(pytesseract non installé)",
            "plan_b64": _np_to_b64(img_rgb),
        }

    H, W = img_rgb.shape[:2]
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # Search bottom-right 45% x 35%
    roi_x = int(W * 0.55)
    roi_y = int(H * 0.65)
    roi = gray[roi_y:, roi_x:]

    # Find largest rectangle in that zone
    blurred = cv2.GaussianBlur(roi, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    dilated = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_box = None
    best_area = 0
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        area = w * h
        if area > best_area and w > 80 and h > 40:
            best_area = area
            best_box = (x + roi_x, y + roi_y, w, h)

    if best_box is None:
        best_box = (roi_x, roi_y, W - roi_x, H - roi_y)

    bx, by, bw, bh = best_box
    cartouche_crop = img_rgb[by:by + bh, bx:bx + bw]

    # OCR
    try:
        ocr_text = pytesseract.image_to_string(cartouche_crop, lang="fra+eng")
    except Exception:
        try:
            ocr_text = pytesseract.image_to_string(cartouche_crop)
        except Exception as e:
            ocr_text = f"(OCR error: {e})"

    # Parse fields heuristically
    fields = _parse_cartouche_fields(ocr_text)

    bbox_norm = {
        "x": round(bx / W, 4),
        "y": round(by / H, 4),
        "w": round(bw / W, 4),
        "h": round(bh / H, 4),
    }

    plan_annotated = img_rgb.copy()
    cv2.rectangle(plan_annotated, (bx, by), (bx + bw, by + bh), (138, 43, 226), 3)

    return {
        "cartouche_bbox_norm": bbox_norm,
        "cartouche_b64": _np_to_b64(cartouche_crop),
        "fields": fields,
        "raw_text": ocr_text,
        "plan_b64": _np_to_b64(plan_annotated),
    }


def _parse_cartouche_fields(text: str) -> list:
    """Heuristic extraction of standard architectural legend fields."""
    import re
    lines = text.strip().split("\n")

    patterns = [
        ("project_name", "Nom du projet", [
            r"(?:projet|project|affaire|opération)\s*[:;]?\s*(.+)",
            r"^([A-Z][A-Z\s]{5,})$",
        ]),
        ("architect", "Architecte", [
            r"(?:architecte?|architect|maître d'œuvre|maitre d'oeuvre)\s*[:;]?\s*(.+)",
        ]),
        ("scale", "Échelle", [
            r"(?:échelle|echelle|scale|ech\.?)\s*[:;]?\s*(1\s*[:/]\s*\d+)",
            r"(1\s*[:/]\s*\d+)",
        ]),
        ("date", "Date", [
            r"(?:date)\s*[:;]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})",
            r"(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})",
        ]),
        ("plan_number", "N° de plan", [
            r"(?:plan|n°|numéro|numero|indice)\s*[:;]?\s*([A-Z0-9][\w\-]+)",
        ]),
        ("revision", "Révision", [
            r"(?:rév|rev|indice|version|ind\.?)\s*[:;]?\s*([A-Z0-9]+)",
        ]),
    ]

    result = []
    for key, label, pats in patterns:
        value = ""
        conf = 0.0
        for pat in pats:
            for line in lines:
                m = re.search(pat, line, re.IGNORECASE)
                if m:
                    value = m.group(1).strip()
                    conf = 0.7
                    break
            if value:
                break
        result.append({"key": key, "label_fr": label, "value": value, "confidence": conf})

    return result
