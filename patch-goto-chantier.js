#!/usr/bin/env node
/**
 * patch-goto-chantier.js
 * Ajoute le bouton "Suivi chantier" dans ResultsStep et EditorStep
 * pour naviguer vers le module chantier depuis l'AI Analysis.
 *
 * Usage: node patch-goto-chantier.js
 */

const fs = require("fs");
const path = require("path");

const FILES = {
  results: path.join(__dirname, "frontend/components/demo/results-step.tsx"),
  editor:  path.join(__dirname, "frontend/components/demo/editor-step.tsx"),
  demo:    path.join(__dirname, "frontend/app/demo/demo-client.tsx"),
};

for (const [k, f] of Object.entries(FILES)) {
  if (!fs.existsSync(f)) { console.error(`❌ Introuvable: ${f}`); process.exit(1); }
}

let results = fs.readFileSync(FILES.results, "utf8");
let editor  = fs.readFileSync(FILES.editor,  "utf8");
let demo    = fs.readFileSync(FILES.demo,    "utf8");
let applied = 0;

// ══════════════════════════════════════════
// PATCH 1 — results-step.tsx : import
// ══════════════════════════════════════════
const R_IMP_OLD = `import { Download, Edit3, RotateCcw, Loader2, Table2, Printer, Search, Ruler, FileDown, ChevronDown, ChevronRight, Eye, EyeOff, Layers, DoorOpen, AppWindow, Home, ArrowLeftRight, Wrench, PaintBucket } from "lucide-react";`;
const R_IMP_NEW = `import { Download, Edit3, RotateCcw, Loader2, Table2, Printer, Search, Ruler, FileDown, ChevronDown, ChevronRight, Eye, EyeOff, Layers, DoorOpen, AppWindow, Home, ArrowLeftRight, Wrench, PaintBucket, ClipboardList } from "lucide-react";`;
if (results.includes(R_IMP_OLD)) {
  results = results.replace(R_IMP_OLD, R_IMP_NEW);
  console.log("✅ results-step P1 — import ClipboardList");
  applied++;
} else { console.warn("⚠️  results-step P1 déjà appliqué"); }

// ══════════════════════════════════════════
// PATCH 2 — results-step.tsx : interface
// ══════════════════════════════════════════
const R_IFACE_OLD = `  onGoEditor: () => void;\n  onRestart: () => void;`;
const R_IFACE_NEW = `  onGoEditor: () => void;\n  onGoChantier?: () => void;\n  onRestart: () => void;`;
if (results.includes(R_IFACE_OLD) && !results.includes("onGoChantier")) {
  results = results.replace(R_IFACE_OLD, R_IFACE_NEW);
  console.log("✅ results-step P2 — interface onGoChantier");
  applied++;
} else { console.warn("⚠️  results-step P2 déjà appliqué"); }

// ══════════════════════════════════════════
// PATCH 3 — results-step.tsx : destructuration
// ══════════════════════════════════════════
const R_DEST_OLD = `export default function ResultsStep({ result, customDetections = [], onDetectionsChange, onGoEditor, onRestart,`;
const R_DEST_NEW = `export default function ResultsStep({ result, customDetections = [], onDetectionsChange, onGoEditor, onGoChantier, onRestart,`;
if (results.includes(R_DEST_OLD)) {
  results = results.replace(R_DEST_OLD, R_DEST_NEW);
  console.log("✅ results-step P3 — destructuration");
  applied++;
} else { console.warn("⚠️  results-step P3 déjà appliqué"); }

// ══════════════════════════════════════════
// PATCH 4 — results-step.tsx : bouton
// ══════════════════════════════════════════
const R_BTN_OLD = `          <Button onClick={onGoEditor}>
            <Edit3 className="w-4 h-4" /> {d("re_editor")}
          </Button>`;
const R_BTN_NEW = `          <Button onClick={onGoEditor}>
            <Edit3 className="w-4 h-4" /> {d("re_editor")}
          </Button>
          {onGoChantier && (
            <Button onClick={onGoChantier} variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10">
              <ClipboardList className="w-4 h-4" /> Suivi chantier
            </Button>
          )}`;
if (results.includes(R_BTN_OLD) && !results.includes("Suivi chantier")) {
  results = results.replace(R_BTN_OLD, R_BTN_NEW);
  console.log("✅ results-step P4 — bouton Suivi chantier");
  applied++;
} else { console.warn("⚠️  results-step P4 déjà appliqué"); }

