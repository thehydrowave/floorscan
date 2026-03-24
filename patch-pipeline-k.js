#!/usr/bin/env node
/**
 * patch-pipeline-k.js
 * Applique le Pipeline K (rotation automatique adaptative) dans :
 *   - backend/pipeline_diagonal.py  : ajoute run_pipeline_k + _detect_dominant_angles
 *   - backend/pipeline.py           : enregistre K dans PIPELINE_DEFINITIONS + route /compare
 *
 * PRÉREQUIS : git revert 337efd1 --no-edit && git push
 *             (restaure pipeline_diagonal.py avant d'appliquer ce patch)
 *
 * Usage: node patch-pipeline-k.js
 */

const fs   = require("fs");
const path = require("path");

const DIAG = path.join(__dirname, "backend/pipeline_diagonal.py");
const PIPE = path.join(__dirname, "backend/pipeline.py");

for (const f of [DIAG, PIPE]) {
  if (!fs.existsSync(f)) { console.error(`❌ Fichier introuvable: ${f}`); process.exit(1); }
}

let diag = fs.readFileSync(DIAG, "utf8");
let pipe = fs.readFileSync(PIPE, "utf8");
let applied = 0;

// ══════════════════════════════════════════════════════════════════
// PATCH 1 — Ajouter _detect_dominant_angles + run_pipeline_k
//           à la FIN de pipeline_diagonal.py
// ══════════════════════════════════════════════════════════════════
const PIPELINE_K_ALREADY = diag.includes("run_pipeline_k");
if (PIPELINE_K_ALREADY) {
  console.warn("⚠️  PATCH 1 déjà appliqué (run_pipeline_k présent)");
} else {
  diag += `

# ============================================================
# UTILS — détection automatique des angles dominants du plan
# ============================================================

def _detect_dominant_angles(img_rgb: np.ndarray,
                             ortho_tolerance: float = 15.0,
                             min_line_length_ratio: float = 0.03,
                             max_gap_ratio: float = 0.01,
                             max_angles: int = 3) -> list:
    """Détecte les angles dominants non-orthogonaux dans le plan via Hough.

    Retourne une liste d'angles en degrés (dans [0, 90[) représentant
    les directions de murs non alignées sur H/V.
    Utilisé par le pipeline K pour choisir les rotations d'inférence.
    """
    H, W = img_rgb.shape[:2]
    min_dim = min(H, W)
    gray  = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
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
        if angle >= 90: angle -= 90
        raw_angles.append(angle)
    if not raw_angles:
        return []
    diagonal_angles = [a for a in raw_angles
                       if ortho_tolerance < a < (90.0 - ortho_tolerance)]
    if not diagonal_angles:
        logger.info("[K-angles] Aucun angle diagonal (plan orthogonal)")
        return []
    diagonal_angles.sort()
    clusters = []
    for a in diagonal_angles:
        placed = False
        for idx, (centre, cnt_c) in enumerate(clusters):
            if abs(a - centre) <= 8.0:
                clusters[idx] = ((centre * cnt_c + a) / (cnt_c + 1), cnt_c + 1)
                placed = True; break
        if not placed:
            clusters.append((a, 1))
    clusters.sort(key=lambda x: x[1], reverse=True)
    dominant = [round(c, 1) for c, n in clusters[:max_angles] if n > 2]
    logger.info("[K-angles] angles dominants : %s (%d segments diag)", dominant, len(diagonal_angles))
    return dominant


# ============================================================
# PIPELINE K — Rotation automatique adaptative
# ============================================================

def run_pipeline_k(img_rgb: np.ndarray, img_pil,
                   client, ppm: float, cfg: dict) -> dict:
    """Pipeline K : rotation automatique basée sur les angles Hough dominants.

    vs H (passes fixes +-45 deg) :
    - Détecte les angles dominants du plan automatiquement via Hough
    - Applique les rotations exactes correspondantes
    - Plan orthogonal -> 0 rotation (plus rapide que H)
    - Plans N-directionnels -> N*2 passes adaptées
    """
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
    detected_angles = []

    try:
        model_id = cfg.get("model_id", pip.DEFAULT_CONFIG["model_id"])

        # 0. Détection automatique des angles dominants
        detected_angles = _detect_dominant_angles(img_rgb)
        logger.info("[K] angles détectés : %s", detected_angles)

        # 1. Passes orthogonales standard
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

        # 1b. Passes adaptatives selon angles détectés
        if detected_angles:
            rotation_angles = []
            for a in detected_angles:
                rotation_angles.append(-a)
                rotation_angles.append(-(a - 90.0))
            seen = set(); filtered_angles = []
            for ra in rotation_angles:
                ra_norm = ra % 360
                close_to_ortho = any(abs((ra_norm - o) % 360) < 10 or abs((ra_norm - o) % 360) > 350
                                     for o in [0, 90, 180, 270])
                key = round(ra_norm, 0)
                if not close_to_ortho and key not in seen:
                    seen.add(key); filtered_angles.append(ra)
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
        logger.info("[K] walls=%d, doors=%d, wins=%d",
                    cv2.countNonZero(m_walls), cv2.countNonZero(m_doors), cv2.countNonZero(m_wins))

        # 3. Empreinte diagonale
        cnt, footprint_mask = _compute_footprint_diagonal(m_walls, m_doors, m_wins, H, W)
        if cnt is None: logger.warning("[K] Empreinte non trouvée")
        elif ppm is not None: footprint_area_m2 = float(cv2.contourArea(cnt)) / (ppm ** 2)

        # 4. Surface habitable
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
        mask_doors_b64   = _ov(m_doors,   (217, 70,  239), 90)
        mask_windows_b64 = _ov(m_wins,    (34,  211, 238), 90)
        mask_walls_b64   = _ov(m_walls,   (96,  165, 250), 90)
        mask_rooms_b64   = (pip._np_to_b64(pip._build_rooms_color_mask(rooms_list, H, W))
                            if rooms_list else None)
        mask_footprint_b64 = (pip._np_to_b64(pip._mask_to_rgba(footprint_mask, (251, 191, 36), 50))
                              if footprint_mask is not None and cv2.countNonZero(footprint_mask) > 0 else None)
        mask_hab_b64 = (pip._np_to_b64(pip._mask_to_rgba(interior_mask, (74, 222, 128), 60))
                        if interior_mask is not None and cv2.countNonZero(interior_mask) > 0 else None)
        diag_overlay = np.zeros((H, W), np.uint8)
        for seg in diag_segs:
            cv2.line(diag_overlay, (seg["x1"], seg["y1"]), (seg["x2"], seg["y2"]), 255, 3, cv2.LINE_AA)
        mask_diagonal_b64 = _ov(diag_overlay, (249, 115, 22), 200)

    except Exception as e:
        error = str(e); logger.error("Pipeline K failed: %s", e, exc_info=True)

    elapsed = time.time() - t0
    return {
        "id": "K", "name": "Auto-rotate (K)",
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
        "timing_seconds": round(elapsed, 2), "error": error, "is_diagonal": True,
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
            "diagonal_pct": round(diagonal_pct, 1), "detected_angles": detected_angles,
        },
        "_m_doors_raw": m_doors, "_m_windows_raw": m_wins, "_m_walls_raw": m_walls,
    }
`;
  console.log("✅ PATCH 1 — run_pipeline_k ajouté dans pipeline_diagonal.py");
  applied++;
}

