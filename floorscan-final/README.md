# FloorScan — Guide de démarrage

## Structure du projet

```
floorscan/
├── backend/          ← Serveur Python (FastAPI + Roboflow)
│   ├── main.py       ← API REST (8 routes)
│   ├── pipeline.py   ← Logique IA (tiling, masques, surfaces, PDF)
│   └── requirements.txt
├── frontend/
│   └── index.html    ← Interface complète (ouvrir dans navigateur)
├── DEMARRER.bat      ← Démarrage Windows (double-cliquer)
└── demarrer.sh       ← Démarrage Mac/Linux
```

---

## Démarrage rapide

### Windows
1. Double-cliquez sur **`DEMARRER.bat`**
2. Attendez que le serveur affiche `Uvicorn running on http://0.0.0.0:8000`
3. Ouvrez **`frontend/index.html`** dans votre navigateur

### Mac / Linux
```bash
chmod +x demarrer.sh
./demarrer.sh
```

---

## Prérequis

- **Python 3.9+** : https://python.org
- **Clé API Roboflow** : https://app.roboflow.com/settings/api
- **Modèle Roboflow** entraîné sur des plans (ex: `cubicasa-xmyt3-d4s04/3`)

---

## Fonctionnalités complètes (identiques à la V1)

| Étape | Fonctionnalité |
|-------|---------------|
| 1 | Upload PDF → rendu haute résolution (×3) |
| 2 | Recadrage interactif de la zone d'intérêt |
| 3 | Calibration d'échelle (2 points + distance réelle) |
| 4 | **Analyse IA multi-scale** : 2 passes Roboflow (2048px + 1024px) |
| 4 | Calcul automatique des surfaces et périmètres (m²) |
| 4 | Masques : portes, fenêtres, murs, pièces, surface habitable |
| 5 | Résultats avec overlays visuels (5 vues) + export PDF |
| 6 | **Éditeur de masques** : ajouter/effacer rectangles et polygones |
| 6 | **Mode SAM** : segmentation automatique par clic |
| 6 | Recalcul des surfaces après édition |
| 6 | Export rapport PDF professionnel |

---

## Configuration

Cliquez sur **⚙️ Configuration API** dans l'interface pour modifier :
- URL du backend (défaut : `http://localhost:8000`)
- Clé API Roboflow
- Model ID (défaut : `cubicasa-xmyt3-d4s04/3`)
- Seuils de confiance (portes / fenêtres)
- Épaisseur des murs

---

## Installation manuelle des dépendances

```bash
pip install fastapi uvicorn[standard] numpy opencv-python-headless pillow \
            pymupdf pandas inference-sdk reportlab
```

---

## Dépannage

**"API hors ligne"** → Le serveur n'est pas démarré. Relancez `DEMARRER.bat`.

**"Erreur analyse"** → Vérifiez votre clé Roboflow et le model ID dans ⚙️ Configuration.

**Pas de détections** → Le modèle Roboflow n'est pas adapté au format du plan. Vérifiez que le modèle est entraîné sur des plans architecturaux.
