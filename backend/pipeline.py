# pipeline.py — Logique extraite du notebook floor_plan_module_09_02
# Adaptée pour être appelée depuis FastAPI

import os, io, json, math, time, tempfile, base64
import numpy as np
import cv2
from PIL import Image
import fitz  # PyMuPDF


# ============================================================
# CONFIG (peut être surchargée depuis les paramètres API)
# ============================================================
DEFAULT_CONFIG = {
    "api_key": "Kh56un5foPflRVreiNOM",
    "model_id": "cubicasa5k-2-qpmsa-1gd2e/1",
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
def get_pdf_page_count(pdf_bytes: bytes) -> int:
    """Retourne le nombre de pages d'un PDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    return len(doc)

def pdf_to_image(pdf_bytes: bytes, zoom: float = 3.0, page_index: int = 0) -> np.ndarray:
    """Rendu d'une page d'un PDF en numpy RGB array."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_index = max(0, min(page_index, len(doc) - 1))
    page = doc[page_index]
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

    from inference_sdk import InferenceHTTPClient
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
    import pandas as pd
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
