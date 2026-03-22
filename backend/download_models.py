"""
download_models.py
------------------
Télécharge tous les modèles FloorScan depuis Roboflow et les sauvegarde
dans le dossier local `models/`.

Usage:
    python download_models.py
"""

import os
import requests
import zipfile
import io

API_KEY   = "tyCM9PZp8cs3KtifPUaQ"
WORKSPACE = "aza-9mqzq"
OUT_DIR   = os.path.join(os.path.dirname(__file__), "models")

# Modèles à télécharger : (project_id, version, format_préféré, fallback_format)
MODELS = [
    ("cubicasa5k-2-qpmsa-1gd2e", "1", "coco",          None),
    ("cubicasa5k-2-qpmsa",       "3", "yolov8",         "yolov5pytorch"),
    ("cubicasa-xmyt3-d4s04",     "3", "coco",           None),
    ("floorplan-3xara",          "1", "yolov8",         "yolov5pytorch"),
    ("wall-detection-xi9ox",     "1", "yolov8",         "yolov5pytorch"),
    ("elevation-24mp4",          "1", "yolov8",         "yolov5pytorch"),
]


def download_model(project: str, version: str, fmt: str, fallback: str | None) -> bool:
    model_id = f"{project}/{version}"
    dest_dir = os.path.join(OUT_DIR, f"{project}_v{version}")
    os.makedirs(dest_dir, exist_ok=True)

    # Essayer le format principal, puis le fallback
    for f in ([fmt] + ([fallback] if fallback else [])):
        url = f"https://api.roboflow.com/{WORKSPACE}/{project}/{version}/{f}?api_key={API_KEY}"
        print(f"  [{model_id}] Requête export '{f}'...")
        r = requests.get(url, timeout=30)

        if r.status_code != 200:
            print(f"  [{model_id}] ERR format '{f}' non disponible ({r.status_code})")
            continue

        data = r.json()
        export = data.get("export", {})
        link = export.get("link")

        if not link:
            print(f"  [{model_id}] ERR pas de lien de téléchargement pour '{f}'")
            continue

        print(f"  [{model_id}] OK format '{f}' — téléchargement...")
        dl = requests.get(link, timeout=120)

        if dl.status_code != 200:
            print(f"  [{model_id}] ERR échec téléchargement ({dl.status_code})")
            continue

        content_type = dl.headers.get("Content-Type", "")

        if "zip" in content_type or link.endswith(".zip"):
            # Extraire le zip
            with zipfile.ZipFile(io.BytesIO(dl.content)) as z:
                z.extractall(dest_dir)
            print(f"  [{model_id}] OK extrait dans {dest_dir}")
        else:
            # Sauvegarder tel quel
            ext = ".pt" if f.startswith("yolo") else ".json"
            out_file = os.path.join(dest_dir, f"model_{f}{ext}")
            with open(out_file, "wb") as fh:
                fh.write(dl.content)
            print(f"  [{model_id}] OK sauvegardé → {out_file}")

        # Sauvegarder les métadonnées
        meta_file = os.path.join(dest_dir, "meta.json")
        import json
        with open(meta_file, "w") as fh:
            json.dump({
                "model_id": model_id,
                "workspace": WORKSPACE,
                "format": f,
                "endpoint": f"https://serverless.roboflow.com/{model_id}",
                "map": data.get("version", {}).get("model", {}).get("map"),
            }, fh, indent=2)

        return True

    print(f"  [{model_id}] ERR aucun format téléchargeable trouvé")
    return False


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"Dossier de sortie : {OUT_DIR}\n")

    results = []
    for project, version, fmt, fallback in MODELS:
        ok = download_model(project, version, fmt, fallback)
        results.append((f"{project}/{version}", ok))
        print()

    print("=" * 50)
    print("RÉSUMÉ :")
    for model_id, ok in results:
        status = "OK" if ok else "ERR"
        print(f"  {status}  {model_id}")


if __name__ == "__main__":
    main()
