# main.py — Serveur FastAPI FloorScan
# Lancer avec : uvicorn main:app --reload --host 0.0.0.0 --port 8000

import os, io, json, uuid, base64, time, threading, logging
from pathlib import Path
from typing import Optional

import numpy as np
import cv2
from PIL import Image

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel, ConfigDict, field_validator

import pipeline

logger = logging.getLogger(__name__)

app = FastAPI(title="FloorScan API", version="1.0.0")

# CORS : restrict to known frontend origins (fallback to * for local dev)
ALLOWED_ORIGINS = os.environ.get("CORS_ORIGINS", "*")
_origins = ALLOWED_ORIGINS.split(",") if ALLOWED_ORIGINS != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# STORE EN MÉMOIRE (remplacer par Redis/DB en prod)
# sessions[session_id] = { img_rgb, m_doors, m_windows, walls,
#                           interior_mask, pixels_per_meter,
#                           analysis_result, _last_access }
# ============================================================
sessions: dict = {}

# ── Session expiration & per-session locks ────────────────────
SESSION_TTL_SECONDS = int(os.environ.get("SESSION_TTL", "3600"))  # 1h default
SESSION_MAX_COUNT = int(os.environ.get("SESSION_MAX", "50"))

_session_locks: dict[str, threading.Lock] = {}
_global_lock = threading.Lock()


def _get_session_lock(session_id: str) -> threading.Lock:
    """Get or create a per-session lock (thread-safe)."""
    with _global_lock:
        if session_id not in _session_locks:
            _session_locks[session_id] = threading.Lock()
        return _session_locks[session_id]


def _touch_session(session_id: str):
    """Update last access timestamp for a session."""
    if session_id in sessions:
        sessions[session_id]["_last_access"] = time.time()


def _cleanup_expired_sessions():
    """Remove expired sessions (called on new session creation)."""
    now = time.time()
    expired = [
        sid for sid, s in sessions.items()
        if now - s.get("_last_access", 0) > SESSION_TTL_SECONDS
    ]
    for sid in expired:
        sessions.pop(sid, None)
        _session_locks.pop(sid, None)
    # If still over limit, remove oldest sessions
    if len(sessions) > SESSION_MAX_COUNT:
        sorted_sessions = sorted(
            sessions.items(), key=lambda kv: kv[1].get("_last_access", 0)
        )
        for sid, _ in sorted_sessions[: len(sessions) - SESSION_MAX_COUNT]:
            sessions.pop(sid, None)
            _session_locks.pop(sid, None)


# ============================================================
# HELPERS
# ============================================================
def b64_to_np_gray(b64: str) -> np.ndarray:
    data = base64.b64decode(b64)
    pil = Image.open(io.BytesIO(data)).convert("L")
    return np.array(pil)

def b64_to_np_rgb(b64: str) -> np.ndarray:
    data = base64.b64decode(b64)
    pil = Image.open(io.BytesIO(data)).convert("RGB")
    return np.array(pil)


# ============================================================
# ROUTE 1 — HEALTH CHECK
# ============================================================
@app.get("/")
def root():
    return {"status": "ok", "service": "FloorScan API", "active_sessions": len(sessions)}


# ============================================================
# ROUTE 2 — UPLOAD PDF → rendu image base64
# ============================================================
class UploadPdfRequest(BaseModel):
    pdf_base64: str
    filename: str = "plan.pdf"
    zoom: float = 3.0
    page: int = 0          # index de page (0 = première page)

    @field_validator("pdf_base64")
    @classmethod
    def limit_size(cls, v: str) -> str:
        max_bytes = 100 * 1024 * 1024  # 100 MB
        if len(v) > max_bytes:
            raise ValueError(f"PDF too large (max {max_bytes // 1024 // 1024} MB)")
        return v

@app.post("/upload-pdf")
async def upload_pdf(req: UploadPdfRequest):
    if not req.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Fichier PDF requis")
    try:
        pdf_bytes = base64.b64decode(req.pdf_base64)
    except Exception:
        raise HTTPException(400, "Base64 invalide")
    try:
        page_count = pipeline.get_pdf_page_count(pdf_bytes)
        img_rgb = pipeline.pdf_to_image(pdf_bytes, zoom=req.zoom, page_index=req.page)
    except Exception as e:
        raise HTTPException(500, f"Erreur rendu PDF : {e}")

    _cleanup_expired_sessions()
    session_id = str(uuid.uuid4())
    sessions[session_id] = {"img_rgb": img_rgb, "_last_access": time.time()}

    H, W = img_rgb.shape[:2]
    b64 = pipeline._np_to_b64(img_rgb)

    return {
        "session_id": session_id,
        "width": W, "height": H,
        "image_b64": b64,
        "page_count": page_count,
        "page": req.page,
    }


# ============================================================
# ROUTE 2a-bis — PDF THUMBNAILS (small previews of all pages)
# ============================================================
class PdfThumbnailsRequest(BaseModel):
    pdf_base64: str
    max_pages: int = 20

@app.post("/pdf-thumbnails")
async def pdf_thumbnails(req: PdfThumbnailsRequest):
    try:
        pdf_bytes = base64.b64decode(req.pdf_base64)
    except Exception:
        raise HTTPException(400, "Base64 invalide")
    try:
        page_count = pipeline.get_pdf_page_count(pdf_bytes)
        thumbs = []
        for i in range(min(page_count, req.max_pages)):
            # Render at low zoom for thumbnail (0.5 = ~150dpi)
            img_rgb = pipeline.pdf_to_image(pdf_bytes, zoom=0.5, page_index=i)
            # Encode as JPEG for small size
            img_pil = Image.fromarray(img_rgb).convert("RGB")
            buf = io.BytesIO()
            img_pil.save(buf, format="JPEG", quality=60)
            buf.seek(0)
            thumbs.append(base64.b64encode(buf.read()).decode())
    except Exception as e:
        raise HTTPException(500, f"Erreur thumbnails PDF : {e}")

    return {
        "page_count": page_count,
        "thumbnails": thumbs,
    }


# ============================================================
# ROUTE 2b — UPLOAD IMAGE (PNG/JPG) → session
# ============================================================
class UploadImageRequest(BaseModel):
    image_base64: str
    filename: str = "plan.png"

    @field_validator("image_base64")
    @classmethod
    def limit_size(cls, v: str) -> str:
        max_bytes = 50 * 1024 * 1024  # 50 MB
        if len(v) > max_bytes:
            raise ValueError(f"Image too large (max {max_bytes // 1024 // 1024} MB)")
        return v

@app.post("/upload-image")
async def upload_image(req: UploadImageRequest):
    try:
        img_bytes = base64.b64decode(req.image_base64)
    except Exception:
        raise HTTPException(400, "Base64 invalide")
    try:
        from PIL import Image as PILImage
        import io as _io
        pil_img = PILImage.open(_io.BytesIO(img_bytes)).convert("RGB")
        img_rgb = np.array(pil_img)
    except Exception as e:
        raise HTTPException(500, f"Erreur lecture image : {e}")

    _cleanup_expired_sessions()
    session_id = str(uuid.uuid4())
    sessions[session_id] = {"img_rgb": img_rgb, "_last_access": time.time()}

    H, W = img_rgb.shape[:2]
    b64 = pipeline._np_to_b64(img_rgb)

    return {
        "session_id": session_id,
        "width": W, "height": H,
        "image_b64": b64,
        "page_count": 1,
        "page": 0,
    }


# ============================================================
# ROUTE 3 — CROP
# ============================================================
class CropRequest(BaseModel):
    session_id: str
    x0: int; y0: int; x1: int; y1: int

