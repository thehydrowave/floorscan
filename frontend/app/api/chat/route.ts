import { NextRequest } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

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

  // Échelle
  if (data.pixels_per_meter) {
    lines.push(`\n## Échelle : ${data.pixels_per_meter} px/m`);
  }

  return lines.join("\n");
}

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
  let fullSystem: string;

  if (isAnalysis) {
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
