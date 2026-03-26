import { NextRequest } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

// ─── Build facade context string from FacadeAnalysisResult ──────────────────

function buildFacadeContext(data: any): string {
  const lines: string[] = [];

  lines.push("## Analyse de façade");
  lines.push(`- Fenêtres : ${data.windows_count ?? 0}`);
  lines.push(`- Portes : ${data.doors_count ?? 0}`);
  lines.push(`- Balcons : ${data.balconies_count ?? 0}`);
  lines.push(`- Niveaux / étages : ${data.floors_count ?? 0}`);

  if (data.facade_area_m2 != null) lines.push(`- Surface façade totale : ${data.facade_area_m2.toFixed(1)} m²`);
  if (data.openings_area_m2 != null) lines.push(`- Surface ouvertures : ${data.openings_area_m2.toFixed(1)} m²`);
  if (data.ratio_openings != null) lines.push(`- Ratio vitrage : ${(data.ratio_openings * 100).toFixed(1)}%`);
  if (data.pixels_per_meter != null) lines.push(`- Échelle : ${data.pixels_per_meter} px/m`);

  // Wall area
  if (data.facade_area_m2 != null && data.openings_area_m2 != null) {
    const wall = data.facade_area_m2 - data.openings_area_m2;
    lines.push(`- Surface murale nette : ${wall.toFixed(1)} m²`);
  }

  // Per-floor breakdown
  if (data.elements?.length) {
    lines.push("\n## Détail par étage");
    const floors: Record<number, { windows: number; doors: number; balconies: number }> = {};
    for (const el of data.elements) {
      const lvl = el.floor_level ?? 0;
      if (!floors[lvl]) floors[lvl] = { windows: 0, doors: 0, balconies: 0 };
      if (el.type === "window") floors[lvl].windows++;
      else if (el.type === "door") floors[lvl].doors++;
      else if (el.type === "balcony") floors[lvl].balconies++;
    }
    for (const [lvl, counts] of Object.entries(floors).sort((a, b) => Number(b[0]) - Number(a[0]))) {
      const label = Number(lvl) === 0 ? "RDC" : `Étage ${lvl}`;
      lines.push(`- ${label} : ${counts.windows} fenêtres, ${counts.doors} portes, ${counts.balconies} balcons`);
    }

    // Area summary per type
    lines.push("\n## Surfaces par type");
    const areas: Record<string, number> = {};
    for (const el of data.elements) {
      if (el.area_m2) areas[el.type] = (areas[el.type] ?? 0) + el.area_m2;
    }
    for (const [type, area] of Object.entries(areas)) {
      lines.push(`- ${type} : ${(area as number).toFixed(2)} m²`);
    }
  }

  return lines.join("\n");
}

// ─── Build context string from AnalysisResult ───────────────────────────────

