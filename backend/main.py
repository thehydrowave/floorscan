# main.py — Serveur FastAPI FloorScan
# Lancer avec : uvicorn main:app --reload --host 0.0.0.0 --port 8000

import os, io, json, uuid, base64
from pathlib import Path
from typing import Optional

import numpy as np
import cv2
from PIL import Image

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel, ConfigDict

import pipeline

app = FastAPI(title="FloorScan API", version="1.0.0")

# CORS : autorise le frontend (à adapter en prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# STORE EN MÉMOIRE (remplacer par Redis/DB en prod)
# sessions[session_id] = { img_rgb, m_doors, m_windows, walls,
#                           interior_mask, pixels_per_meter,
#                           analysis_result }
# ============================================================
sessions: dict = {}


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
    return {"status": "ok", "service": "FloorScan API"}


# ============================================================
# ROUTE 2 — UPLOAD PDF → rendu image base64
# ============================================================
class UploadPdfRequest(BaseModel):
    pdf_base64: str
    filename: str = "plan.pdf"
    zoom: float = 3.0
    page: int = 0          # index de page (0 = première page)

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

    session_id = str(uuid.uuid4())
    sessions[session_id] = {"img_rgb": img_rgb}

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
# ROUTE 2b — UPLOAD IMAGE (PNG/JPG) → session
# ============================================================
class UploadImageRequest(BaseModel):
    image_base64: str
    filename: str = "plan.png"

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

    session_id = str(uuid.uuid4())
    sessions[session_id] = {"img_rgb": img_rgb}

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

    cropped = pipeline.crop_image(s["img_rgb"], req.x0, req.y0, req.x1, req.y1)
    if cropped.size == 0:
        raise HTTPException(400, "Zone de crop invalide")

    sessions[req.session_id]["img_rgb"] = cropped
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

    ppm = pipeline.compute_scale(req.x1, req.y1, req.x2, req.y2, req.real_m)
    sessions[req.session_id]["pixels_per_meter"] = ppm

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
    return np.frombuffer(data, np.uint8).reshape(shape)