// ══════════════════════════════════════════════════════════════════
// PATCH 2 — Ajouter K dans PIPELINE_DEFINITIONS de pipeline.py
// ══════════════════════════════════════════════════════════════════
const P2_OLD = `    {
        "id": "F", "name": "Consensus (F)",`;
const P2_NEW = `    {
        "id": "K", "name": "Auto-rotate (K)",
        "model_ids": ["wall-detection-xi9ox/1"],
        "type": "diagonal",
        "description": "Rotation automatique Hough + inférence adaptative multi-angles",
        "color": "#ec4899",  # pink
    },
    {
        "id": "F", "name": "Consensus (F)",`;
if (pipe.includes(P2_OLD) && !pipe.includes('"id": "K"')) {
  pipe = pipe.replace(P2_OLD, P2_NEW);
  console.log("✅ PATCH 2 — K ajouté dans PIPELINE_DEFINITIONS");
  applied++;
} else { console.warn("⚠️  PATCH 2 déjà appliqué ou introuvable"); }

// ══════════════════════════════════════════════════════════════════
// PATCH 3 — Bloc d'exécution pipeline K dans la route /compare
// ══════════════════════════════════════════════════════════════════
const P3_OLD = `    # ── Clean up internal raw masks before JSON serialization ──`;
const P3_NEW = `    # ── Pipeline K: Auto-rotate adaptive (Hough dominant angles) ──
    try:
        logger.info("Building auto-rotate pipeline K...")
        from pipeline_diagonal import run_pipeline_k
        results["K"] = run_pipeline_k(img_rgb, img_pil, client, ppm, cfg)
        logger.info("Pipeline K built: doors=%d, windows=%d, angles=%s",
                     results["K"].get("doors_count", 0), results["K"].get("windows_count", 0),
                     (results["K"].get("diagonal_stats") or {}).get("detected_angles", []))
    except Exception as e:
        logger.error("Pipeline K failed: %s", e, exc_info=True)
        results["K"] = {
            "id": "K", "name": "Auto-rotate (K)", "description": "Rotation automatique Hough",
            "color": "#ec4899",
            "doors_count": 0, "windows_count": 0,
            "mask_doors_b64": None, "mask_windows_b64": None, "mask_walls_b64": None,
            "mask_footprint_b64": None, "footprint_area_m2": None, "rooms_count": 0, "rooms": [],
            "mask_rooms_b64": None, "timing_seconds": 0, "error": str(e), "is_diagonal": True,
        }

    # ── Clean up internal raw masks before JSON serialization ──`;
