"use client";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { AnalysisResult } from "@/lib/types";

export async function downloadMockPdfReport(
  result: AnalysisResult,
  filename = "floorscan_rapport.pdf"
) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28;
  const H = 841.89;

  // Fond blanc
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });

  // Header band
  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: rgb(0.055, 0.647, 0.914) });

  // Logo text
  page.drawText("FloorScan", { x: 40, y: H - 42, size: 22, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Rapport d'analyse", { x: 40, y: H - 60, size: 10, font, color: rgb(0.9, 0.97, 1) });

  // Date / session
  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  page.drawText(`Généré le ${dateStr}`, { x: W - 200, y: H - 42, size: 9, font, color: rgb(1, 1, 1) });
  page.drawText(`Réf. ${result.session_id.toUpperCase()}`, { x: W - 200, y: H - 56, size: 8, font, color: rgb(0.85, 0.95, 1) });

  let y = H - 100;
  const col1 = 40;
  const col2 = 300;

  const drawSection = (title: string) => {
    y -= 10;
    page.drawRectangle({ x: col1, y: y - 4, width: W - 80, height: 22, color: rgb(0.97, 0.99, 1) });
    page.drawText(title, { x: col1 + 8, y: y + 4, size: 11, font: fontBold, color: rgb(0.055, 0.647, 0.914) });
    y -= 18;
  };

  const drawRow = (label: string, value: string, bold = false, color: [number, number, number] = [0.18, 0.22, 0.3]) => {
    page.drawText(label, { x: col1 + 16, y, size: 10, font, color: rgb(0.39, 0.46, 0.54) });
    page.drawText(value, { x: col2, y, size: 10, font: bold ? fontBold : font, color: rgb(...color) });
    y -= 18;
  };

  // Section 1 : Éléments détectés
  drawSection("Éléments détectés");
  drawRow("Portes", `${result.doors_count}`, true, [0.73, 0.15, 0.15]);
  drawRow("Fenêtres", `${result.windows_count}`, true, [0.15, 0.4, 0.85]);

  y -= 8;

  // Section 2 : Surfaces
  drawSection("Surfaces habitables");
  const sf = result.surfaces ?? {};
  drawRow("Surface habitable", sf.area_hab_m2 ? `${sf.area_hab_m2.toFixed(1)} m²` : "—", true, [0.04, 0.62, 0.51]);
  drawRow("Emprise bâtiment", sf.area_building_m2 ? `${sf.area_building_m2.toFixed(1)} m²` : "—");
  drawRow("Surface murs", sf.area_walls_m2 ? `${sf.area_walls_m2.toFixed(1)} m²` : "—");
  drawRow("Pourtour habitable", sf.perim_interior_m ? `${sf.perim_interior_m.toFixed(1)} m` : "—");
  drawRow("Pourtour bâtiment", sf.perim_building_m ? `${sf.perim_building_m.toFixed(1)} m` : "—");
  if (result.pixels_per_meter) {
    drawRow("Échelle détectée", `${result.pixels_per_meter.toFixed(1)} px/m`);
  }

  y -= 8;

  // Section 3 : Détail ouvertures
  drawSection(`Détail des ouvertures (${result.openings?.length ?? 0})`);
  if (result.openings && result.openings.length > 0) {
    // Header
    page.drawText("Type", { x: col1 + 16, y, size: 9, font: fontBold, color: rgb(0.39, 0.46, 0.54) });
    page.drawText("Largeur", { x: col2, y, size: 9, font: fontBold, color: rgb(0.39, 0.46, 0.54) });
    page.drawText("Hauteur", { x: col2 + 80, y, size: 9, font: fontBold, color: rgb(0.39, 0.46, 0.54) });
    y -= 16;

    for (const [i, o] of result.openings.slice(0, 20).entries()) {
      if (y < 120) break;
      const typeLabel = o.class === "door" ? `Porte #${i + 1}` : `Fenêtre #${i + 1}`;
      const c: [number, number, number] = o.class === "door" ? [0.73, 0.15, 0.15] : [0.15, 0.4, 0.85];
      page.drawText(typeLabel, { x: col1 + 16, y, size: 9, font, color: rgb(...c) });
      page.drawText(o.length_m ? `${o.length_m.toFixed(2)} m` : "—", { x: col2, y, size: 9, font, color: rgb(0.18, 0.22, 0.3) });
      page.drawText(o.height_m ? `${o.height_m.toFixed(2)} m` : "—", { x: col2 + 80, y, size: 9, font, color: rgb(0.18, 0.22, 0.3) });
      y -= 16;
    }
  }

  // Footer
  page.drawRectangle({ x: 0, y: 0, width: W, height: 36, color: rgb(0.97, 0.99, 1) });
  page.drawText("FloorScan · Rapport généré automatiquement", { x: 40, y: 13, size: 8, font, color: rgb(0.6, 0.65, 0.72) });
  page.drawText(`Page 1/1`, { x: W - 70, y: 13, size: 8, font, color: rgb(0.6, 0.65, 0.72) });

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