# ============================================================
# ROUTE 5 — ANALYSE COMPLÈTE (Roboflow + surfaces)
# ============================================================
class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    session_id: str
    roboflow_api_key: str = "Kh56un5foPflRVreiNOM"
    model_id: str = "cubicasa5k-2-qpmsa-1gd2e/1"
    pixels_per_meter: Optional[float] = None
    conf_min_door: float = 0.05
    conf_min_win: float = 0.15
    wall_thickness_m: float = 0.20

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    img_rgb = s["img_rgb"]
    ppm = req.pixels_per_meter or s.get("pixels_per_meter")

    cfg = dict(pipeline.DEFAULT_CONFIG)
    cfg["api_key"]          = req.roboflow_api_key
    cfg["model_id"]         = req.model_id
    cfg["conf_min_door"]    = req.conf_min_door
    cfg["conf_min_win"]     = req.conf_min_win
    cfg["wall_thickness_m"] = req.wall_thickness_m

    try:
        result = pipeline.run_analysis(img_rgb, pixels_per_meter=ppm, cfg=cfg)
    except Exception as e:
        raise HTTPException(500, f"Erreur analyse : {e}")

    # Stocker les masques bruts + masque intérieur pour édition
    interior_mask = result.get("surfaces", {}).get("interior_mask")

    sessions[req.session_id].update({
        "m_doors":          np.array(result["_m_doors"],   dtype=np.uint8),
        "m_windows":        np.array(result["_m_windows"], dtype=np.uint8),
        "walls":            np.array(result["_walls"],     dtype=np.uint8),
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

    # Nettoyer la réponse JSON
    resp = {k: v for k, v in result.items() if not k.startswith("_")}
    if "surfaces" in resp and "interior_mask" in resp["surfaces"]:
        del resp["surfaces"]["interior_mask"]

    return resp


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
        "m_doors": _compress_mask(s["m_doors"]),
        "m_windows": _compress_mask(s["m_windows"]),
        "interior_mask": _compress_mask(s["interior_mask"]) if s.get("interior_mask") is not None else None,
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
        # FIX: support de l'édition du masque de surface habitable
        existing = s.get("interior_mask")
        if existing is None:
            # Créer un masque vide si pas encore calculé
            mask = np.zeros((H, W), np.uint8)
        else:
            mask = existing.copy()
    else:
        raise HTTPException(400, "layer doit être 'door', 'window' ou 'interior'")

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

    # Recalculer surfaces + overlays
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
    )

    # FIX: mettre à jour la session avec les nouvelles images pour l'export PDF
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
    # Mettre à jour le masque intérieur brut si recalculé
    if result.get("_interior_mask") is not None:
        sessions[req.session_id]["interior_mask"] = result["_interior_mask"]

    resp = {k: v for k, v in result.items() if not k.startswith("_")}
    # Conserver rooms et walls (non recalculés lors de l'édition des masques)
    resp["rooms"] = sessions[req.session_id]["analysis"].get("rooms", [])
    resp["walls"] = sessions[req.session_id]["analysis"].get("walls", [])
    resp["edit_history_len"] = len(s.get("mask_edit_history", []))
    resp["edit_future_len"] = len(s.get("mask_edit_future", []))
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
    """Restore door/window/interior masks from a compressed snapshot and recompute overlays."""
    img_rgb = s["img_rgb"]
    H, W = img_rgb.shape[:2]
    s["m_doors"] = _decompress_mask(snapshot["m_doors"], (H, W))
    s["m_windows"] = _decompress_mask(snapshot["m_windows"], (H, W))
    if snapshot["interior_mask"] is not None:
        s["interior_mask"] = _decompress_mask(snapshot["interior_mask"], (H, W))
    else:
        s["interior_mask"] = None

    ppm = s.get("pixels_per_meter")
    interior_override = s.get("interior_mask")
    result = pipeline.recompute_from_edited_masks(
        img_rgb, s["m_doors"], s["m_windows"], s["walls"], ppm, cfg,
        interior_mask_override=interior_override,
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
    resp = {k: v for k, v in result.items() if not k.startswith("_")}
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
        "m_doors": _compress_mask(s["m_doors"]),
        "m_windows": _compress_mask(s["m_windows"]),
        "interior_mask": _compress_mask(s["interior_mask"]) if s.get("interior_mask") is not None else None,
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
        "m_doors": _compress_mask(s["m_doors"]),
        "m_windows": _compress_mask(s["m_windows"]),
        "interior_mask": _compress_mask(s["interior_mask"]) if s.get("interior_mask") is not None else None,
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
    apply_to: str = "interior"  # "interior" | "door" | "window" — masque cible
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
        "m_doors": _compress_mask(s["m_doors"]),
        "m_windows": _compress_mask(s["m_windows"]),
        "interior_mask": _compress_mask(s["interior_mask"]) if s.get("interior_mask") is not None else None,
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
    elif req.apply_to == "interior":
        existing = s.get("interior_mask")
        target = existing.copy() if existing is not None else np.zeros((H, W), np.uint8)
    else:
        raise HTTPException(400, "apply_to doit être 'door', 'window' ou 'interior'")

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
# Utilise le modèle Roboflow "elevation-24mp4/1" (door, window, building, roof, floor)
# ============================================================
FACADE_MODEL_ID = "elevation-24mp4/1"

# Mapping classes Roboflow → types façade internes
FACADE_CLASS_MAP = {
    "door":     "door",
    "window":   "window",
    "building": "other",      # contour global → on le garde comme "other"
    "roof":     "roof",
    "floor":    "floor_line",
}

FACADE_LABELS_FR = {
    "door":       "Porte",
    "window":     "Fenêtre",
    "roof":       "Toiture",
    "floor_line": "Ligne d'étage",
    "other":      "Bâtiment",
}

class AnalyzeFacadeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    session_id: str
    roboflow_api_key: str = "Kh56un5foPflRVreiNOM"
    pixels_per_meter: Optional[float] = None
    confidence: float = 0.25

@app.post("/analyze-facade")
def analyze_facade(req: AnalyzeFacadeRequest):
    s = sessions.get(req.session_id)
    if s is None:
        raise HTTPException(404, "Session introuvable")

    img_rgb = s["img_rgb"]
    H, W = img_rgb.shape[:2]
    ppm = req.pixels_per_meter or s.get("pixels_per_meter")

    # ── Appel Roboflow inference ──
    from inference_sdk import InferenceHTTPClient
    client = InferenceHTTPClient(
        api_url="https://serverless.roboflow.com",
        api_key=req.roboflow_api_key,
    )

    # Encode image for inference
    img_pil = Image.fromarray(img_rgb).convert("RGB")
    buf = io.BytesIO()
    img_pil.save(buf, format="JPEG", quality=95)
    buf.seek(0)
    img_b64_for_infer = base64.b64encode(buf.read()).decode()

    try:
        resp = client.infer(img_b64_for_infer, model_id=FACADE_MODEL_ID)
    except Exception as e:
        raise HTTPException(500, f"Erreur inférence façade : {e}")

    predictions = resp.get("predictions", [])

    # ── Convertir les détections en FacadeElement ──
    elements = []
    for i, pred in enumerate(predictions):
        cls_name = pred.get("class", "").lower()
        if cls_name not in FACADE_CLASS_MAP:
            continue
        if pred.get("confidence", 0) < req.confidence:
            continue

        facade_type = FACADE_CLASS_MAP[cls_name]

        # Roboflow retourne x_center, y_center, width, height en pixels
        cx = pred["x"]
        cy = pred["y"]
        pw = pred["width"]
        ph = pred["height"]

        # Convertir en bbox normalisée (top-left x, y, w, h)
        x_norm = (cx - pw / 2) / W
        y_norm = (cy - ph / 2) / H
        w_norm = pw / W
        h_norm = ph / H

        # Clamp
        x_norm = max(0, min(1, x_norm))
        y_norm = max(0, min(1, y_norm))
        w_norm = min(w_norm, 1 - x_norm)
        h_norm = min(h_norm, 1 - y_norm)

        # Calcul surface
        area_m2 = None
        if ppm and ppm > 0:
            area_px2 = pw * ph
            area_m2 = area_px2 / (ppm * ppm)

        elements.append({
            "id": i,
            "type": facade_type,
            "label_fr": FACADE_LABELS_FR.get(facade_type, cls_name),
            "bbox_norm": {"x": round(x_norm, 5), "y": round(y_norm, 5),
                          "w": round(w_norm, 5), "h": round(h_norm, 5)},
            "area_m2": round(area_m2, 3) if area_m2 is not None else None,
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
        # Trouver l'étage : au-dessus de la 1ère ligne = dernier étage, etc.
        level = len(floor_thresholds)  # par défaut : étage le plus haut
        for j, thresh in enumerate(floor_thresholds):
            if cy_norm > thresh:
                level = len(floor_thresholds) - j - 1
                # Continuer pour trouver le seuil le plus bas au-dessus
        # Méthode simple : compter combien de floor_lines sont au-dessus du centre
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
    facade_area_m2 = (W * H) / (ppm * ppm) if ppm else None
    ratio_openings = (openings_area_m2 / facade_area_m2) if (facade_area_m2 and openings_area_m2) else None

    # ── Image brute en b64 ──
    plan_b64 = pipeline._np_to_b64(img_rgb)

    # ── Overlay annoté ──
    overlay = img_rgb.copy()
    TYPE_COLORS_BGR = {
        "window":     (250, 164, 96),   # bleu clair
        "door":       (180, 114, 244),  # rose
        "roof":       (250, 139, 167),  # violet
        "floor_line": (60, 146, 251),   # orange
        "other":      (36, 187, 251),   # jaune
    }
    for el in elements:
        bx = el["bbox_norm"]
        x1 = int(bx["x"] * W)
        y1 = int(bx["y"] * H)
        x2 = int((bx["x"] + bx["w"]) * W)
        y2 = int((bx["y"] + bx["h"]) * H)
        color = TYPE_COLORS_BGR.get(el["type"], (180, 180, 180))
        thickness = 2
        if el["type"] == "floor_line":
            cv2.line(overlay, (x1, (y1 + y2) // 2), (x2, (y1 + y2) // 2), color, 2, cv2.LINE_AA)
        else:
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, thickness, cv2.LINE_AA)
            label = el["label_fr"]
            cv2.putText(overlay, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)

    overlay_b64 = pipeline._np_to_b64(overlay)

    return {
        "session_id": req.session_id,
        "windows_count": len(windows),
        "doors_count": len(doors),
        "balconies_count": len(balconies),
        "floors_count": floors_count,
        "elements": elements,
        "facade_area_m2": round(facade_area_m2, 2) if facade_area_m2 else None,
        "openings_area_m2": round(openings_area_m2, 2) if openings_area_m2 else None,
        "ratio_openings": round(ratio_openings, 4) if ratio_openings else None,
        "pixels_per_meter": ppm,
        "overlay_b64": overlay_b64,
        "plan_b64": plan_b64,
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
