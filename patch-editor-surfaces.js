#!/usr/bin/env node
/**
 * patch-editor-surfaces.js
 * Applique le toggle Eye "Surfaces" dans editor-step.tsx
 * Usage: node patch-editor-surfaces.js
 */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "frontend/components/demo/editor-step.tsx");

if (!fs.existsSync(FILE)) {
  console.error("❌ Fichier introuvable:", FILE);
  process.exit(1);
}

let content = fs.readFileSync(FILE, "utf8");
let applied = 0;

// PATCH 1 — state showSurfaces
const P1_OLD = `const [showFrenchDoors, setShowFrenchDoors] = useState(false);

  // Mask edit undo/redo lengths`;
const P1_NEW = `const [showFrenchDoors, setShowFrenchDoors] = useState(false);
  const [showSurfaces, setShowSurfaces] = useState(true);

  // Mask edit undo/redo lengths`;
if (content.includes(P1_OLD)) {
  content = content.replace(P1_OLD, P1_NEW);
  console.log("✅ PATCH 1 — state showSurfaces");
  applied++;
} else { console.warn("⚠️  PATCH 1 déjà appliqué ou introuvable"); }

// PATCH 2 — conditionner le SVG zones
const P2_OLD = `{/* ── Surface zones (carrelage, parquet, etc.) ── */}
              {zones.length > 0 && imgDisplaySize.w > 0 && (`;
const P2_NEW = `{/* ── Surface zones (carrelage, parquet, etc.) ── */}
              {showSurfaces && zones.length > 0 && imgDisplaySize.w > 0 && (`;
if (content.includes(P2_OLD)) {
  content = content.replace(P2_OLD, P2_NEW);
  console.log("✅ PATCH 2 — SVG zones conditionné à showSurfaces");
  applied++;
} else { console.warn("⚠️  PATCH 2 déjà appliqué ou introuvable"); }

// PATCH 3 — toggle Eye dans le RESULTS TAB
const P3_OLD = `                </>
              )}

              {/* ROOMS TAB */}`;
const P3_NEW = `                  {zones.length > 0 && (
                    <div className="glass rounded-xl border border-white/10 p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <PaintBucket className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-xs font-600 text-slate-400 uppercase tracking-wide">Surfaces</span>
                        <span className="text-[10px] font-mono text-violet-400">{zones.filter(z => z.typeId !== "__count__").length} zones</span>
                      </div>
                      <button onClick={() => setShowSurfaces(v => !v)}
                        className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors">
                        {showSurfaces ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ROOMS TAB */}`;
if (content.includes(P3_OLD)) {
  content = content.replace(P3_OLD, P3_NEW);
  console.log("✅ PATCH 3 — toggle Eye Surfaces dans sidebar");
  applied++;
} else { console.warn("⚠️  PATCH 3 déjà appliqué ou introuvable"); }

// PATCH 4 — passer zones dans onGoResults
const P4_OLD = `onGoResults(result, customDetections);`;
const P4_NEW = `onGoResults({ ...result, _measurements: { zones, surfaceTypes } }, customDetections);`;
if (content.includes(P4_OLD)) {
  content = content.replace(P4_OLD, P4_NEW);
  console.log("✅ PATCH 4 — zones passées dans onGoResults");
  applied++;
} else { console.warn("⚠️  PATCH 4 déjà appliqué ou introuvable"); }

if (applied > 0) {
  fs.writeFileSync(FILE, content, "utf8");
  console.log(`\n🎉 ${applied} patch(s) appliqué(s) — editor-step.tsx mis à jour.`);
  console.log("👉 git add frontend/components/demo/editor-step.tsx && git commit -m 'feat: surface visibility toggle in editor' && git push");
} else {
  console.log("\n✅ Tout est déjà à jour, rien à faire.");
}
