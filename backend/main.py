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


# ============================================================
# ROUTE 5 — ANALYSE COMPLÈTE (Roboflow + surfaces)
# ============================================================
class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    session_id: str
    roboflow_api_key: str
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
        "m_doors":       np.array(result["_m_doors"],   dtype=np.uint8),
        "m_windows":     np.array(result["_m_windows"], dtype=np.uint8),
        "walls":         np.array(result["_walls"],     dtype=np.uint8),
        "interior_mask": interior_mask,
        "pixels_per_meter": result["pixels_per_meter"],
        "cfg": cfg,
        "analysis": result,
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
    return resp


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