function buildContext(data: any): string {
  const lines: string[] = [];

  // Surfaces globales
  const s = data.surfaces ?? {};
  lines.push("## Surfaces globales");
  if (s.area_building_m2) lines.push(`- Surface bâtie : ${s.area_building_m2} m²`);
  if (s.area_hab_m2) lines.push(`- Surface habitable : ${s.area_hab_m2} m²`);
  if (s.area_walls_m2) lines.push(`- Surface murs : ${s.area_walls_m2} m²`);
  if (s.perim_building_m) lines.push(`- Périmètre extérieur : ${s.perim_building_m} m`);
  if (s.perim_interior_m) lines.push(`- Périmètre intérieur : ${s.perim_interior_m} m`);

  // Ouvertures
  lines.push(`\n## Ouvertures`);
  lines.push(`- Portes : ${data.doors_count ?? 0}`);
  lines.push(`- Fenêtres : ${data.windows_count ?? 0}`);
  if (data.openings?.length) {
    for (const o of data.openings) {
      const dims = o.length_m ? ` (${o.length_m}×${o.height_m ?? "?"}m)` : "";
      lines.push(`  - ${o.class}${dims}`);
    }
  }

  // Pièces
  if (data.rooms?.length) {
    lines.push(`\n## Pièces (${data.rooms.length})`);
    let totalArea = 0;
    for (const r of data.rooms) {
      const area = r.area_m2 != null ? `${r.area_m2} m²` : "surface inconnue";
      const perim = r.perimeter_m ? `, périmètre ${r.perimeter_m} m` : "";
      lines.push(`- ${r.label_fr} (${r.type}) : ${area}${perim}`);
      if (r.area_m2) totalArea += r.area_m2;
    }
    lines.push(`- **Total pièces** : ${totalArea.toFixed(1)} m²`);
  }

  // DPGF si fourni
  if (data.dpgf) {
    lines.push(`\n## Chiffrage DPGF`);
    for (const lot of data.dpgf.lots ?? []) {
      lines.push(`### Lot ${lot.lot_number} — ${lot.title_key}`);
      for (const item of lot.items ?? []) {
        lines.push(`  - ${item.description_key} : ${item.quantity} ${item.unit} × ${item.unit_price}€ = ${item.total_ht}€ HT`);
      }
      lines.push(`  **Sous-total** : ${lot.subtotal_ht}€ HT`);
    }
    lines.push(`\n**Total HT** : ${data.dpgf.total_ht}€`);
    lines.push(`**TVA** (${data.dpgf.tva_rate}%) : ${data.dpgf.tva_amount}€`);
    lines.push(`**Total TTC** : ${data.dpgf.total_ttc}€`);
  }

  // Conformité si fourni
  if (data.compliance?.length) {
    lines.push(`\n## Conformité réglementaire`);
    for (const c of data.compliance) {
      const icon = c.status === "pass" ? "✅" : c.status === "fail" ? "❌" : "⚠️";
      lines.push(`${icon} ${c.label} : ${c.detail ?? c.status}`);
    }
  }

  // Surfaces par type de revêtement
  if (data.surface_zones?.length) {
    lines.push(`\n## Surfaces par type de revêtement`);
    for (const s of data.surface_zones) {
      lines.push(`- ${s.typeName} : ${s.totalArea?.toFixed(2) ?? "?"} m² (${s.zoneCount} zones)`);
    }
  }

  // Mesures linéaires
  if (data.linear_measurements?.length) {
    lines.push(`\n## Mesures linéaires (${data.linear_measurements.length})`);
    data.linear_measurements.forEach((lm: any, i: number) => {
      lines.push(`- Mesure ${i + 1} : ${lm.distanceM?.toFixed(2) ?? "?"} m`);
    });
  }

  // Mesures d'angles
  if (data.angle_measurements?.length) {
    lines.push(`\n## Mesures d'angles (${data.angle_measurements.length})`);
    data.angle_measurements.forEach((am: any, i: number) => {
      lines.push(`- Angle ${i + 1} : ${am.angleDeg?.toFixed(1) ?? "?"}°`);
    });
  }

  // Comptages par catégorie
  if (data.count_annotations?.length) {
    lines.push(`\n## Comptages`);
    for (const c of data.count_annotations) {
      lines.push(`- ${c.name} : ${c.count}`);
    }
  }

  // Détections personnalisées (visual search)
  if (data.custom_detections?.length) {
    lines.push(`\n## Détections personnalisées`);
    for (const det of data.custom_detections) {
      lines.push(`- ${det.label} : ${det.count}${det.area_m2 != null ? ` (${det.area_m2.toFixed(2)} m²)` : ""}`);
    }
  }

  // Échelle
  if (data.pixels_per_meter) {
    lines.push(`\n## Échelle : ${data.pixels_per_meter} px/m`);
  }

  return lines.join("\n");
}

const FACADE_SYSTEM_PROMPT = `Tu es l'assistant IA de FloorScan, spécialisé dans l'analyse de façades de bâtiments.
Tu as accès aux données complètes d'une façade analysée (fenêtres, portes, balcons, étages, surfaces, ratios).

Règles :
- Réponds TOUJOURS en français, sauf si l'utilisateur parle dans une autre langue
- Sois précis avec les chiffres : cite les valeurs exactes de l'analyse
- Formate tes réponses en markdown clair (listes, gras, tableaux si utile)
- Tu es expert en façades, ravalement, menuiseries extérieures, isolation thermique (ITE/RE2020)
- Pour les travaux, cite les prix au m² habituels du marché (peinture façade : 20-40€/m², ITE : 100-200€/m²)
- Si une donnée n'est pas disponible, dis-le clairement
- Sois concis mais complet — maximum 300 mots par réponse
- Règlementation : ratio vitrage recommandé 15-25% pour résidentiel (RE2020)`;