@app.post("/crop")
def crop(req: CropRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    with _get_session_lock(req.session_id):
        cropped = pipeline.crop_image(s["img_rgb"], req.x0, req.y0, req.x1, req.y1)
        if cropped.size == 0:
            raise HTTPException(400, "Zone de crop invalide")

        sessions[req.session_id]["img_rgb"] = cropped
        _touch_session(req.session_id)

    H, W = cropped.shape[:2]
    b64 = pipeline._np_to_b64(cropped)

    return {"width": W, "height": H, "image_b64": b64}


# ============================================================
# ROUTE 4 — CALIBRATION MANUELLE
# ============================================================
class CalibRequest(BaseModel):
    session_id: str
    x1: float; y1: float; x2: float; y2: float; real_m: float

@app.post("/calibrate")
def calibrate(req: CalibRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    if req.real_m <= 0:
        raise HTTPException(400, "La distance réelle doit être > 0")
    dist_px = ((req.x2 - req.x1) ** 2 + (req.y2 - req.y1) ** 2) ** 0.5
    if dist_px < 1:
        raise HTTPException(400, "Les deux points sont trop proches")

    with _get_session_lock(req.session_id):
        ppm = pipeline.compute_scale(req.x1, req.y1, req.x2, req.y2, req.real_m)
        sessions[req.session_id]["pixels_per_meter"] = ppm
        _touch_session(req.session_id)

    return {"pixels_per_meter": ppm}


# ── Helpers: compressed undo snapshots (PNG bytes, ~20x smaller than raw numpy) ──
def _compress_mask(arr: np.ndarray) -> bytes:
    """Encode RGBA numpy array → PNG bytes for memory-efficient storage."""
    ok, buf = cv2.imencode(".png", arr)
    return buf.tobytes() if ok else arr.tobytes()

def _decompress_mask(data: bytes, shape: tuple) -> np.ndarray:
    """Decode PNG bytes → RGBA numpy array."""
    arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if arr is not None:
        return arr
    logger.warning("Failed to decompress mask, returning blank")
    return np.zeros(shape, dtype=np.uint8)

# ============================================================
# ROUTE 5 — ANALYSE COMPLÈTE (Roboflow + surfaces)
# ============================================================
class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    session_id: str
    roboflow_api_key: str = "tyCM9PZp8cs3KtifPUaQ"
    model_id: str = "cubicasa5k-2-qpmsa-1gd2e/1"
    pixels_per_meter: Optional[float] = None
    conf_min_door: float = 0.05
    conf_min_win: float = 0.15
    wall_thickness_m: float = 0.20
    pipeline_mode: str = "bestof"  # "default" = single model A, "bestof" = A+D combined
    # Optional detection zone: only this area is sent to AI, results remapped to full image
    # {x, y, w, h} normalized [0-1] in the original image
    detection_roi: Optional[dict] = None

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    img_rgb = s["img_rgb"]
    full_H, full_W = img_rgb.shape[:2]
    ppm = req.pixels_per_meter or s.get("pixels_per_meter")

    # ── Optional detection ROI: crop before analysis, remap after ──
    roi = req.detection_roi
    roi_applied = False
    roi_x0 = roi_y0 = 0
    roi_w = full_W
    roi_h = full_H
    if roi and all(k in roi for k in ("x", "y", "w", "h")):
        rx, ry, rw, rh = float(roi["x"]), float(roi["y"]), float(roi["w"]), float(roi["h"])
        if rw > 0.01 and rh > 0.01:
            roi_x0 = max(0, int(rx * full_W))
            roi_y0 = max(0, int(ry * full_H))
            roi_x1 = min(full_W, int((rx + rw) * full_W))
            roi_y1 = min(full_H, int((ry + rh) * full_H))
            roi_w = roi_x1 - roi_x0
            roi_h = roi_y1 - roi_y0
            if roi_w > 10 and roi_h > 10:
                img_rgb = img_rgb[roi_y0:roi_y1, roi_x0:roi_x1].copy()
                if ppm:
                    # ppm stays the same (same image, just cropped)
                    pass
                roi_applied = True

    cfg = dict(pipeline.DEFAULT_CONFIG)
    cfg["api_key"]          = req.roboflow_api_key
    cfg["model_id"]         = req.model_id
    cfg["conf_min_door"]    = req.conf_min_door
    cfg["conf_min_win"]     = req.conf_min_win
    cfg["wall_thickness_m"] = req.wall_thickness_m
    cfg["pipeline_mode"]    = req.pipeline_mode

    try:
        if req.model_id in ("pixel_ia_mix", "pure_cv_walls"):
            from inference_sdk import InferenceHTTPClient
            img_pil = Image.fromarray(img_rgb).convert("RGB")
            client = InferenceHTTPClient(api_url="https://serverless.roboflow.com", api_key=cfg["api_key"])

            if req.model_id == "pure_cv_walls":
                from pipeline_v4 import run_pipeline_w
                raw = run_pipeline_w(img_rgb, img_pil, client, ppm, cfg)
            else:
                from pipeline_diagonal import run_pipeline_i
                raw = run_pipeline_i(img_rgb, img_pil, client, ppm, cfg)

            plan_b64 = pipeline._np_to_b64(img_rgb)
            H, W = img_rgb.shape[:2]
            _empty = np.zeros((H, W), np.uint8)
            _m_doors_raw = raw.get("_m_doors_raw", _empty)
            _m_wins_raw = raw.get("_m_windows_raw", _empty)
            _m_walls_raw = raw.get("_m_walls_raw", _empty)
            result = {
                "doors_count": raw.get("doors_count", 0),
                "windows_count": raw.get("windows_count", 0),
                "french_doors_count": 0,
                "mask_doors_b64": raw.get("mask_doors_b64"),
                "mask_windows_b64": raw.get("mask_windows_b64"),
                "mask_walls_ai_b64": raw.get("mask_walls_b64"),
                "overlay_openings_b64": plan_b64,
                "overlay_interior_b64": raw.get("mask_hab_b64"),
                "plan_b64": plan_b64,
                "surfaces": {
                    "area_building_m2": raw.get("footprint_area_m2"),
                    "perim_building_m": None,
                    "area_hab_m2": raw.get("hab_area_m2"),
                    "perim_interior_m": None,
                    "area_walls_m2": raw.get("walls_area_m2"),
                },
                "pixels_per_meter": ppm,
                "rooms": raw.get("rooms", []),
                "openings": [],
                # Internal raw masks for session storage (editor needs these)
                "_m_doors": _m_doors_raw,
                "_m_windows": _m_wins_raw,
                "_walls": _m_walls_raw,
                "_m_walls_ai": _m_walls_raw,
                "_m_walls_pixel": _empty,
                "_m_cloisons": _empty,
                "_m_french_doors": _empty,
                "_mask_rooms_rgba": None,
            }
        else:
            result = pipeline.run_analysis(img_rgb, pixels_per_meter=ppm, cfg=cfg)
    except Exception as e:
        raise HTTPException(500, f"Erreur analyse : {e}")

    # ── If detection ROI was applied, remap everything to full image coords ──
    if roi_applied:
        import cv2
        full_img = s["img_rgb"]  # original full image
        # Helper: embed a small mask into a full-size black canvas
        def _embed_mask(small_mask):
            if small_mask is None or small_mask.size == 0:
                return np.zeros((full_H, full_W), dtype=np.uint8)
            if small_mask.ndim == 3:  # RGBA
                canvas = np.zeros((full_H, full_W, small_mask.shape[2]), dtype=np.uint8)
                canvas[roi_y0:roi_y0+small_mask.shape[0], roi_x0:roi_x0+small_mask.shape[1]] = small_mask
            else:
                canvas = np.zeros((full_H, full_W), dtype=np.uint8)
                canvas[roi_y0:roi_y0+small_mask.shape[0], roi_x0:roi_x0+small_mask.shape[1]] = small_mask
            return canvas

        # Remap internal masks
        for mkey in ["_m_doors", "_m_windows", "_m_walls_ai", "_m_walls_pixel", "_m_cloisons", "_m_french_doors"]:
            if mkey in result:
                result[mkey] = _embed_mask(np.array(result[mkey], dtype=np.uint8))
        if "_walls" in result:
            result["_walls"] = _embed_mask(np.array(result["_walls"], dtype=np.uint8))
        if "_mask_rooms_rgba" in result:
            result["_mask_rooms_rgba"] = _embed_mask(np.array(result["_mask_rooms_rgba"]))

        # Remap base64 mask images (re-encode from embedded)
        def _encode_mask_b64(arr):
            if arr is None or arr.size == 0:
                return None
            from io import BytesIO
            from PIL import Image as PILImage
            im = PILImage.fromarray(arr)
            buf = BytesIO()
            im.save(buf, format="PNG")
            return base64.b64encode(buf.getvalue()).decode()

        for bkey in ["mask_doors_b64", "mask_windows_b64", "mask_walls_ai_b64", "mask_walls_pixel_b64",
                      "mask_cloisons_b64", "mask_french_doors_b64", "mask_rooms_b64"]:
            if bkey in result and result[bkey]:
                # Decode, embed, re-encode
                raw = base64.b64decode(result[bkey])
                small = np.array(PILImage.open(BytesIO(raw)))
                full = _embed_mask(small)
                result[bkey] = _encode_mask_b64(full)

        # Remap overlay images (RGBA)
        for okey in ["overlay_openings_b64", "plan_b64"]:
            if okey in result and result[okey]:
                raw = base64.b64decode(result[okey])
                small = np.array(PILImage.open(BytesIO(raw)))
                if okey == "plan_b64":
                    # plan_b64 should be the FULL original image
                    buf = BytesIO()
                    PILImage.fromarray(full_img).save(buf, format="PNG")
                    result[okey] = base64.b64encode(buf.getvalue()).decode()
                else:
                    full_overlay = _embed_mask(small)
                    result[okey] = _encode_mask_b64(full_overlay)

        # Remap opening bounding boxes (normalized to crop → normalized to full image)
        if "openings" in result:
            for op in result["openings"]:
                if "x_px" in op:
                    op["x_px"] = op["x_px"] + roi_x0
                    op["y_px"] = op["y_px"] + roi_y0
                if "bbox_norm" in op:
                    bn = op["bbox_norm"]
                    bn["x"] = (bn["x"] * roi_w + roi_x0) / full_W
                    bn["y"] = (bn["y"] * roi_h + roi_y0) / full_H
                    bn["w"] = bn["w"] * roi_w / full_W
                    bn["h"] = bn["h"] * roi_h / full_H

        # Remap rooms
        if "rooms" in result:
            for room in result["rooms"]:
                if "centroid_norm" in room:
                    c = room["centroid_norm"]
                    c["x"] = (c["x"] * roi_w + roi_x0) / full_W
                    c["y"] = (c["y"] * roi_h + roi_y0) / full_H
                if "bbox_norm" in room:
                    bn = room["bbox_norm"]
                    bn["x"] = (bn["x"] * roi_w + roi_x0) / full_W
                    bn["y"] = (bn["y"] * roi_h + roi_y0) / full_H
                    bn["w"] = bn["w"] * roi_w / full_W
                    bn["h"] = bn["h"] * roi_h / full_H
                if "polygon_norm" in room and room["polygon_norm"]:
                    room["polygon_norm"] = [
                        {"x": (p["x"] * roi_w + roi_x0) / full_W, "y": (p["y"] * roi_h + roi_y0) / full_H}
                        for p in room["polygon_norm"]
                    ]

        # Remap walls
        if "walls" in result and isinstance(result.get("walls"), list):
            for w in result["walls"]:
                for k in ["x1_norm", "x2_norm"]:
                    if k in w: w[k] = (w[k] * roi_w + roi_x0) / full_W
                for k in ["y1_norm", "y2_norm"]:
                    if k in w: w[k] = (w[k] * roi_h + roi_y0) / full_H

        # Store detection_roi in result for frontend reference
        result["detection_roi"] = {"x": roi_x0/full_W, "y": roi_y0/full_H, "w": roi_w/full_W, "h": roi_h/full_H}

    # Stocker les masques bruts + masque intérieur pour édition
    interior_mask = result.get("surfaces", {}).get("interior_mask")

    with _get_session_lock(req.session_id):
        sessions[req.session_id].update({
            "m_doors":          np.array(result["_m_doors"],        dtype=np.uint8),
            "m_windows":        np.array(result["_m_windows"],      dtype=np.uint8),
            "walls":            np.array(result["_walls"],          dtype=np.uint8),
            "m_walls_ai":       np.array(result["_m_walls_ai"],     dtype=np.uint8),
            "m_walls_pixel":    np.array(result["_m_walls_pixel"],  dtype=np.uint8),
            "m_cloisons":       np.array(result["_m_cloisons"],     dtype=np.uint8),
            "m_french_doors":   np.array(result.get("_m_french_doors", np.zeros_like(result["_m_doors"])), dtype=np.uint8),
            "interior_mask":    interior_mask,
            "pixels_per_meter": result["pixels_per_meter"],
            "mask_rooms_rgba":  result["_mask_rooms_rgba"],   # numpy RGBA pour édition
            "mask_rooms_history": [],  # undo stack (compressed PNG bytes, max 10)
            "mask_rooms_future":  [],  # redo stack (compressed PNG bytes, max 10)
            "mask_edit_history":  [],  # undo stack for door/window/interior edits
            "mask_edit_future":   [],  # redo stack for door/window/interior edits
            "cfg":              cfg,
            "analysis":         result,
        })
        _touch_session(req.session_id)

    # Nettoyer la réponse JSON
    resp = {k: v for k, v in result.items() if not k.startswith("_")}
    if "surfaces" in resp and "interior_mask" in resp["surfaces"]:
        del resp["surfaces"]["interior_mask"]

    return resp


# ── Multi-model comparison (admin only) ─────────────────────
class CompareRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    session_id: str
    roboflow_api_key: str = "tyCM9PZp8cs3KtifPUaQ"

@app.post("/compare")
def compare(req: CompareRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    img_rgb = s["img_rgb"]
    ppm = s.get("pixels_per_meter")
    cfg = s.get("cfg", dict(pipeline.DEFAULT_CONFIG))
    cfg["api_key"] = req.roboflow_api_key

    existing_analysis = s.get("analysis")

    try:
        result = pipeline.run_comparison(img_rgb, ppm, cfg, existing_analysis)
    except Exception as e:
        raise HTTPException(500, f"Erreur comparaison : {e}")

    with _get_session_lock(req.session_id):
        sessions[req.session_id]["comparison"] = result
        _touch_session(req.session_id)

    return result


# ============================================================
# ROUTE 6 — ÉDITEUR : MODIFIER UN MASQUE
# Supporte désormais layer = "door" | "window" | "interior"
# ============================================================
class EditMaskRequest(BaseModel):
    session_id: str
    layer: str         # "door" | "window" | "interior"
    action: str        # "add_rect" | "erase_rect" | "add_poly" | "erase_poly"
    x0: Optional[float] = None
    y0: Optional[float] = None
    x1: Optional[float] = None
    y1: Optional[float] = None
    points: Optional[list] = None

@app.post("/edit-mask")
def edit_mask(req: EditMaskRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    if "m_doors" not in s:
        raise HTTPException(400, "Lancez d'abord /analyze")

    img_rgb = s["img_rgb"]
    H, W    = img_rgb.shape[:2]
    cfg     = s.get("cfg", pipeline.DEFAULT_CONFIG)

    # ── Push undo snapshot for mask edit ──
    snapshot = {
        "m_doors":         _compress_mask(s["m_doors"]),
        "m_windows":       _compress_mask(s["m_windows"]),
        "m_french_doors":  _compress_mask(s["m_french_doors"]) if s.get("m_french_doors") is not None else None,
        "interior_mask":   _compress_mask(s["interior_mask"])  if s.get("interior_mask")  is not None else None,
        "m_walls_pixel":   _compress_mask(s["m_walls_pixel"])  if s.get("m_walls_pixel")  is not None else None,
        "m_cloisons":      _compress_mask(s["m_cloisons"])     if s.get("m_cloisons")     is not None else None,
    }
    history = s.setdefault("mask_edit_history", [])
    history.append(snapshot)
    if len(history) > 10:
        history.pop(0)
    s["mask_edit_future"] = []  # clear redo on new edit

    # Sélectionner le bon masque
    if req.layer == "door":
        mask = s["m_doors"].copy()
    elif req.layer == "window":
        mask = s["m_windows"].copy()
    elif req.layer == "interior":
        existing = s.get("interior_mask")
        mask = existing.copy() if existing is not None else np.zeros((H, W), np.uint8)
    elif req.layer == "wall":
        existing = s.get("m_walls_pixel")
        mask = existing.copy() if existing is not None else np.zeros((H, W), np.uint8)
    elif req.layer == "french_door":
        existing = s.get("m_french_doors")
        mask = existing.copy() if existing is not None else np.zeros((H, W), np.uint8)
    elif req.layer == "cloison":
        existing = s.get("m_cloisons")
        mask = existing.copy() if existing is not None else np.zeros((H, W), np.uint8)
    else:
        raise HTTPException(400, "layer invalide")

    # Appliquer l'action
    add = req.action.startswith("add")

    if "rect" in req.action:
        if None in [req.x0, req.y0, req.x1, req.y1]:
            raise HTTPException(400, "x0,y0,x1,y1 requis pour rect")
        xa, xb = sorted([int(req.x0), int(req.x1)])
        ya, yb = sorted([int(req.y0), int(req.y1)])
        xa = max(0,min(xa,W-1)); xb = max(0,min(xb,W-1))
        ya = max(0,min(ya,H-1)); yb = max(0,min(yb,H-1))
        val = 255 if add else 0
        cv2.rectangle(mask, (xa,ya), (xb,yb), val, -1)

    elif "poly" in req.action:
        if not req.points or len(req.points) < 3:
            raise HTTPException(400, "Au moins 3 points requis pour poly")
        pts = np.array([[int(round(p[0])), int(round(p[1]))] for p in req.points], dtype=np.int32)
        val = 255 if add else 0
        cv2.fillPoly(mask, [pts.reshape(-1,1,2)], val)

    else:
        raise HTTPException(400, "action invalide. Options: add_rect, erase_rect, add_poly, erase_poly")

    # Stocker le masque mis à jour
    if req.layer == "door":
        sessions[req.session_id]["m_doors"] = mask
    elif req.layer == "window":
        sessions[req.session_id]["m_windows"] = mask
    elif req.layer == "interior":
        sessions[req.session_id]["interior_mask"] = mask
    elif req.layer == "wall":
        sessions[req.session_id]["m_walls_pixel"] = mask
        # Recompute cloisons depuis le masque pixel édité
        m_walls_ai = s.get("m_walls_ai")
        cnt_stored  = s.get("analysis", {}).get("_cnt")
        cnt_np = np.array(cnt_stored, dtype=np.int32) if cnt_stored is not None else None
        new_cloisons = pipeline._compute_cloisons(
            m_walls_ai if m_walls_ai is not None else np.zeros((H, W), np.uint8),
            mask, cnt_np, H, W
        )
        sessions[req.session_id]["m_cloisons"] = new_cloisons
        # Réponse légère : uniquement les deux masques mis à jour
        wp_b64 = pipeline._np_to_b64(pipeline._mask_to_rgba(mask, (239, 68, 68), 80)) if cv2.countNonZero(mask) > 0 else None
        cl_b64 = pipeline._np_to_b64(pipeline._mask_to_rgba(new_cloisons, (0, 100, 255), 210)) if cv2.countNonZero(new_cloisons) > 0 else None
        sessions[req.session_id]["analysis"]["mask_walls_pixel_b64"] = wp_b64
        sessions[req.session_id]["analysis"]["mask_cloisons_b64"]    = cl_b64
        _touch_session(req.session_id)
        return {
            "mask_walls_pixel_b64": wp_b64,
            "mask_cloisons_b64":    cl_b64,
            "edit_history_len": len(s.get("mask_edit_history", [])),
            "edit_future_len":  len(s.get("mask_edit_future",  [])),
        }
    elif req.layer == "french_door":
        sessions[req.session_id]["m_french_doors"] = mask
        fd_b64 = pipeline._np_to_b64(pipeline._mask_to_rgba(mask, (249, 115, 22), 90)) if cv2.countNonZero(mask) > 0 else None
        sessions[req.session_id]["analysis"]["mask_french_doors_b64"] = fd_b64
        sessions[req.session_id]["analysis"]["french_doors_count"] = pipeline._count_connected_components(mask)
        _touch_session(req.session_id)
        return {
            "mask_french_doors_b64": fd_b64,
            "french_doors_count": sessions[req.session_id]["analysis"]["french_doors_count"],
            "edit_history_len": len(s.get("mask_edit_history", [])),
            "edit_future_len":  len(s.get("mask_edit_future",  [])),
        }
    elif req.layer == "cloison":
        sessions[req.session_id]["m_cloisons"] = mask
        cl_b64 = pipeline._np_to_b64(pipeline._mask_to_rgba(mask, (0, 100, 255), 210)) if cv2.countNonZero(mask) > 0 else None
        sessions[req.session_id]["analysis"]["mask_cloisons_b64"] = cl_b64
        _touch_session(req.session_id)
        return {
            "mask_cloisons_b64": cl_b64,
            "edit_history_len": len(s.get("mask_edit_history", [])),
            "edit_future_len":  len(s.get("mask_edit_future",  [])),
        }

    # Recalculer surfaces + overlays (door / window / interior uniquement)
    ppm = s.get("pixels_per_meter")
    interior_override = sessions[req.session_id].get("interior_mask") if req.layer == "interior" else None

    result = pipeline.recompute_from_edited_masks(
        img_rgb,
        sessions[req.session_id]["m_doors"],
        sessions[req.session_id]["m_windows"],
        s["walls"],
        ppm,
        cfg,
        interior_mask_override=interior_override,
        m_walls_ai=s.get("m_walls_ai"),
    )

    sessions[req.session_id]["analysis"].update({
        "overlay_openings_b64": result["overlay_openings_b64"],
        "overlay_interior_b64": result.get("overlay_interior_b64"),
        "mask_doors_b64":       result["mask_doors_b64"],
        "mask_windows_b64":     result["mask_windows_b64"],
        "mask_walls_b64":       result["mask_walls_b64"],
        "doors_count":          result["doors_count"],
        "windows_count":        result["windows_count"],
        "surfaces":             result["surfaces"],
        "pixels_per_meter":     result.get("pixels_per_meter"),
    })
    if result.get("_interior_mask") is not None:
        sessions[req.session_id]["interior_mask"] = result["_interior_mask"]

    resp = {k: v for k, v in result.items() if not k.startswith("_")}
    resp["rooms"] = sessions[req.session_id]["analysis"].get("rooms", [])
    resp["walls"] = sessions[req.session_id]["analysis"].get("walls", [])
    resp["edit_history_len"] = len(s.get("mask_edit_history", []))
    resp["edit_future_len"]  = len(s.get("mask_edit_future",  []))
    _touch_session(req.session_id)
    return resp


# ============================================================
# ROUTE 6b — ÉDITER LE MASQUE DES PIÈCES
# ============================================================
class EditRoomMaskRequest(BaseModel):
    session_id: str
    action: str          # "add_rect"|"erase_rect"|"add_poly"|"erase_poly"|"delete_room"|"replace_polygon"|"merge_rooms"|"split_room"
    room_type: str = "bedroom"
    room_id: Optional[int] = None
    room_id_b: Optional[int] = None       # second room for merge
    x0: Optional[float] = None
    y0: Optional[float] = None
    x1: Optional[float] = None
    y1: Optional[float] = None
    points: Optional[list] = None
    polygon_norm: Optional[list] = None   # [{x: float, y: float}, ...] — normalized 0-1 coords
    cut_points: Optional[list] = None     # [{x, y}, {x, y}] — normalized, for split_room

@app.post("/edit-room-mask")
def edit_room_mask(req: EditRoomMaskRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    mask_rgba = s.get("mask_rooms_rgba")
    if mask_rgba is None:
        raise HTTPException(400, "Aucun masque de pièces disponible")

    ppm = s.get("pixels_per_meter")
    H, W = mask_rgba.shape[:2]

    # ── Push undo snapshot before any modification (compressed PNG) ──
    history = s.setdefault("mask_rooms_history", [])
    history.append(_compress_mask(mask_rgba))
    if len(history) > 10:
        history.pop(0)
    s["mask_rooms_future"] = []  # clear redo stack on new edit

    if req.action == "delete_room":
        rooms = s["analysis"].get("rooms", [])
        room = next((r for r in rooms if r["id"] == req.room_id), None)
        if room is None:
            raise HTTPException(404, "Pièce introuvable")
        # Effacer via polygone si disponible, sinon via bbox
        poly = room.get("polygon_norm")
        if poly:
            pts = [[int(p["x"] * W), int(p["y"] * H)] for p in poly]
            mask_rgba = pipeline.edit_room_mask(mask_rgba, "erase_poly", room.get("type", req.room_type), points=pts)
        else:
            bbn = room["bbox_norm"]
            x0 = int(bbn["x"] * W); y0 = int(bbn["y"] * H)
            x1 = int((bbn["x"] + bbn["w"]) * W); y1 = int((bbn["y"] + bbn["h"]) * H)
            mask_rgba = pipeline.edit_room_mask(mask_rgba, "erase_rect", req.room_type,
                                                 x0=x0, y0=y0, x1=x1, y1=y1)

    elif req.action == "replace_polygon":
        if req.room_id is None or req.polygon_norm is None:
            raise HTTPException(400, "room_id et polygon_norm requis")
        rooms = s["analysis"].get("rooms", [])
        room = next((r for r in rooms if r["id"] == req.room_id), None)
        if room is None:
            raise HTTPException(404, "Pièce introuvable")
        room_type_color = room.get("type", req.room_type)
        old_poly = room.get("polygon_norm")
        if old_poly:
            old_pts = [[int(p["x"] * W), int(p["y"] * H)] for p in old_poly]
            mask_rgba = pipeline.edit_room_mask(mask_rgba, "erase_poly", room_type_color, points=old_pts)
        else:
            bbn = room["bbox_norm"]
            x0 = int(bbn["x"] * W); y0 = int(bbn["y"] * H)
            x1 = int((bbn["x"] + bbn["w"]) * W); y1 = int((bbn["y"] + bbn["h"]) * H)
            mask_rgba = pipeline.edit_room_mask(mask_rgba, "erase_rect", room_type_color,
                                                 x0=x0, y0=y0, x1=x1, y1=y1)
        new_pts = [[int(p["x"] * W), int(p["y"] * H)] for p in req.polygon_norm]
        mask_rgba = pipeline.edit_room_mask(mask_rgba, "add_poly", room_type_color, points=new_pts)

    elif req.action == "merge_rooms":
        if req.room_id is None or req.room_id_b is None:
            raise HTTPException(400, "room_id et room_id_b requis")
        rooms = s["analysis"].get("rooms", [])
        room_a = next((r for r in rooms if r["id"] == req.room_id), None)
        room_b = next((r for r in rooms if r["id"] == req.room_id_b), None)
        if not room_a or not room_b:
            raise HTTPException(404, "Pièce introuvable")
        # Erase room B, then repaint with room A's color
        poly_b = room_b.get("polygon_norm")
        if poly_b:
            pts_b = [[int(p["x"] * W), int(p["y"] * H)] for p in poly_b]
            mask_rgba = pipeline.edit_room_mask(mask_rgba, "erase_poly", room_b["type"], points=pts_b)
            mask_rgba = pipeline.edit_room_mask(mask_rgba, "add_poly", room_a["type"], points=pts_b)
        else:
            bbn = room_b["bbox_norm"]
            x0 = int(bbn["x"] * W); y0 = int(bbn["y"] * H)
            x1 = int((bbn["x"] + bbn["w"]) * W); y1 = int((bbn["y"] + bbn["h"]) * H)
            mask_rgba = pipeline.edit_room_mask(mask_rgba, "erase_rect", room_b["type"], x0=x0, y0=y0, x1=x1, y1=y1)
            mask_rgba = pipeline.edit_room_mask(mask_rgba, "add_rect", room_a["type"], x0=x0, y0=y0, x1=x1, y1=y1)

    elif req.action == "split_room":
        if req.room_id is None or not req.cut_points or len(req.cut_points) < 2:
            raise HTTPException(400, "room_id et cut_points (2+ points) requis")
        cut_pts_px = [(int(p["x"] * W), int(p["y"] * H)) for p in req.cut_points]
        mask_rgba = pipeline.split_room_by_line(mask_rgba, cut_pts_px)

    else:
        mask_rgba = pipeline.edit_room_mask(
            mask_rgba, req.action, req.room_type,
            x0=req.x0, y0=req.y0, x1=req.x1, y1=req.y1,
            points=req.points,
        )

    # Ré-dériver la liste de pièces depuis le masque édité
    rooms_list = pipeline.rooms_from_mask_rgba(mask_rgba, H, W, ppm)

    # Sauvegarder en session
    s["mask_rooms_rgba"] = mask_rgba
    s["analysis"]["rooms"] = [
        {k: v for k, v in r.items() if not k.startswith("_")} for r in rooms_list
    ]
    s["analysis"]["mask_rooms_b64"] = pipeline._np_to_b64(mask_rgba)
    _touch_session(req.session_id)

    return {
        "mask_rooms_b64": pipeline._np_to_b64(mask_rgba),
        "rooms": s["analysis"]["rooms"],
        "history_len": len(s.get("mask_rooms_history", [])),
        "future_len": len(s.get("mask_rooms_future", [])),
    }


# ── Undo / Redo room mask ──

class UndoRedoRoomRequest(BaseModel):
    session_id: str

@app.post("/undo-room-mask")
def undo_room_mask(req: UndoRedoRoomRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")
    history = s.get("mask_rooms_history", [])
    if not history:
        raise HTTPException(400, "Rien à annuler")
    future = s.setdefault("mask_rooms_future", [])
    future.append(_compress_mask(s["mask_rooms_rgba"]))
    if len(future) > 10:
        future.pop(0)
    prev_bytes = history.pop()
    prev = _decompress_mask(prev_bytes, s["mask_rooms_rgba"].shape)
    s["mask_rooms_rgba"] = prev
    ppm = s.get("pixels_per_meter")
    H, W = prev.shape[:2]
    rooms_list = pipeline.rooms_from_mask_rgba(prev, H, W, ppm)
    s["analysis"]["rooms"] = [
        {k: v for k, v in r.items() if not k.startswith("_")} for r in rooms_list
    ]
    s["analysis"]["mask_rooms_b64"] = pipeline._np_to_b64(prev)
    return {
        "mask_rooms_b64": s["analysis"]["mask_rooms_b64"],
        "rooms": s["analysis"]["rooms"],
        "history_len": len(history),
        "future_len": len(future),
    }

@app.post("/redo-room-mask")
def redo_room_mask(req: UndoRedoRoomRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")
    future = s.get("mask_rooms_future", [])
    if not future:
        raise HTTPException(400, "Rien à rétablir")
    history = s.setdefault("mask_rooms_history", [])
    history.append(_compress_mask(s["mask_rooms_rgba"]))
    if len(history) > 10:
        history.pop(0)
    nxt_bytes = future.pop()
    nxt = _decompress_mask(nxt_bytes, s["mask_rooms_rgba"].shape)
    s["mask_rooms_rgba"] = nxt
    ppm = s.get("pixels_per_meter")
    H, W = nxt.shape[:2]
    rooms_list = pipeline.rooms_from_mask_rgba(nxt, H, W, ppm)
    s["analysis"]["rooms"] = [
        {k: v for k, v in r.items() if not k.startswith("_")} for r in rooms_list
    ]
    s["analysis"]["mask_rooms_b64"] = pipeline._np_to_b64(nxt)
    return {
        "mask_rooms_b64": s["analysis"]["mask_rooms_b64"],
        "rooms": s["analysis"]["rooms"],
        "history_len": len(history),
        "future_len": len(future),
    }


# ── Undo / Redo mask edits (door / window / interior) ──

class UndoRedoMaskEditRequest(BaseModel):
    session_id: str

def _restore_masks(s, snapshot, cfg):
    """Restore all editable masks from a compressed snapshot and recompute overlays."""
    img_rgb = s["img_rgb"]
    H, W = img_rgb.shape[:2]
    s["m_doors"]   = _decompress_mask(snapshot["m_doors"],   (H, W))
    s["m_windows"] = _decompress_mask(snapshot["m_windows"], (H, W))
    s["interior_mask"] = _decompress_mask(snapshot["interior_mask"], (H, W)) if snapshot.get("interior_mask") is not None else None
    if snapshot.get("m_walls_pixel") is not None:
        s["m_walls_pixel"] = _decompress_mask(snapshot["m_walls_pixel"], (H, W))
    if snapshot.get("m_cloisons") is not None:
        s["m_cloisons"] = _decompress_mask(snapshot["m_cloisons"], (H, W))
    if snapshot.get("m_french_doors") is not None:
        s["m_french_doors"] = _decompress_mask(snapshot["m_french_doors"], (H, W))

    ppm = s.get("pixels_per_meter")
    interior_override = s.get("interior_mask")
    result = pipeline.recompute_from_edited_masks(
        img_rgb, s["m_doors"], s["m_windows"], s["walls"], ppm, cfg,
        interior_mask_override=interior_override,
        m_walls_ai=s.get("m_walls_ai"),
    )
    s["analysis"].update({
        "overlay_openings_b64": result["overlay_openings_b64"],
        "overlay_interior_b64": result.get("overlay_interior_b64"),
        "mask_doors_b64":       result["mask_doors_b64"],
        "mask_windows_b64":     result["mask_windows_b64"],
        "mask_walls_b64":       result["mask_walls_b64"],
        "doors_count":          result["doors_count"],
        "windows_count":        result["windows_count"],
        "surfaces":             result["surfaces"],
        "pixels_per_meter":     result.get("pixels_per_meter"),
    })
    if result.get("_interior_mask") is not None:
        s["interior_mask"] = result["_interior_mask"]
    # Regenerate wall/cloison b64 from restored masks
    wp = s.get("m_walls_pixel")
    cl = s.get("m_cloisons")
    if wp is not None:
        s["analysis"]["mask_walls_pixel_b64"] = pipeline._np_to_b64(pipeline._mask_to_rgba(wp, (239, 68, 68), 80)) if cv2.countNonZero(wp) > 0 else None
    if cl is not None:
        s["analysis"]["mask_cloisons_b64"] = pipeline._np_to_b64(pipeline._mask_to_rgba(cl, (0, 100, 255), 210)) if cv2.countNonZero(cl) > 0 else None
    # Regenerate french_doors overlay
    fd = s.get("m_french_doors")
    if fd is not None:
        s["analysis"]["mask_french_doors_b64"] = pipeline._np_to_b64(pipeline._mask_to_rgba(fd, (249, 115, 22), 90)) if cv2.countNonZero(fd) > 0 else None
        s["analysis"]["french_doors_count"] = pipeline._count_connected_components(fd)
    resp = {k: v for k, v in result.items() if not k.startswith("_")}
    resp["mask_walls_pixel_b64"]  = s["analysis"].get("mask_walls_pixel_b64")
    resp["mask_cloisons_b64"]     = s["analysis"].get("mask_cloisons_b64")
    resp["mask_french_doors_b64"] = s["analysis"].get("mask_french_doors_b64")
    resp["french_doors_count"]    = s["analysis"].get("french_doors_count", 0)
    resp["rooms"] = s["analysis"].get("rooms", [])
    resp["walls"] = s["analysis"].get("walls", [])
    return resp

@app.post("/undo-edit-mask")
def undo_edit_mask(req: UndoRedoMaskEditRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")
    history = s.get("mask_edit_history", [])
    if not history:
        raise HTTPException(400, "Rien à annuler")
    # Save current state to redo stack
    current = {
        "m_doors":        _compress_mask(s["m_doors"]),
        "m_windows":      _compress_mask(s["m_windows"]),
        "m_french_doors": _compress_mask(s["m_french_doors"]) if s.get("m_french_doors") is not None else None,
        "interior_mask":  _compress_mask(s["interior_mask"])  if s.get("interior_mask")  is not None else None,
        "m_walls_pixel":  _compress_mask(s["m_walls_pixel"])  if s.get("m_walls_pixel")  is not None else None,
        "m_cloisons":     _compress_mask(s["m_cloisons"])     if s.get("m_cloisons")     is not None else None,
    }
    future = s.setdefault("mask_edit_future", [])
    future.append(current)
    if len(future) > 10:
        future.pop(0)
    # Restore previous state
    prev = history.pop()
    cfg = s.get("cfg", pipeline.DEFAULT_CONFIG)
    resp = _restore_masks(s, prev, cfg)
    resp["edit_history_len"] = len(history)
    resp["edit_future_len"] = len(future)
    return resp

@app.post("/redo-edit-mask")
def redo_edit_mask(req: UndoRedoMaskEditRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")
    future = s.get("mask_edit_future", [])
    if not future:
        raise HTTPException(400, "Rien à rétablir")
    # Save current state to undo stack
    current = {
        "m_doors":        _compress_mask(s["m_doors"]),
        "m_windows":      _compress_mask(s["m_windows"]),
        "m_french_doors": _compress_mask(s["m_french_doors"]) if s.get("m_french_doors") is not None else None,
        "interior_mask":  _compress_mask(s["interior_mask"])  if s.get("interior_mask")  is not None else None,
        "m_walls_pixel":  _compress_mask(s["m_walls_pixel"])  if s.get("m_walls_pixel")  is not None else None,
        "m_cloisons":     _compress_mask(s["m_cloisons"])     if s.get("m_cloisons")     is not None else None,
    }
    history = s.setdefault("mask_edit_history", [])
    history.append(current)
    if len(history) > 10:
        history.pop(0)
    # Restore next state
    nxt = future.pop()
    cfg = s.get("cfg", pipeline.DEFAULT_CONFIG)
    resp = _restore_masks(s, nxt, cfg)
    resp["edit_history_len"] = len(history)
    resp["edit_future_len"] = len(future)
    return resp


# ============================================================
# ROUTE 6c — METTRE À JOUR LE LABEL D'UNE PIÈCE
# ============================================================
class UpdateRoomLabelRequest(BaseModel):
    session_id: str
    room_id: int
    new_type: str
    new_label_fr: str

@app.patch("/update-room-label")
def update_room_label(req: UpdateRoomLabelRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")
    analysis = s.get("analysis")
    if analysis is None:
        raise HTTPException(400, "Lancez d'abord /analyze")
    updated = False
    for room in analysis.get("rooms", []):
        if room["id"] == req.room_id:
            room["type"] = req.new_type
            room["label_fr"] = req.new_label_fr
            updated = True
            break
    if not updated:
        raise HTTPException(404, f"Pièce id={req.room_id} introuvable")
    return {"rooms": analysis["rooms"]}


# ============================================================
# ROUTE 7 — SAM : SEGMENTATION AUTOMATIQUE PAR CLIC
# FIX: nouvelle route pour détecter automatiquement une zone
# ============================================================
class SamSegmentRequest(BaseModel):
    session_id: str
    x: int          # coordonnée X du point de clic
    y: int          # coordonnée Y du point de clic
    mode: str = "interior"   # "interior" | "flood"
    apply_to: str = "interior"  # "interior" | "door" | "window" | "french_door" — masque cible
    action: str = "add"      # "add" | "erase"

@app.post("/sam-segment")
def sam_segment(req: SamSegmentRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    if "m_doors" not in s:
        raise HTTPException(400, "Lancez d'abord /analyze")

    img_rgb = s["img_rgb"]
    H, W    = img_rgb.shape[:2]
    cfg     = s.get("cfg", pipeline.DEFAULT_CONFIG)

    # Vérification coordonnées
    if not (0 <= req.x < W and 0 <= req.y < H):
        raise HTTPException(400, f"Coordonnées hors image ({W}x{H})")

    # Segmentation automatique
    try:
        seg_mask = pipeline.sam_segment_point(img_rgb, req.x, req.y, mode=req.mode)
    except Exception as e:
        raise HTTPException(500, f"Erreur segmentation : {e}")

    if cv2.countNonZero(seg_mask) == 0:
        raise HTTPException(422, "Aucune région détectée à ce point. Essayez un autre endroit.")

    # ── Push undo snapshot for SAM edit ──
    snapshot = {
        "m_doors":        _compress_mask(s["m_doors"]),
        "m_windows":      _compress_mask(s["m_windows"]),
        "m_french_doors": _compress_mask(s["m_french_doors"]) if s.get("m_french_doors") is not None else None,
        "interior_mask":  _compress_mask(s["interior_mask"])  if s.get("interior_mask")  is not None else None,
        "m_walls_pixel":  _compress_mask(s["m_walls_pixel"])  if s.get("m_walls_pixel")  is not None else None,
        "m_cloisons":     _compress_mask(s["m_cloisons"])     if s.get("m_cloisons")     is not None else None,
    }
    history = s.setdefault("mask_edit_history", [])
    history.append(snapshot)
    if len(history) > 10:
        history.pop(0)
    s["mask_edit_future"] = []

    # Appliquer au masque cible
    if req.apply_to == "door":
        target = s["m_doors"].copy()
    elif req.apply_to == "window":
        target = s["m_windows"].copy()
    elif req.apply_to == "french_door":
        existing = s.get("m_french_doors")
        target = existing.copy() if existing is not None else np.zeros((H, W), np.uint8)
    elif req.apply_to == "interior":
        existing = s.get("interior_mask")
        target = existing.copy() if existing is not None else np.zeros((H, W), np.uint8)
    else:
        raise HTTPException(400, "apply_to doit être 'door', 'window', 'french_door' ou 'interior'")

    if req.action == "add":
        target = cv2.bitwise_or(target, seg_mask)
    elif req.action == "erase":
        target = cv2.bitwise_and(target, cv2.bitwise_not(seg_mask))
    else:
        raise HTTPException(400, "action doit être 'add' ou 'erase'")

    # Stocker
    if req.apply_to == "door":
        sessions[req.session_id]["m_doors"] = target
    elif req.apply_to == "window":
        sessions[req.session_id]["m_windows"] = target
    elif req.apply_to == "french_door":
        sessions[req.session_id]["m_french_doors"] = target
        # Early return — french_door is standalone like wall/cloison
        fd_b64 = pipeline._np_to_b64(pipeline._mask_to_rgba(target, (249, 115, 22), 90)) if cv2.countNonZero(target) > 0 else None
        sessions[req.session_id]["analysis"]["mask_french_doors_b64"] = fd_b64
        sessions[req.session_id]["analysis"]["french_doors_count"] = pipeline._count_connected_components(target)
        _touch_session(req.session_id)
        return {
            "mask_french_doors_b64": fd_b64,
            "french_doors_count": sessions[req.session_id]["analysis"]["french_doors_count"],
            "sam_mask_b64": pipeline._np_to_b64(seg_mask),
            "edit_history_len": len(s.get("mask_edit_history", [])),
            "edit_future_len": len(s.get("mask_edit_future", [])),
        }
    elif req.apply_to == "interior":
        sessions[req.session_id]["interior_mask"] = target

    # Recalculer
    ppm = s.get("pixels_per_meter")
    interior_override = sessions[req.session_id].get("interior_mask") if req.apply_to == "interior" else None

    result = pipeline.recompute_from_edited_masks(
        img_rgb,
        sessions[req.session_id]["m_doors"],
        sessions[req.session_id]["m_windows"],
        s["walls"],
        ppm,
        cfg,
        interior_mask_override=interior_override,
        m_walls_ai=s.get("m_walls_ai"),
    )

    # FIX: mettre à jour la session pour l'export PDF
    sessions[req.session_id]["analysis"].update({
        "overlay_openings_b64": result["overlay_openings_b64"],
        "overlay_interior_b64": result.get("overlay_interior_b64"),
        "mask_doors_b64":       result["mask_doors_b64"],
        "mask_windows_b64":     result["mask_windows_b64"],
        "mask_walls_b64":       result["mask_walls_b64"],
        "doors_count":          result["doors_count"],
        "windows_count":        result["windows_count"],
        "surfaces":             result["surfaces"],
        "pixels_per_meter":     result.get("pixels_per_meter"),
    })
    if result.get("_interior_mask") is not None:
        sessions[req.session_id]["interior_mask"] = result["_interior_mask"]

    # Retourner aussi le masque SAM pour preview côté frontend
    resp = {k: v for k, v in result.items() if not k.startswith("_")}
    resp["sam_mask_b64"] = pipeline._np_to_b64(seg_mask)
    # Conserver rooms et walls
    resp["rooms"] = sessions[req.session_id]["analysis"].get("rooms", [])
    resp["walls"] = sessions[req.session_id]["analysis"].get("walls", [])
    resp["edit_history_len"] = len(s.get("mask_edit_history", []))
    resp["edit_future_len"] = len(s.get("mask_edit_future", []))
    _touch_session(req.session_id)
    return resp


# ============================================================
# ROUTE 8 — EXPORT RAPPORT PDF
# FIX: utilise les données de session mises à jour (post-édition)
# ============================================================
class ExportRequest(BaseModel):
    session_id: str
    project_name: str = ""
    client_name: str = ""

@app.post("/export-pdf")
def export_pdf(req: ExportRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    a = s.get("analysis")
    if a is None:
        raise HTTPException(400, "Lancez d'abord /analyze")

    img_rgb = s["img_rgb"]

    # FIX: on lit depuis a[] qui est maintenant mis à jour après chaque /edit-mask ou /sam-segment
    overlay_openings = b64_to_np_rgb(a["overlay_openings_b64"])
    overlay_interior = b64_to_np_rgb(a["overlay_interior_b64"]) if a.get("overlay_interior_b64") else None
    mask_doors   = b64_to_np_gray(a["mask_doors_b64"])
    mask_windows = b64_to_np_gray(a["mask_windows_b64"])
    mask_walls   = b64_to_np_gray(a["mask_walls_b64"])

    surfaces = a.get("surfaces", {})
    surfaces = {k: v for k, v in surfaces.items() if k != "interior_mask"}

    try:
        pdf_bytes = pipeline.generate_pdf_report(
            img_rgb=img_rgb,
            overlay_openings=overlay_openings,
            overlay_interior=overlay_interior,
            mask_doors=mask_doors,
            mask_windows=mask_windows,
            mask_walls=mask_walls,
            surfaces=surfaces,
            doors_count=a["doors_count"],
            windows_count=a["windows_count"],
            ppm=a.get("pixels_per_meter"),
            project_name=req.project_name,
            client_name=req.client_name,
        )
    except Exception as e:
        raise HTTPException(500, f"Erreur génération PDF : {e}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=floorscan_report.pdf"}
    )


# ============================================================
# ROUTE 8b — EXPORT DXF (AutoCAD)
# ============================================================
class ExportDxfRequest(BaseModel):
    session_id: str

@app.post("/export-dxf")
def export_dxf(req: ExportDxfRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")
    a = s.get("analysis")
    if a is None:
        raise HTTPException(400, "Lancez d'abord /analyze")
    ppm = a.get("pixels_per_meter")
    if not ppm:
        raise HTTPException(400, "Échelle (pixels_per_meter) requise pour l'export DXF")
    img_rgb = s["img_rgb"]
    H, W = img_rgb.shape[:2]
    try:
        dxf_bytes = pipeline.generate_dxf(
            rooms=a.get("rooms", []),
            walls=a.get("walls", []),
            openings=a.get("openings", []),
            img_w=W, img_h=H, ppm=ppm,
        )
    except Exception as e:
        raise HTTPException(500, f"Erreur génération DXF : {e}")
    return Response(
        content=dxf_bytes,
        media_type="application/dxf",
        headers={"Content-Disposition": "attachment; filename=floorscan_export.dxf"},
    )


# ============================================================
# ROUTE 9 — RÉCUPÉRER UNE IMAGE (overlay/masque) par session
# ============================================================
# ============================================================
# ROUTE 10 — EXPORT DEVIS PDF — Module Métré Manuel
# ============================================================
class ExportMeasurePdfRequest(BaseModel):
    image_b64: str
    surface_totals: list   # [{name, color, area_m2, price_per_m2}]
    total_m2: float
    ppm: Optional[float] = None
    project_name: str = ""
    client_name: str = ""
    date_str: str = ""
    tva_rate: float = 10.0  # taux TVA en %

@app.post("/export-measure-pdf")
def export_measure_pdf(req: ExportMeasurePdfRequest):
    try:
        pdf_bytes = pipeline.generate_measure_pdf_devis(
            image_b64=req.image_b64,
            surface_totals=req.surface_totals,
            total_m2=req.total_m2,
            ppm=req.ppm,
            project_name=req.project_name,
            client_name=req.client_name,
            date_str=req.date_str,
            tva_rate=req.tva_rate,
        )
    except Exception as e:
        raise HTTPException(500, f"Erreur génération devis PDF : {e}")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=floorscan_devis.pdf"}
    )



# ============================================================
# ROUTE — VISUAL SEARCH (template matching)
# ============================================================
class VisualSearchRequest(BaseModel):
    session_id: str
    x_pct: float        # region % (0-100)
    y_pct: float
    w_pct: float
    h_pct: float
    threshold: float = 0.80
    max_results: int = 50

def _nms_boxes(boxes, scores, overlap_thresh=0.3):
    """Greedy Non-Maximum Suppression on (x, y, w, h) boxes."""
    if len(boxes) == 0:
        return []
    idxs = np.argsort(scores)[::-1]
    keep = []
    while len(idxs) > 0:
        i = idxs[0]
        keep.append(i)
        if len(idxs) == 1:
            break
        rest = idxs[1:]
        xx1 = np.maximum(boxes[i][0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i][1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i][0] + boxes[i][2], boxes[rest, 0] + boxes[rest, 2])
        yy2 = np.minimum(boxes[i][1] + boxes[i][3], boxes[rest, 1] + boxes[rest, 3])
        w = np.maximum(0, xx2 - xx1)
        h = np.maximum(0, yy2 - yy1)
        inter = w * h
        area_i = boxes[i][2] * boxes[i][3]
        area_rest = boxes[rest, 2] * boxes[rest, 3]
        iou = inter / (area_i + area_rest - inter + 1e-6)
        idxs = rest[iou < overlap_thresh]
    return keep

def _rotate_template(gray_tpl, angle):
    """Rotate a grayscale template by `angle` degrees, returning the tight crop."""
    h, w = gray_tpl.shape[:2]
    cx, cy = w / 2, h / 2
    M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
    cos_a = abs(M[0, 0])
    sin_a = abs(M[0, 1])
    nw = int(h * sin_a + w * cos_a)
    nh = int(h * cos_a + w * sin_a)
    M[0, 2] += (nw / 2) - cx
    M[1, 2] += (nh / 2) - cy
    rotated = cv2.warpAffine(gray_tpl, M, (nw, nh), borderMode=cv2.BORDER_REPLICATE)
    return rotated

@app.post("/visual-search")
def visual_search(req: VisualSearchRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    img_rgb = s["img_rgb"]
    H, W = img_rgb.shape[:2]

    # Convert percentage to pixel coordinates
    x = int(W * req.x_pct / 100)
    y = int(H * req.y_pct / 100)
    w = int(W * req.w_pct / 100)
    h = int(H * req.h_pct / 100)

    # Clamp to image bounds
    x = max(0, min(x, W - 1))
    y = max(0, min(y, H - 1))
    w = max(1, min(w, W - x))
    h = max(1, min(h, H - y))

    if w < 5 or h < 5:
        raise HTTPException(400, "Zone trop petite (min 5px)")

    template = img_rgb[y:y+h, x:x+w]
    gray_img = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    gray_tpl = cv2.cvtColor(template, cv2.COLOR_RGB2GRAY)

    # Multi-angle search: 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°
    angles = [0, 45, 90, 135, 180, 225, 270, 315]
    all_boxes = []
    all_scores = []

    for angle in angles:
        if angle == 0:
            tpl = gray_tpl
        else:
            tpl = _rotate_template(gray_tpl, angle)

        th, tw = tpl.shape[:2]
        # Skip if rotated template is larger than the image
        if tw >= W or th >= H or tw < 3 or th < 3:
            continue

        result_map = cv2.matchTemplate(gray_img, tpl, cv2.TM_CCOEFF_NORMED)
        locs = np.where(result_map >= req.threshold)

        if len(locs[0]) == 0:
            continue

        for i in range(len(locs[0])):
            bx, by = int(locs[1][i]), int(locs[0][i])
            all_boxes.append([bx, by, tw, th])
            all_scores.append(float(result_map[locs[0][i], locs[1][i]]))

    if len(all_boxes) == 0:
        tpl_b64 = pipeline._np_to_b64(template)
        return {"matches": [], "count": 0, "template_b64": tpl_b64}

    boxes = np.array(all_boxes, dtype=np.float32)
    scores = np.array(all_scores, dtype=np.float32)

    # Global NMS across all angles
    keep = _nms_boxes(boxes, scores, overlap_thresh=0.3)
    boxes = boxes[keep]
    scores = scores[keep]

    # Sort by score descending, limit results
    order = np.argsort(scores)[::-1][:req.max_results]
    boxes = boxes[order]
    scores = scores[order]

    matches = []
    for i in range(len(boxes)):
        bx, by, bw, bh = boxes[i]
        matches.append({
            "x_norm": float(bx / W),
            "y_norm": float(by / H),
            "w_norm": float(bw / W),
            "h_norm": float(bh / H),
            "score": round(float(scores[i]), 3),
        })

    tpl_b64 = pipeline._np_to_b64(template)
    return {"matches": matches, "count": len(matches), "template_b64": tpl_b64}

@app.get("/image/{session_id}/{image_type}")
def get_image(session_id: str, image_type: str):
    s = sessions.get(session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    a = s.get("analysis")
    if a is None:
        raise HTTPException(400, "Aucune analyse disponible")

    key_map = {
        "overlay_openings": "overlay_openings_b64",
        "overlay_interior": "overlay_interior_b64",
        "mask_doors":       "mask_doors_b64",
        "mask_windows":     "mask_windows_b64",
        "mask_walls":       "mask_walls_b64",
        "mask_rooms":       "mask_rooms_b64",
    }

    key = key_map.get(image_type)
    if key is None:
        raise HTTPException(400, f"Type invalide. Options: {list(key_map.keys())}")

    b64 = a.get(key)
    if b64 is None:
        raise HTTPException(404, "Image non disponible")

    img_data = base64.b64decode(b64)
    return Response(content=img_data, media_type="image/png")


# ============================================================
# ROUTE — ANALYSE DE FAÇADE (elevation drawings)
# Utilise le modèle Roboflow "my-first-project-utanq/7"
# Ancien modèle : "elevation-24mp4/1"
# ============================================================
FACADE_MODEL_ID = "my-first-project-utanq/7"

# Mapping classes Roboflow → types façade internes
# Les classes inconnues sont mappées à "other" (voir code ci-dessous)
# pour ne pas filtrer les détections si le modèle utilise des noms différents.
FACADE_CLASS_MAP = {
    # Classes modèle original (singular + plural)
    "door":             "door",
    "doors":            "door",
    "window":           "window",
    "windows":          "window",
    "building":         "other",
    "roof":             "roof",
    "rooftop":          "roof",
    "floor":            "floor_line",
    "floor_line":       "floor_line",
    "floor-line":       "floor_line",
    "floorline":        "floor_line",
    "storey":           "floor_line",
    "story":            "floor_line",
    "column":           "column",
    "columns":          "column",
    "pillar":           "column",
    "pillars":          "column",
    "pilaster":         "column",
    "pilasters":        "column",
    "balcony":          "balcony",
    "balconies":        "balcony",
    # Variantes courantes des modèles Roboflow
    "opening":          "window",
    "openings":         "window",
    "window_frame":     "window",
    "window-frame":     "window",
    "fenetre_grande":   "window",
    "french_window":    "window",
    "french_door":      "door",
    "french-door":      "door",
    "porte-fenetre":    "door",
    "porte_fenetre":    "door",
    "gate":             "door",
    "entree":           "door",
    "terrace":          "balcony",
    "terrasse":         "balcony",
    "loggia":           "balcony",
    "level":            "floor_line",
    "level_line":       "floor_line",
    "floor_level":      "floor_line",
    "balustrade":       "balcony",
    "garde-corps":      "balcony",
    "cornice":          "roof",
    "corniche":         "roof",
    "parapet":          "roof",
    "shutter":          "other",
    "volet":            "other",
    "volets":           "other",
    "awning":           "other",
    "store":            "other",
    # Alias FR (au cas où le modèle utilise des labels français)
    "porte":            "door",
    "portes":           "door",
    "fenetre":          "window",
    "fenetres":         "window",
    "fenêtre":          "window",
    "fenêtres":         "window",
    "toiture":          "roof",
    "balcon":           "balcony",
    "balcons":          "balcony",
    "colonne":          "column",
    "colonnes":         "column",
    "etage":            "floor_line",
    "étage":            "floor_line",
    # Générique
    "facade":           "other",
    "facade-element":   "other",
    "wall":             "other",
    "other":            "other",
}

# NOTE: cv2.putText (polices Hershey) ne supporte que les caractères ASCII (32-126).
# Tout caractère accentué (é, ê, É...) s'affiche en "?" dans l'overlay.
# → Toutes les valeurs ici doivent être en ASCII pur.
FACADE_LABELS_FR = {
    "door":       "Porte",
    "window":     "Fenetre",
    "balcony":    "Balcon",
    "roof":       "Toiture",
    "floor_line": "Etage",
    "column":     "Colonne",
    "other":      "Element",
}

class AnalyzeFacadeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    session_id: str
    roboflow_api_key: str = "tyCM9PZp8cs3KtifPUaQ"
    pixels_per_meter: Optional[float] = None
    confidence: float = 0.15
    # ROI optionnel : délimite le bâtiment avant inférence
    # {x, y, w, h} normalisés [0-1] dans l'image originale
    building_roi: Optional[dict] = None

@app.post("/analyze-facade")
def analyze_facade(req: AnalyzeFacadeRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    img_rgb = s["img_rgb"]
    H, W = img_rgb.shape[:2]
    ppm = req.pixels_per_meter or s.get("pixels_per_meter")

    # ── Crop ROI si spécifié ──────────────────────────────────────────────────
    roi_x1, roi_y1, roi_x2, roi_y2 = 0, 0, W, H
    if req.building_roi:
        r = req.building_roi
        rx = float(r.get("x", 0.0))
        ry = float(r.get("y", 0.0))
        rw = float(r.get("w", 1.0))
        rh = float(r.get("h", 1.0))
        roi_x1 = max(0, int(rx * W))
        roi_y1 = max(0, int(ry * H))
        roi_x2 = min(W, int((rx + rw) * W))
        roi_y2 = min(H, int((ry + rh) * H))
        if roi_x2 <= roi_x1 or roi_y2 <= roi_y1:
            roi_x1, roi_y1, roi_x2, roi_y2 = 0, 0, W, H

    img_for_infer = img_rgb[roi_y1:roi_y2, roi_x1:roi_x2]
    H_inf, W_inf = img_for_infer.shape[:2]
    roi_scale_x = (roi_x2 - roi_x1) / W
    roi_scale_y = (roi_y2 - roi_y1) / H

    # ── Appel Roboflow inference ──────────────────────────────────────────────
    from inference_sdk import InferenceHTTPClient
    client = InferenceHTTPClient(
        api_url="https://serverless.roboflow.com",
        api_key=req.roboflow_api_key,
    )

    img_pil_inf = Image.fromarray(img_for_infer).convert("RGB")
    buf = io.BytesIO()
    img_pil_inf.save(buf, format="JPEG", quality=95)
    buf.seek(0)
    img_b64_for_infer = base64.b64encode(buf.read()).decode()

    try:
        resp = client.infer(img_b64_for_infer, model_id=FACADE_MODEL_ID)
    except Exception as e:
        raise HTTPException(500, f"Erreur inférence façade : {e}")

    if isinstance(resp, list):
        predictions = resp
    else:
        predictions = resp.get("predictions", [])

    # Log des classes brutes reçues (aide au diagnostic)
    raw_classes_seen = list({p.get("class") or p.get("class_name") or "" for p in predictions})
    logger.info("[FACADE] %d prédictions brutes — classes vues: %s", len(predictions), raw_classes_seen)

    # ── Convertir les détections en FacadeElement ──
    elements = []
    for i, pred in enumerate(predictions):
        # Compatibilité : Roboflow peut utiliser "class" ou "class_name"
        cls_name = (pred.get("class") or pred.get("class_name") or "").strip().lower()
        if pred.get("confidence", 0) < req.confidence:
            continue

        # 1. Lookup exact
        facade_type = FACADE_CLASS_MAP.get(cls_name)

        # 2. Fallback fuzzy : substring matching sur les mots-clés
        if facade_type is None:
            if any(k in cls_name for k in ("win", "fen", "glas", "glazing", "vitrag", "opening", "ouvert")):
                facade_type = "window"
            elif any(k in cls_name for k in ("door", "port", "entr", "gate", "porte")):
                facade_type = "door"
            elif any(k in cls_name for k in ("balc", "terr", "loggi")):
                facade_type = "balcony"
            elif any(k in cls_name for k in ("roof", "toit", "parapet", "cornich", "comble")):
                facade_type = "roof"
            elif any(k in cls_name for k in ("floor", "etage", "level", "storey", "ligne")):
                facade_type = "floor_line"
            elif any(k in cls_name for k in ("col", "pillar", "pilast", "poteau")):
                facade_type = "column"
            else:
                facade_type = "other"
                logger.debug("[FACADE] classe inconnue ignorée en 'other': %r", cls_name)

        # Roboflow retourne x_center, y_center, width, height en pixels du CROP
        cx_inf = pred["x"]
        cy_inf = pred["y"]
        pw_inf = pred["width"]
        ph_inf = pred["height"]

        # Convertir d'abord en normalisé dans le crop
        x_in_roi = (cx_inf - pw_inf / 2) / W_inf
        y_in_roi = (cy_inf - ph_inf / 2) / H_inf
        w_in_roi = pw_inf / W_inf
        h_in_roi = ph_inf / H_inf

        # Remapper vers l'image originale
        x_norm = roi_x1 / W + x_in_roi * roi_scale_x
        y_norm = roi_y1 / H + y_in_roi * roi_scale_y
        w_norm = w_in_roi * roi_scale_x
        h_norm = h_in_roi * roi_scale_y

        # Clamp
        x_norm = max(0.0, min(1.0, x_norm))
        y_norm = max(0.0, min(1.0, y_norm))
        w_norm = min(w_norm, 1.0 - x_norm)
        h_norm = min(h_norm, 1.0 - y_norm)

        # Calcul surface + dimensions + périmètre (en m², basé sur les pixels du crop)
        area_m2 = None
        w_m = None
        h_m = None
        perimeter_m = None
        if ppm and ppm > 0:
            pw_orig = pw_inf * roi_scale_x  # largeur en px dans l'image originale
            ph_orig = ph_inf * roi_scale_y
            area_m2 = (pw_orig * ph_orig) / (ppm * ppm)
            w_m = pw_orig / ppm
            h_m = ph_orig / ppm
            perimeter_m = 2 * (w_m + h_m)

        elements.append({
            "id": i,
            "type": facade_type,
            "label_fr": FACADE_LABELS_FR.get(facade_type, cls_name),
            "raw_class": cls_name,
            "bbox_norm": {"x": round(x_norm, 5), "y": round(y_norm, 5),
                          "w": round(w_norm, 5), "h": round(h_norm, 5)},
            "area_m2": round(area_m2, 3) if area_m2 is not None else None,
            "perimeter_m": round(perimeter_m, 3) if perimeter_m is not None else None,
            "w_m": round(w_m, 3) if w_m is not None else None,
            "h_m": round(h_m, 3) if h_m is not None else None,
            "confidence": round(pred.get("confidence", 0), 3),
        })

    # ── Assigner les floor_level par position Y (haut = étage le plus haut) ──
    floor_lines = sorted(
        [e for e in elements if e["type"] == "floor_line"],
        key=lambda e: e["bbox_norm"]["y"]
    )
    # Créer des seuils d'étage à partir des floor_lines
    floor_thresholds = [fl["bbox_norm"]["y"] + fl["bbox_norm"]["h"] / 2 for fl in floor_lines]

    for el in elements:
        if el["type"] == "floor_line":
            continue
        cy_norm = el["bbox_norm"]["y"] + el["bbox_norm"]["h"] / 2
        # Compter combien de floor_lines sont au-dessus du centre
        lines_above = sum(1 for t in floor_thresholds if t < cy_norm)
        el["floor_level"] = max(0, len(floor_thresholds) - lines_above)

    # ── Comptages ──
    windows = [e for e in elements if e["type"] == "window"]
    doors   = [e for e in elements if e["type"] == "door"]
    balconies = [e for e in elements if e["type"] == "balcony"]
    floors_count = max(1, len(floor_lines) + 1)

    # ── Surfaces ──
    openings = [e for e in elements if e["type"] in ("window", "door", "balcony")]
    openings_area_m2 = sum(e["area_m2"] for e in openings if e["area_m2"]) if ppm else None
    roi_w_px = roi_x2 - roi_x1
    roi_h_px = roi_y2 - roi_y1
    facade_area_m2 = (roi_w_px * roi_h_px) / (ppm * ppm) if ppm else None
    ratio_openings = (openings_area_m2 / facade_area_m2) if (facade_area_m2 and openings_area_m2) else None

    # ── Image brute en b64 ──
    plan_b64 = pipeline._np_to_b64(img_rgb)

    # ── Overlay annoté ──
    # NOTE: img_rgb est en RGB ; Image.fromarray (dans _np_to_b64) l'encode en RGB.
    # Les couleurs ci-dessous sont donc des triplets (R, G, B) directs.
    overlay = img_rgb.copy()
    TYPE_COLORS_RGB = {
        "window":     (96,  165, 250),   # #60a5fa blue-400
        "door":       (244, 114, 182),   # #f472b6 pink-400
        "balcony":    (52,  211, 153),   # #34d399 emerald-400
        "roof":       (167, 139, 250),   # #a78bfa violet-400
        "floor_line": (251, 146,  60),   # #fb923c orange-400
        "column":     (148, 163, 184),   # #94a3b8 slate-400
        "other":      (251, 191,  36),   # #fbbf24 amber-400
    }
    for el in elements:
        bx = el["bbox_norm"]
        x1 = int(bx["x"] * W)
        y1 = int(bx["y"] * H)
        x2 = int((bx["x"] + bx["w"]) * W)
        y2 = int((bx["y"] + bx["h"]) * H)
        color = TYPE_COLORS_RGB.get(el["type"], (180, 180, 180))
        if el["type"] == "floor_line":
            cv2.line(overlay, (x1, (y1 + y2) // 2), (x2, (y1 + y2) // 2), color, 2, cv2.LINE_AA)
        else:
            # Remplissage semi-transparent (25 %)
            tmp = overlay.copy()
            cv2.rectangle(tmp, (x1, y1), (x2, y2), color, cv2.FILLED)
            cv2.addWeighted(tmp, 0.22, overlay, 0.78, 0, overlay)
            # Bordure pleine + label
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
            cv2.putText(overlay, el["label_fr"], (x1, max(y1 - 5, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)

    # ── Dessiner la ROI sur l'overlay si elle était définie ──
    if req.building_roi:
        roi_color = (0, 255, 200)  # cyan-vert
        cv2.rectangle(overlay, (roi_x1, roi_y1), (roi_x2, roi_y2), roi_color, 2, cv2.LINE_AA)
        cv2.putText(overlay, "ROI", (roi_x1 + 4, roi_y1 + 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, roi_color, 1, cv2.LINE_AA)

    overlay_b64 = pipeline._np_to_b64(overlay)

    # ── Générer masques PNG par type (comme le pipeline plan intérieur) ──────
    # Chaque masque = image grayscale (blanc = élément, noir = fond)
    # Utilisable côté frontend pour l'éditeur de masques façade
    MASK_TYPES = ["window", "door", "balcony", "roof", "column"]
    facade_masks = {}
    for mtype in MASK_TYPES:
        mask = np.zeros((H, W), dtype=np.uint8)
        for el in elements:
            if el["type"] != mtype:
                continue
            bx = el["bbox_norm"]
            x1m = int(bx["x"] * W)
            y1m = int(bx["y"] * H)
            x2m = int((bx["x"] + bx["w"]) * W)
            y2m = int((bx["y"] + bx["h"]) * H)
            cv2.rectangle(mask, (x1m, y1m), (x2m, y2m), 255, cv2.FILLED)
        if mask.any():
            _, buf_mask = cv2.imencode(".png", mask)
            facade_masks[f"mask_{mtype}_b64"] = base64.b64encode(buf_mask).decode()

    # ── Masque mur opaque (tout sauf ouvertures) ────────────────────────────
    wall_mask = np.zeros((H, W), dtype=np.uint8)
    # Remplir la zone ROI en blanc
    cv2.rectangle(wall_mask, (roi_x1, roi_y1), (roi_x2, roi_y2), 255, cv2.FILLED)
    # Soustraire toutes les ouvertures
    for el in elements:
        if el["type"] in ("window", "door", "balcony"):
            bx = el["bbox_norm"]
            x1m = int(bx["x"] * W)
            y1m = int(bx["y"] * H)
            x2m = int((bx["x"] + bx["w"]) * W)
            y2m = int((bx["y"] + bx["h"]) * H)
            cv2.rectangle(wall_mask, (x1m, y1m), (x2m, y2m), 0, cv2.FILLED)
    if wall_mask.any():
        _, buf_wall = cv2.imencode(".png", wall_mask)
        facade_masks["mask_wall_opaque_b64"] = base64.b64encode(buf_wall).decode()

    # ── Masque RGBA coloré (overlay_openings style) ─────────────────────────
    overlay_rgba = np.zeros((H, W, 4), dtype=np.uint8)
    for el in elements:
        color_rgb = TYPE_COLORS_RGB.get(el["type"], (180, 180, 180))
        bx = el["bbox_norm"]
        x1m = int(bx["x"] * W)
        y1m = int(bx["y"] * H)
        x2m = int((bx["x"] + bx["w"]) * W)
        y2m = int((bx["y"] + bx["h"]) * H)
        if el["type"] == "floor_line":
            cy_m = (y1m + y2m) // 2
            cv2.line(overlay_rgba, (x1m, cy_m), (x2m, cy_m), (*color_rgb, 200), 3, cv2.LINE_AA)
        else:
            cv2.rectangle(overlay_rgba, (x1m, y1m), (x2m, y2m), (*color_rgb, 140), cv2.FILLED)
            cv2.rectangle(overlay_rgba, (x1m, y1m), (x2m, y2m), (*color_rgb, 220), 2, cv2.LINE_AA)
    _, buf_rgba = cv2.imencode(".png", overlay_rgba)
    facade_masks["overlay_openings_b64"] = base64.b64encode(buf_rgba).decode()

    # ── Surface murale nette (opaque) ──
    surface_mur_net = None
    if facade_area_m2 is not None:
        surface_mur_net = round(max(0.0, facade_area_m2 - (openings_area_m2 or 0.0)), 2)

    return {
        "session_id": req.session_id,
        "windows_count": len(windows),
        "doors_count": len(doors),
        "balconies_count": len(balconies),
        "floors_count": floors_count,
        "elements": elements,
        "facade_area_m2": round(facade_area_m2, 2) if facade_area_m2 else None,
        "openings_area_m2": round(openings_area_m2, 2) if openings_area_m2 else None,
        "surface_mur_net": surface_mur_net,
        "ratio_openings": round(ratio_openings, 4) if ratio_openings else None,
        "pixels_per_meter": ppm,
        "building_roi": {
            "x": round(roi_x1 / W, 5),
            "y": round(roi_y1 / H, 5),
            "w": round((roi_x2 - roi_x1) / W, 5),
            "h": round((roi_y2 - roi_y1) / H, 5),
        },
        "overlay_b64": overlay_b64,
        "plan_b64": plan_b64,
        # Masques éditables par type (comme le pipeline plan intérieur)
        **facade_masks,
        "is_mock": False,
    }


# ── Plan diff ─────────────────────────────────────────────────────────────────

class DiffPlansRequest(BaseModel):
    session_id_v1: str
    session_id_v2: str

@app.post("/diff-plans")
def diff_plans(req: DiffPlansRequest):
    s1 = sessions.get(req.session_id_v1)
    s2 = sessions.get(req.session_id_v2)
    if s1 is None or s2 is None:
        raise HTTPException(status_code=404, detail="Session(s) introuvable(s)")
    result = pipeline.compute_plan_diff(s1["img_rgb"], s2["img_rgb"])
    result["session_id_v1"] = req.session_id_v1
    result["session_id_v2"] = req.session_id_v2
    return result


# ── Cartouche extraction ──────────────────────────────────────────────────────

class CartoucheRequest(BaseModel):
    session_id: str

@app.post("/extract-cartouche")
def extract_cartouche_endpoint(req: CartoucheRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session introuvable")
    result = pipeline.extract_cartouche(s["img_rgb"])
    result["session_id"] = req.session_id
    return result