if (pipe.includes(P3_OLD) && !pipe.includes('run_pipeline_k')) {
  pipe = pipe.replace(P3_OLD, P3_NEW);
  console.log("✅ PATCH 3 — bloc exécution K ajouté dans /compare");
  applied++;
} else { console.warn("⚠️  PATCH 3 déjà appliqué ou introuvable"); }

// ══════════════════════════════════════════════════════════════════
// PATCH 4 — Ajouter K dans la liste ordered du tableau de comparaison
// ══════════════════════════════════════════════════════════════════
const P4_OLD = `    ordered = ["J", "I", "H", "G", "F", "A", "B", "C", "D", "E"]`;
const P4_NEW = `    ordered = ["K", "J", "I", "H", "G", "F", "A", "B", "C", "D", "E"]`;
if (pipe.includes(P4_OLD)) {
  pipe = pipe.replace(P4_OLD, P4_NEW);
  console.log("✅ PATCH 4 — K ajouté dans ordered (tableau comparaison)");
  applied++;
} else { console.warn("⚠️  PATCH 4 déjà appliqué ou introuvable"); }

// ── Écriture des fichiers ──────────────────────────────────────────
if (applied > 0) {
  fs.writeFileSync(DIAG, diag, "utf8");
  fs.writeFileSync(PIPE, pipe, "utf8");
  console.log(`\n🎉 ${applied} patch(s) appliqué(s).`);
  console.log("👉 git add backend/pipeline_diagonal.py backend/pipeline.py");
  console.log("   git commit -m 'feat: pipeline K (auto-rotate adaptive)'");
  console.log("   git push");
} else {
  console.log("\n✅ Tout est déjà à jour.");
}