const ANALYSIS_SYSTEM_PROMPT = `Tu es l'assistant IA de FloorScan, un outil d'analyse de plans architecturaux.
Tu as accès aux données complètes d'un plan analysé (pièces, surfaces, ouvertures, chiffrage DPGF, conformité).

Règles :
- Réponds TOUJOURS en français, sauf si l'utilisateur parle dans une autre langue
- Sois précis avec les chiffres : cite les valeurs exactes du plan
- Formate tes réponses en markdown clair (listes, gras, tableaux si utile)
- Si on te demande un calcul (prix, surface, quantité), montre le détail du calcul
- Si une donnée n'est pas disponible dans le contexte, dis-le clairement
- Sois concis mais complet — maximum 300 mots par réponse
- Tu peux suggérer des optimisations ou signaler des anomalies si pertinent
- Tu es un expert BTP/architecture, utilise le vocabulaire métier approprié`;

const HELP_SYSTEM_PROMPT = `Tu es l'assistant IA de FloorScan, une application web d'analyse de plans architecturaux.
Tu aides les utilisateurs à comprendre et utiliser l'application.

Voici les fonctionnalités de FloorScan :
1. **Import** : Upload d'images (JPG, PNG) ou de fichiers PDF. Les PDF multi-pages sont supportés.
2. **Recadrage** : Permet de recadrer le plan pour ne garder que la zone utile.
3. **Calibration d'échelle** : Mode automatique (détecte l'échelle sur le plan) ou mode manuel (l'utilisateur trace une ligne de référence connue).
4. **Analyse IA** : Détection automatique par intelligence artificielle des murs, portes, fenêtres, portes-fenêtres, et pièces du plan.
5. **Résultats** : Affichage des surfaces (habitable, bâtie, murs), des pièces détectées avec leurs dimensions, des ouvertures, et des overlays de masques.
6. **Éditeur** : Permet de corriger les masques de détection (murs, portes, fenêtres, portes-fenêtres, cloisons, intérieur) en dessinant ou en utilisant l'outil SAM (segmentation assistée).
7. **Outils avancés** : DPGF (chiffrage), conformité PMR, export PDF/CSV, mesures manuelles, rapport pro, scénarios de rénovation.

Règles :
- Réponds TOUJOURS en français, sauf si l'utilisateur parle dans une autre langue
- Sois concis et pratique — guide l'utilisateur étape par étape
- Formate tes réponses en markdown clair
- Maximum 200 mots par réponse
- Si tu ne sais pas, dis-le honnêtement
- Sois amical et encourageant`;

const STEP_NAMES: Record<number, string> = {
  1: "Connexion (admin)",
  2: "Upload / Import",
  3: "Recadrage",
  4: "Calibration d'échelle",
  5: "Analyse IA",
  6: "Résultats",
  7: "Éditeur de masques",
};

// ─── POST /api/chat ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, analysisContext, mode, currentStep } = body;

  if (!messages?.length) {
    return new Response(JSON.stringify({ error: "No messages provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return new Response(
      JSON.stringify({ error: "No OpenAI API key configured. Set OPENAI_API_KEY in Vercel env vars." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build system prompt based on mode
  const isAnalysis = mode === "analysis" && analysisContext;
  const isFacade = mode === "facade" && analysisContext;
  let fullSystem: string;

  if (isFacade) {
    const contextStr = buildFacadeContext(analysisContext);
    fullSystem = `${FACADE_SYSTEM_PROMPT}\n\n--- DONNÉES DE LA FAÇADE ANALYSÉE ---\n${contextStr}`;
  } else if (isAnalysis) {
    const contextStr = buildContext(analysisContext);
    fullSystem = `${ANALYSIS_SYSTEM_PROMPT}\n\n--- DONNÉES DU PLAN ANALYSÉ ---\n${contextStr}`;
  } else {
    const stepInfo = currentStep ? `\nL'utilisateur est actuellement à l'étape : ${STEP_NAMES[currentStep] ?? `Étape ${currentStep}`}.` : "";
    fullSystem = `${HELP_SYSTEM_PROMPT}${stepInfo}`;
  }

  try {
    const result = streamText({
      model: createOpenAI({ apiKey: key })("gpt-4o-mini"),
      system: fullSystem,
      messages,
    });

    return result.toTextStreamResponse();
  } catch (err: any) {
    console.error("[chat] Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message ?? "LLM error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