// ══════════════════════════════════════════
// PATCH 5 — editor-step.tsx : interface + bouton Save
// ══════════════════════════════════════════
if (!editor.includes("onGoChantier")) {
  // Interface
  editor = editor.replace(
    `  onGoResults?: (updatedResult: AnalysisResult, detections?: CustomDetection[]) => void;`,
    `  onGoResults?: (updatedResult: AnalysisResult, detections?: CustomDetection[]) => void;\n  onGoChantier?: () => void;`
  );
  // Destructuration
  editor = editor.replace(
    `{ sessionId, initialResult, initialCustomDetections, onRestart, onSessionExpired, onAddPage, onGoResults }`,
    `{ sessionId, initialResult, initialCustomDetections, onRestart, onSessionExpired, onAddPage, onGoResults, onGoChantier }`
  );
  // Bouton après le bouton Save
  editor = editor.replace(
    `              <span className="hidden sm:inline ml-1">{d("ed_save_btn")}</span>
            </Button>
          )}`,
    `              <span className="hidden sm:inline ml-1">{d("ed_save_btn")}</span>
            </Button>
          )}
          {onGoChantier && (
            <Button size="sm" variant="outline" onClick={onGoChantier} className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10">
              <ClipboardList className="w-3.5 h-3.5" />
              <span className="hidden sm:inline ml-1">Chantier</span>
            </Button>
          )}`
  );
  // Import ClipboardList si pas déjà présent
  if (!editor.includes("ClipboardList")) {
    editor = editor.replace(
      `, PaintBucket,`,
      `, PaintBucket, ClipboardList,`
    );
  }
  console.log("✅ editor-step P5 — interface + bouton Chantier");
  applied++;
} else { console.warn("⚠️  editor-step P5 déjà appliqué"); }

// ══════════════════════════════════════════
// PATCH 6 — demo-client.tsx : handleGoChantier
// ══════════════════════════════════════════
if (!demo.includes("handleGoChantier")) {
  demo = demo.replace(
    `const handleGoResults=(updatedResult:AnalysisResult,detections?:CustomDetection[])=>{setAnalysisResult(updatedResult);if(detections)setCustomDetections(detections);setStep(6);};`,
    `const handleGoResults=(updatedResult:AnalysisResult,detections?:CustomDetection[])=>{setAnalysisResult(updatedResult);if(detections)setCustomDetections(detections);setStep(6);};\n  const handleGoChantier=()=>{setDemoMode("chantier");};`
  );
  console.log("✅ demo-client P6 — handleGoChantier");
  applied++;
} else { console.warn("⚠️  demo-client P6 déjà appliqué"); }

// ══════════════════════════════════════════
// PATCH 7 — demo-client.tsx : passer à ResultsStep
// ══════════════════════════════════════════
if (demo.includes("onGoEditor={handleGoEditor} onRestart={handleRestart}") && !demo.includes("onGoChantier={handleGoChantier}")) {
  demo = demo.replace(
    `onGoEditor={handleGoEditor} onRestart={handleRestart}`,
    `onGoEditor={handleGoEditor} onGoChantier={handleGoChantier} onRestart={handleRestart}`
  );
  console.log("✅ demo-client P7 — onGoChantier vers ResultsStep");
  applied++;
} else { console.warn("⚠️  demo-client P7 déjà appliqué"); }

// ══════════════════════════════════════════
// PATCH 8 — demo-client.tsx : passer à EditorStep
// ══════════════════════════════════════════
if (demo.includes("onGoResults={handleGoResults}/>") && !demo.includes("onGoChantier={handleGoChantier}/>")) {
  demo = demo.replace(
    `onGoResults={handleGoResults}/>`,
    `onGoResults={handleGoResults} onGoChantier={handleGoChantier}/>`
  );
  console.log("✅ demo-client P8 — onGoChantier vers EditorStep");
  applied++;
} else { console.warn("⚠️  demo-client P8 déjà appliqué"); }

// ── Écriture ──────────────────────────────
if (applied > 0) {
  fs.writeFileSync(FILES.results, results, "utf8");
  fs.writeFileSync(FILES.editor,  editor,  "utf8");
  fs.writeFileSync(FILES.demo,    demo,    "utf8");
  console.log(`\n🎉 ${applied} patch(s) appliqué(s).`);
  console.log("👉 git add frontend/components/demo/results-step.tsx frontend/components/demo/editor-step.tsx frontend/app/demo/demo-client.tsx");
  console.log("   git commit -m 'feat: bouton Suivi chantier depuis AI Analysis'");
  console.log("   git push");
} else {
  console.log("\n✅ Tout est déjà à jour.");
}
