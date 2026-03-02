# pipeline.py — Logique extraite du notebook floor_plan_module_09_02
# Adaptée pour être appelée depuis FastAPI

import os, io, json, math, time, tempfile, base64
import numpy as np
import cv2
from PIL import Image
import fitz  # PyMuPDF
import pandas as pd

from inference_sdk import InferenceHTTPClient

# ============================================================
# CONFIG (peut être surchargée depuis les paramètres API)
# ============================================================
DEFAULT_CONFIG = {
    "api_key": "VOTRE_CLE_ROBOFLOW",          # ← À remplacer
    "model_id": "cubicasa-xmyt3-d4s04/3",
    "assumed_door_width_m": 0.90,
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


# ============================================================
# STEP 1 — PDF → PNG (zoom ×3)
# ============================================================
def pdf_to_image(pdf_bytes: bytes, zoom: float = 3.0) -> np.ndarray:
    """Rendu de la page 1 d'un PDF en numpy RGB array."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img_pil = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    return np.array(img_pil)


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
    dist_px = math.hypot(x2 - x1, y2 - y1)
    return dist_px / real_m


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
    rows = []
    tile_count = kept_doors = kept_wins = pred_count = 0

    with tempfile.TemporaryDirectory() as td:
        for (x0, y0, x1, y1) in iter_tiles(W, H, tile_size, overlap):
            tile_count += 1
            tile = img_pil.crop((x0, y0, x1, y1))
            tw, th = tile.size
            tile_path = f"{td}/tile_{tile_size}_{x0}_{y0}.png"
            tile.save(tile_path)

            try:
                res = client.infer(tile_path, model_id=model_id)
            except Exception:
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
                        except: pass
                    elif isinstance(raw_pts[0], (list, tuple)) and len(raw_pts[0]) >= 2:
                        try:
                            pts = np.array([[float(pt[0]), float(pt[1])] for pt in raw_pts], dtype=np.float32)
                        except: pass

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

                    if is_door:
                        cv2.fillPoly(m_doors, [poly], 255); kept_doors += 1
                    elif is_window:
                        cv2.fillPoly(m_wins, [poly], 255); kept_wins += 1
                    elif write_rooms and rooms_index is not None:
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

                    if is_door:
                        cv2.rectangle(m_doors, (x1g,y1g), (x2g,y2g), 255, -1); kept_doors += 1
                    elif is_window:
                        cv2.rectangle(m_wins, (x1g,y1g), (x2g,y2g), 255, -1); kept_wins += 1
                    elif write_rooms and rooms_index is not None:
                        cv2.rectangle(rooms_index, (x1g,y1g), (x2g,y2g), rid_for(lbl), -1)

                    rows.append({"label": lbl, "type": "bbox",
                                 "x_px": cxc, "y_px": cyc,
                                 "width_px": x2g-x1g, "height_px": y2g-y1g,
                                 "confidence": conf, "pass_tile": tile_size})

    if rooms_index is None:
        rooms_index = np.zeros((H, W), np.int32)

    stats = dict(tile_size=tile_size, tiles=tile_count, preds=pred_count,
                 kept_doors=kept_doors, kept_windows=kept_wins)
    return rooms_index, legend, m_doors, m_wins, rows, stats


# ============================================================
# STEP 4 — RUN FULL ANALYSIS
# ============================================================
def run_analysis(img_rgb: np.ndarray, pixels_per_meter: float = None,
                 cfg: dict = None) -> dict:
    if cfg is None:
        cfg = DEFAULT_CONFIG

    img_pil = Image.fromarray(img_rgb).convert("RGB")
    W, H = img_pil.size

    client = InferenceHTTPClient(
        api_url="https://serverless.roboflow.com",
        api_key=cfg["api_key"]
    )

    # === PASS 1 (2048) ===
    rooms_index, legend, m_doors_1, m_wins_1, rows_1, st1 = infer_pass(
        img_pil, client, cfg["model_id"],
        cfg["pass1_tile"], cfg["pass1_over"], write_rooms=True,
        conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg
    )
    m_doors_1 = clean_mask(m_doors_1, cfg["min_area_door_px"], cfg["clean_close_k_door"])
    m_wins_1  = clean_mask(m_wins_1,  cfg["min_area_win_px"],  cfg["clean_close_k_win"])

    # === PASS 2 (1024) ===
    _, _, m_doors_2, m_wins_2, rows_2, st2 = infer_pass(
        img_pil, client, cfg["model_id"],
        cfg["pass2_tile"], cfg["pass2_over"], write_rooms=False,
        conf_min_door=cfg["conf_min_door"], conf_min_win=cfg["conf_min_win"], cfg=cfg
    )
    m_doors_2 = clean_mask(m_doors_2, cfg["min_area_door_px"], cfg["clean_close_k_door"])
    m_wins_2  = clean_mask(m_wins_2,  cfg["min_area_win_px"],  cfg["clean_close_k_win"])

    # === UNION ===
    m_doors   = cv2.bitwise_or(m_doors_1, m_doors_2)
    m_windows = cv2.bitwise_or(m_wins_1,  m_wins_2)

    # === WALLS depuis rooms_index ===
    a = rooms_index
    walls = np.zeros((H, W), np.uint8)
    walls[1:,:]  |= (a[1:,:]  != a[:-1,:])
    walls[:-1,:] |= (a[:-1,:] != a[1:,:])
    walls[:,1:]  |= (a[:,1:]  != a[:,:-1])
    walls[:,:-1] |= (a[:,:-1] != a[:,1:])
    walls = (walls.astype(np.uint8) * 255)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3,3))
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, kernel, iterations=1)

    # === EMPRISE (contour extérieur) ===
    cnt = None
    try:
        kernel_e = cv2.getStructuringElement(cv2.MORPH_RECT, (11,11))
        closed = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, kernel_e, iterations=3)
        inv = cv2.bitwise_not(closed)
        flood = np.zeros((H+2, W+2), np.uint8)
        cv2.floodFill(inv, flood, (0,0), 255)
        filled = cv2.bitwise_not(inv)
        cnts, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if cnts:
            cnt = max(cnts, key=cv2.contourArea)
    except Exception:
        pass

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
    df_openings = pd.DataFrame(openings)

    # === AUTO pixels_per_meter si pas fourni manuellement ===
    ppm = pixels_per_meter
    if ppm is None and not df_openings.empty:
        doors = df_openings[df_openings["class"] == "door"]
        if len(doors) >= 1:
            doors_f = doors[(doors["length_px"] >= cfg["door_len_px_min"]) &
                            (doors["length_px"] <= cfg["door_len_px_max"])]
            use = doors_f if len(doors_f) >= cfg["min_doors_for_scale"] else doors
            median_door_px = float(np.median(use["length_px"].values))
            ppm = median_door_px / cfg["assumed_door_width_m"]

    if ppm is not None and not df_openings.empty:
        df_openings["length_m"] = df_openings["length_px"] / ppm
        df_openings["width_m"]  = df_openings["width_px"]  / ppm
        df_openings["height_m"] = df_openings["height_px"] / ppm

    # === SURFACES & PÉRIMÈTRES ===
    surfaces = _compute_surfaces(img_rgb, cnt, walls, ppm, cfg)

    # === OVERLAYS ===
    overlay_openings = _build_overlay_openings(img_rgb, cnt, m_doors, m_windows)
    overlay_interior = _build_overlay_interior(img_rgb, surfaces.get("interior_mask"))

    # === MASQUES ROOMS ===
    K = int(rooms_index.max())
    rng = np.random.default_rng(0)
    palette = rng.integers(0, 256, size=(max(K, 1) + 1, 3), dtype=np.uint8)
    mask_rooms_rgb = palette[rooms_index]

    return {
        "img_w": W, "img_h": H,
        "pixels_per_meter": ppm,
        "doors_count": int((df_openings["class"] == "door").sum()) if not df_openings.empty else 0,
        "windows_count": int((df_openings["class"] == "window").sum()) if not df_openings.empty else 0,
        "openings": df_openings.to_dict(orient="records") if not df_openings.empty else [],
        "surfaces": surfaces,
        "stats": {"pass1": st1, "pass2": st2},
        # Images encodées en base64 PNG
        "overlay_openings_b64": _np_to_b64(overlay_openings),
        "overlay_interior_b64": _np_to_b64(overlay_interior) if overlay_interior is not None else None,
        "mask_doors_b64":   _np_to_b64(m_doors),
        "mask_windows_b64": _np_to_b64(m_windows),
        "mask_walls_b64":   _np_to_b64(walls),
        "mask_rooms_b64":   _np_to_b64(mask_rooms_rgb),
        # Masques bruts pour édition ultérieure
        "_m_doors": m_doors.tolist(),
        "_m_windows": m_windows.tolist(),
        "_walls": walls.tolist(),
        "_cnt": cnt.tolist() if cnt is not None else None,
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


def _np_to_b64(arr: np.ndarray) -> str:
    if arr.ndim == 2:
        pil = Image.fromarray(arr.astype(np.uint8))
    else:
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

    # Recompute emprise depuis walls
    cnt = None
    try:
        kernel_e = cv2.getStructuringElement(cv2.MORPH_RECT, (11,11))
        closed = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, kernel_e, iterations=3)
        inv = cv2.bitwise_not(closed)
        flood = np.zeros((H+2, W+2), np.uint8)
        cv2.floodFill(inv, flood, (0,0), 255)
        filled = cv2.bitwise_not(inv)
        cnts, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if cnts:
            cnt = max(cnts, key=cv2.contourArea)
    except Exception:
        pass

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

    return {
        "doors_count": sum(1 for o in openings if o["class"] == "door"),
        "windows_count": sum(1 for o in openings if o["class"] == "window"),
        "openings": openings,
        "surfaces": surfaces_clean,
        "pixels_per_meter": pixels_per_meter,
        # FIX: overlays et masques régénérés depuis les masques édités
        "overlay_openings_b64": _np_to_b64(overlay_openings),
        "overlay_interior_b64": _np_to_b64(overlay_interior) if overlay_interior is not None else None,
        "mask_doors_b64":   _np_to_b64(m_doors),
        "mask_windows_b64": _np_to_b64(m_windows),
        "mask_walls_b64":   _np_to_b64(walls),
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

            # SAM v1 nécessite set_image avant predict
            predictor.set_image(img_rgb)

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
# STEP 6 — EXPORT RAPPORT PDF
# FIX: utilise maintenant les masques/overlays passés en paramètre
#      (qui peuvent venir d'une session après édition)
# ============================================================
def generate_pdf_report(img_rgb: np.ndarray, overlay_openings: np.ndarray,
                        overlay_interior, mask_doors, mask_windows, mask_walls,
                        surfaces: dict, doors_count: int, windows_count: int,
                        ppm: float) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    from reportlab.lib.utils import ImageReader

    W_a4, H_a4 = A4
    M = 42

    BG     = colors.HexColor("#0B1220")
    CARD   = colors.HexColor("#101A2E")
    CARD2  = colors.HexColor("#0F172A")
    BORDER = colors.HexColor("#22304A")
    TXT    = colors.HexColor("#E8EEF7")
    MUTED  = colors.HexColor("#A9B4C7")
    ACCENT  = colors.HexColor("#60A5FA")
    MAGENTA = colors.HexColor("#D946EF")
    CYAN    = colors.HexColor("#22D3EE")
    GREEN   = colors.HexColor("#34D399")

    def pil_reader(arr):
        buf = io.BytesIO()
        Image.fromarray(arr.astype(np.uint8)).save(buf, format="PNG")
        buf.seek(0)
        return ImageReader(buf)

    def round_rect(c, x, y, w, h, r=16, fillColor=CARD, strokeColor=BORDER):
        c.saveState()
        c.setLineWidth(1); c.setFillColor(fillColor); c.setStrokeColor(strokeColor)
        c.roundRect(x, y, w, h, r, stroke=1, fill=1)
        c.restoreState()

    def kpi_card(c, x, y, w, h, label, value, color=ACCENT):
        round_rect(c, x, y, w, h, fillColor=CARD, strokeColor=BORDER)
        c.setFillColor(MUTED); c.setFont("Helvetica", 9)
        c.drawString(x+14, y+h-20, label)
        c.setFillColor(color); c.setFont("Helvetica-Bold", 18)
        c.drawString(x+14, y+16, value)

    def fmt(v, nd=2):
        if v is None: return "—"
        if isinstance(v, int): return str(v)
        return f"{v:.{nd}f}"

    buf_out = io.BytesIO()
    c = canvas.Canvas(buf_out, pagesize=A4)

    def page_bg():
        c.setFillColor(BG); c.rect(0, 0, W_a4, H_a4, stroke=0, fill=1)

    # === PAGE 1 ===
    page_bg()
    c.setFillColor(TXT); c.setFont("Helvetica-Bold", 20)
    c.drawString(M, H_a4-M-8, "FloorScan — Rapport d'Analyse")
    c.setFillColor(MUTED); c.setFont("Helvetica", 10)
    c.drawString(M, H_a4-M-28, "Multi-scale (2048 + 1024) · Roboflow + CubiCasa5k")

    kpi_y = H_a4-M-92
    gap = 12
    kpi_w = (W_a4-2*M-gap)/2
    kpi_h = 60

    kpi_card(c, M, kpi_y, kpi_w, kpi_h, "Portes détectées", f"🚪 {doors_count}", MAGENTA)
    kpi_card(c, M+(kpi_w+gap), kpi_y, kpi_w, kpi_h, "Fenêtres détectées", f"🪟 {windows_count}", CYAN)

    # Surfaces
    surf_y = kpi_y - 132
    surf_h = 112
    round_rect(c, M, surf_y, W_a4-2*M, surf_h, fillColor=CARD2, strokeColor=BORDER)
    c.setFillColor(TXT); c.setFont("Helvetica-Bold", 11)
    c.drawString(M+14, surf_y+surf_h-20, "Surfaces & périmètres")
    c.setFont("Helvetica", 10)
    yy = surf_y+surf_h-42
    if surfaces.get("area_building_m2"):
        c.setFillColor(ACCENT)
        c.drawString(M+14, yy, f"■ Emprise: {fmt(surfaces['area_building_m2'])} m²  •  Pourtour: {fmt(surfaces.get('perim_building_m'))} m")
        yy -= 16
    if surfaces.get("area_walls_m2"):
        c.setFillColor(MAGENTA)
        c.drawString(M+14, yy, f"■ Murs: {fmt(surfaces['area_walls_m2'])} m²")
        yy -= 16
    if surfaces.get("area_hab_m2"):
        c.setFillColor(GREEN)
        c.drawString(M+14, yy, f"■ Surface habitable: {fmt(surfaces['area_hab_m2'])} m²  •  Pourtour: {fmt(surfaces.get('perim_interior_m'))} m")
        yy -= 16
    if ppm:
        c.setFillColor(MUTED)
        c.drawString(M+14, yy, f"pixels_per_meter = {fmt(ppm)}")

    # Images
    img_gap = 12
    img_card_h = (surf_y-M-img_gap)/2
    img_card_w = W_a4-2*M

    # Plan de base
    round_rect(c, M, M+img_card_h+img_gap, img_card_w, img_card_h, fillColor=CARD2, strokeColor=BORDER)
    c.setFillColor(TXT); c.setFont("Helvetica-Bold", 12)
    c.drawString(M+16, M+2*img_card_h+img_gap-22, "Plan de base")
    iw, ih = img_card_w-28, img_card_h-34
    H_arr, W_arr = img_rgb.shape[:2]
    scale = min(iw/W_arr, ih/H_arr)
    dw, dh = W_arr*scale, H_arr*scale
    c.drawImage(pil_reader(img_rgb), M+14+(iw-dw)/2, M+img_card_h+img_gap+14+(ih-dh)/2, dw, dh)

    # Overlay
    round_rect(c, M, M, img_card_w, img_card_h, fillColor=CARD2, strokeColor=BORDER)
    c.setFillColor(TXT); c.setFont("Helvetica-Bold", 12)
    c.drawString(M+16, M+img_card_h-22, "Overlay — Emprise + Portes + Fenêtres")
    H_ov, W_ov = overlay_openings.shape[:2]
    scale2 = min(iw/W_ov, ih/H_ov)
    dw2, dh2 = W_ov*scale2, H_ov*scale2
    c.drawImage(pil_reader(overlay_openings), M+14+(iw-dw2)/2, M+14+(ih-dh2)/2, dw2, dh2)

    c.showPage()

    # === PAGE 2 : Intérieur ===
    if overlay_interior is not None:
        page_bg()
        c.setFillColor(TXT); c.setFont("Helvetica-Bold", 18)
        c.drawString(M, H_a4-M-8, "Overlay — Surface habitable (vert)")
        round_rect(c, M, M, W_a4-2*M, H_a4-2*M-44, fillColor=CARD2, strokeColor=BORDER)
        iw2, ih2 = W_a4-2*M-28, H_a4-2*M-44-34
        H_in, W_in = overlay_interior.shape[:2]
        scale3 = min(iw2/W_in, ih2/H_in)
        dw3, dh3 = W_in*scale3, H_in*scale3
        c.drawImage(pil_reader(overlay_interior), M+14+(iw2-dw3)/2, M+14+(ih2-dh3)/2, dw3, dh3)
        c.showPage()

    # === PAGE 3 : Masques ===
    masks = []
    if mask_doors   is not None: masks.append(("Masque — Portes",    mask_doors))
    if mask_windows is not None: masks.append(("Masque — Fenêtres",  mask_windows))
    if mask_walls   is not None: masks.append(("Masque — Murs",      mask_walls))

    if masks:
        page_bg()
        c.setFillColor(TXT); c.setFont("Helvetica-Bold", 18)
        c.drawString(M, H_a4-M-8, "Masques de détection")
        grid_top = H_a4-M-44; grid_bottom = M
        grid_h = grid_top-grid_bottom; grid_w = W_a4-2*M
        gap_g = 12
        cell_w = (grid_w-gap_g)/2; cell_h = (grid_h-gap_g)/2
        positions = [
            (M,                grid_bottom+cell_h+gap_g),
            (M+cell_w+gap_g,   grid_bottom+cell_h+gap_g),
            (M,                grid_bottom),
            (M+cell_w+gap_g,   grid_bottom),
        ]
        for i, (title, arr) in enumerate(masks[:4]):
            xx, yy = positions[i]
            round_rect(c, xx, yy, cell_w, cell_h, fillColor=CARD2, strokeColor=BORDER)
            c.setFillColor(TXT); c.setFont("Helvetica-Bold", 12)
            c.drawString(xx+16, yy+cell_h-22, title)
            iw3, ih3 = cell_w-28, cell_h-34
            if arr.ndim == 2:
                arr_rgb = cv2.cvtColor(arr, cv2.COLOR_GRAY2RGB)
            else:
                arr_rgb = arr
            Hm, Wm = arr_rgb.shape[:2]
            sc = min(iw3/Wm, ih3/Hm)
            c.drawImage(pil_reader(arr_rgb), xx+14+(iw3-Wm*sc)/2, yy+14+(ih3-Hm*sc)/2, Wm*sc, Hm*sc)
        c.showPage()

    c.save()
    return buf_out.getvalue()
