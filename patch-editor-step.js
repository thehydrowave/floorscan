#!/usr/bin/env node
/**
 * patch-editor-step.js
 * Applique 3 modifications à editor-step.tsx pour ajouter le toggle Eye "Surfaces".
 * Usage : node patch-editor-step.js
 */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "frontend/components/demo/editor-step.tsx");

if (!fs.existsSync(FILE)) {
  console.error("❌ Fichier introuvable :", FILE);
  process.exit(1);
}

let content = fs.readFileSync(FILE, "utf8");
let changed = 0;

// ── PATCH 1 : Ajouter le state showSurfaces ──────────────────────────────────
const P1_OLD = `const [showFrenchDoors, setShowFrenchDoors] = useState(false);

  // Mask edit undo/redo lengths`;
const P1_NEW = `const [showFrenchDoors, setShowFrenchDoors] = useState(false);
  const [showSurfaces, setShowSurfaces] = useState(true);

  // Mask edit undo/redo lengths`;

if (content.includes(P1_OLD)) {
  content = content.replace(P1_OLD, P1_NEW);
  console.log("✅ PATCH 1 appliqué : state showSurfaces ajouté");
  changed++;
} else {
  console.warn("⚠️  PATCH 1 ignoré : séquence déjà modifiée ou introuvable");
}

// ── PATCH 2 : Conditionner le SVG zones sur showSurfaces ─────────────────────
const P2_OLD = `{/* ── Surface zones (carrelage, parquet, etc.) ── */}
              {zones.length > 0 && imgDisplaySize.w > 0 && (`;
const P2_NEW = `{/* ── Surface zones (carrelage, parquet, etc.) ── */}
              {showSurfaces && zones.length > 0 && imgDisplaySize.w > 0 && (`;

if (content.includes(P2_OLD)) {
  content = content.replace(P2_OLD, P2_NEW);
  console.log("✅ PATCH 2 appliqué : SVG zones conditionné à showSurfaces");
  changed++;
} else {
  console.warn("⚠️  PATCH 2 ignoré : séquence déjà modifiée ou introuvable");
}

// ── PATCH 3 : Ajouter le toggle Eye Surfaces dans le RESULTS TAB ─────────────
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
                      <button
                        onClick={() => setShowSurfaces(v => !v)}
                        className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors"
                        title={showSurfaces ? "Masquer les surfaces" : "Afficher les surfaces"}
                      >
                        {showSurfaces ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ROOMS TAB */}`;

if (content.includes(P3_OLD)) {
  content = content.replace(P3_OLD, P3_NEW);
  console.log("✅ PATCH 3 appliqué : toggle Eye Surfaces dans RESULTS TAB");
  changed++;
} else {
  console.warn("⚠️  PATCH 3 ignoré : séquence déjà modifiée ou introuvable");
}

if (changed > 0) {
  fs.writeFileSync(FILE, content, "utf8");
  console.log(`\n🎉 ${changed}/3 patches appliqués — editor-step.tsx mis à jour.`);
} else {
  console.log("\n⚠️  Aucun patch appliqué. Le fichier est peut-être déjà à jour.");
}
