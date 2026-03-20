"""
patch_pipeline_h.py — Patch pour activer Pipeline H dans run_comparison()

Usage depuis le serveur :
    python patch_pipeline_h.py

Ce script modifie pipeline.py pour :
1. Ajouter l'appel à run_pipeline_h() dans run_comparison()
2. Ajouter "H" dans la ordered list du tableau comparatif
"""

import re, sys

PIPELINE_FILE = "pipeline.py"

# ── Patch 1 : injecter l'appel Pipeline H avant le nettoyage des masques ──
MARKER = '    # ── Clean up internal raw masks before JSON serialization ──'
INSERT = '''    # ── Pipeline H: diagonal wall detection ──
    try:
        logger.info("Building diagonal pipeline H...")
        from pipeline_diagonal import run_pipeline_h
        results["H"] = run_pipeline_h(img_rgb, img_pil, client, ppm, cfg)
        logger.info("Pipeline H built: doors=%d, windows=%d, diagonal_pct=%.1f%%",
                     results["H"].get("doors_count", 0), results["H"].get("windows_count", 0),
                     (results["H"].get("diagonal_stats") or {}).get("diagonal_pct", 0))
    except Exception as e:
        logger.error("Pipeline H failed: %s", e, exc_info=True)
        results["H"] = {
            "id": "H", "name": "Diagonal (H)", "description": "Morphologie adaptative + Hough multi-angles",
            "color": "#06B6D4",
            "doors_count": 0, "windows_count": 0,
            "mask_doors_b64": None, "mask_windows_b64": None, "mask_walls_b64": None,
            "mask_footprint_b64": None, "footprint_area_m2": None, "rooms_count": 0, "rooms": [],
            "mask_rooms_b64": None, "timing_seconds": 0, "error": str(e),
            "is_diagonal": True,
        }

'''

# ── Patch 2 : ajouter H dans la ordered list ──
OLD_ORDERED = '    ordered = ["G", "F", "A", "B", "C", "D", "E"]'
NEW_ORDERED = '    ordered = ["H", "G", "F", "A", "B", "C", "D", "E"]'

def apply_patch():
    with open(PIPELINE_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if 'run_pipeline_h' in content:
        print("✅ Pipeline H déjà intégré dans pipeline.py — rien à faire.")
        return

    if MARKER not in content:
        print(f"❌ Marqueur introuvable dans pipeline.py : {MARKER!r}")
        sys.exit(1)

    # Patch 1
    content = content.replace(MARKER, INSERT + MARKER)
    # Patch 2
    content = content.replace(OLD_ORDERED, NEW_ORDERED)

    with open(PIPELINE_FILE, "w", encoding="utf-8") as f:
        f.write(content)

    print("✅ pipeline.py patché avec succès — Pipeline H activé.")
    print("   → Redémarrer le serveur FastAPI pour prendre l'effet.")

if __name__ == "__main__":
    apply_patch()
