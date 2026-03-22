"""
warmup_models.py
----------------
Pre-charge tous les modèles FloorScan dans le serveur d'inférence local.
Lance d'abord le serveur : docker compose up -d

Usage:
    python warmup_models.py
"""

import requests
import time

LOCAL_URL = "http://localhost:9001"
API_KEY   = "vsFE5RCISwR0yitbIbDO"

MODELS = [
    "cubicasa5k-2-qpmsa-1gd2e/1",
    "cubicasa5k-2-qpmsa/3",
    "cubicasa-xmyt3-d4s04/3",
    "floorplan-3xara/1",
    "wall-detection-xi9ox/1",
    "elevation-24mp4/1",
]


def wait_for_server(timeout=60):
    print("Attente du serveur d'inference local...")
    for i in range(timeout):
        try:
            r = requests.get(f"{LOCAL_URL}/", timeout=2)
            if r.status_code < 500:
                print("Serveur pret!\n")
                return True
        except Exception:
            pass
        time.sleep(1)
        if i % 10 == 9:
            print(f"  {i+1}s...")
    return False


def warmup_model(model_id: str) -> bool:
    print(f"  [{model_id}] Chargement des poids...")
    try:
        r = requests.post(
            f"{LOCAL_URL}/model/add",
            json={"model_id": model_id, "api_key": API_KEY},
            timeout=120,
        )
        if r.status_code == 200:
            data = r.json()
            models = data.get("models", [])
            if models:
                m = models[0]
                task = m.get("task_type", "?")
                w = m.get("input_width", "?")
                h = m.get("input_height", "?")
                print(f"  [{model_id}] OK - {task} {w}x{h}")
            else:
                print(f"  [{model_id}] OK - charge")
            return True
        else:
            print(f"  [{model_id}] ERR status {r.status_code}: {r.text[:100]}")
            return False
    except Exception as e:
        print(f"  [{model_id}] ERR exception: {e}")
        return False


def main():
    if not wait_for_server():
        print("ERREUR: Serveur non accessible. Lance: docker compose up -d")
        return

    results = []

    for model_id in MODELS:
        ok = warmup_model(model_id)
        results.append((model_id, ok))
        print()

    print("=" * 50)
    print("RESUME - Modeles en cache local:")
    for model_id, ok in results:
        status = "OK" if ok else "ERR"
        print(f"  {status}  {model_id}")

    ok_count = sum(1 for _, ok in results if ok)
    print(f"\n{ok_count}/{len(MODELS)} modeles charges avec succes.")
    print("Les poids sont persistes dans le volume Docker 'inference_models'.")


if __name__ == "__main__":
    main()
