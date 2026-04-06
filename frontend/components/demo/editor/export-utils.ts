import type { AnalysisResult } from "@/lib/types";

interface SurfaceType { id: string; name: string; color: string; pricePerM2?: number; wastePercent?: number; }
interface LinearMeasure { id: string; p1: { x: number; y: number }; p2: { x: number; y: number }; distPx: number; }
interface Zone { typeId: string; polygon: Array<{ x: number; y: number }>; }

function aggregateByType(zones: Zone[], imgW: number, imgH: number, ppm: number | null): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const z of zones) {
    const pts = z.polygon;
    let areaPx = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      areaPx += (pts[i].x * imgW) * (pts[j].y * imgH) - (pts[j].x * imgW) * (pts[i].y * imgH);
    }
    areaPx = Math.abs(areaPx) / 2;
    const area = ppm ? areaPx / (ppm * ppm) : areaPx;
    totals[z.typeId] = (totals[z.typeId] ?? 0) + area;
  }
  return totals;
}

function aggregatePerimeterByType(zones: Zone[], imgW: number, imgH: number, ppm: number): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const z of zones) {
    const pts = z.polygon;
    let perim = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const dx = (pts[j].x - pts[i].x) * imgW;
      const dy = (pts[j].y - pts[i].y) * imgH;
      perim += Math.sqrt(dx * dx + dy * dy);
    }
    perim /= ppm;
    totals[z.typeId] = (totals[z.typeId] ?? 0) + perim;
  }
  return totals;
}

export function exportEditorXlsx(
  result: AnalysisResult,
  zones: Zone[],
  surfaceTypes: SurfaceType[],
  linearMeasures: LinearMeasure[],
  imageNatural: { w: number; h: number },
) {
  const XLSX = require("xlsx");
  const wb = XLSX.utils.book_new();
  const ppmVal = result.pixels_per_meter ?? null;
  const totals = imageNatural.w > 0 ? aggregateByType(zones, imageNatural.w, imageNatural.h, ppmVal) : {};
  const unit = ppmVal ? "m2" : "px2";

  // Sheet 1: Metre surfaces
  const data1: (string | number)[][] = [
    ["FloorScan -- Metre"],
    ["Date", new Date().toLocaleDateString("fr-FR")],
    [],
    ["Type de surface", `Surface (${unit})`],
    ...surfaceTypes.filter(t => (totals[t.id] ?? 0) > 0).map(t => [t.name, ppmVal ? +totals[t.id].toFixed(4) : Math.round(totals[t.id])]),
    [],
    ["TOTAL", ppmVal ? +Object.values(totals).reduce((a: number, b: number) => a + b, 0).toFixed(4) : Math.round(Object.values(totals).reduce((a: number, b: number) => a + b, 0))],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(data1);
  ws1["!cols"] = [{ wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Metre");

  // Sheet 2: Mesures lineaires
  if (linearMeasures.length > 0) {
    const data2: (string | number)[][] = [["#", "Distance (m)", "Distance (px)"]];
    linearMeasures.forEach((lm, i) => {
      const distM = ppmVal ? +(lm.distPx / ppmVal).toFixed(3) : 0;
      data2.push([i + 1, distM, Math.round(lm.distPx)]);
    });
    data2.push(["TOTAL", ppmVal ? +linearMeasures.reduce((s, lm) => s + lm.distPx / ppmVal!, 0).toFixed(3) : 0, Math.round(linearMeasures.reduce((s, lm) => s + lm.distPx, 0))]);
    const ws2 = XLSX.utils.aoa_to_sheet(data2);
    ws2["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Lineaires");
  }

  // Sheet 3: Pieces
  if (result.rooms && result.rooms.length > 0) {
    const data3: (string | number)[][] = [["Type", "Piece", "Surface (m2)", "Perimetre (m)", "Type de sol"]];
    result.rooms.forEach(r => data3.push([r.type, r.label_fr, r.area_m2 != null ? +r.area_m2.toFixed(2) : 0, r.perimeter_m != null ? +r.perimeter_m.toFixed(2) : 0, (r as any).surfaceTypeId ?? "-"]));
    const ws3 = XLSX.utils.aoa_to_sheet(data3);
    ws3["!cols"] = [{ wch: 15 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Pieces");
  }

  XLSX.writeFile(wb, `floorscan_metre_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function exportEditorMeasurePdf(
  result: AnalysisResult,
  zones: Zone[],
  surfaceTypes: SurfaceType[],
  imageNatural: { w: number; h: number },
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, M = 15;
  let y = M;
  const ppmVal = result.pixels_per_meter ?? null;
  const hex2rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
  ];

  // Header
  doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18); doc.setFont("helvetica", "bold"); doc.text("FloorScan", M, 12);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text("Metre & Devis de surfaces -- Analyse IA", M, 18);
  doc.text(new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }), W - M, 18, { align: "right" });
  y = 36;

  // AI results
  const sfData = result.surfaces ?? {};
  if (Object.values(sfData).some(v => v != null)) {
    doc.setTextColor(30, 41, 59); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("Resultats IA", M, y); y += 5;
    doc.setFont("helvetica", "normal");
    if (sfData.area_hab_m2) { doc.text(`Surface habitable : ${sfData.area_hab_m2.toFixed(1)} m2`, M, y); y += 4; }
    if (sfData.area_building_m2) { doc.text(`Emprise batiment : ${sfData.area_building_m2.toFixed(1)} m2`, M, y); y += 4; }
    if (sfData.area_walls_m2) { doc.text(`Surfaces murs : ${sfData.area_walls_m2.toFixed(1)} m2`, M, y); y += 4; }
    doc.text(`Portes : ${result.doors_count}   Fenetres : ${result.windows_count}`, M, y); y += 8;
    doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 6;
  }

  // Surface zones table
  if (zones.length > 0 && imageNatural.w > 0) {
    const totals = aggregateByType(zones, imageNatural.w, imageNatural.h, ppmVal);
    const perims = ppmVal ? aggregatePerimeterByType(zones, imageNatural.w, imageNatural.h, ppmVal) : {};
    const activeSurfaces = surfaceTypes.filter(t => (totals[t.id] ?? 0) > 0);
    const hasPrices = activeSurfaces.some(t => (t.pricePerM2 ?? 0) > 0);

    if (activeSurfaces.length > 0) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(30, 41, 59);
      doc.text("Zones de metre", M, y); y += 6;
      const cols = hasPrices && ppmVal ? [M, 70, 100, 120, 145, 170] : [M, 90, 130, 160];
      const headers = hasPrices && ppmVal ? ["Type", "Surface", "Perim.", "Chute", "Qte cmd", "Montant HT"] : ["Type", "Surface", "Perim.", "-"];
      doc.setFillColor(248, 250, 252); doc.rect(M, y - 4, W - 2 * M, 8, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
      headers.forEach((h, i) => doc.text(h, cols[i], y));
      y += 5; doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4;

      let totalHT = 0;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(30, 41, 59);
      for (const type of activeSurfaces) {
        const area = totals[type.id] ?? 0;
        const perim = perims[type.id] ?? 0;
        const waste = type.wastePercent ?? 10;
        const cmd = area * (1 + waste / 100);
        const lineHT = area * (type.pricePerM2 ?? 0);
        totalHT += lineHT;
        const [r, g, b] = hex2rgb(type.color);
        doc.setFillColor(r, g, b); doc.circle(cols[0] + 1.5, y - 1.5, 1.5, "F");
        doc.text(type.name, cols[0] + 5, y);
        doc.text(ppmVal ? `${area.toFixed(2)} m2` : "-", cols[1], y);
        if (hasPrices && ppmVal) {
          doc.text(perim > 0 ? `${perim.toFixed(1)} ml` : "-", cols[2], y);
          doc.text(`+${waste}%`, cols[3], y);
          doc.text(`${cmd.toFixed(2)} m2`, cols[4], y);
          doc.text(lineHT > 0 ? `${lineHT.toFixed(2)} EUR` : "-", cols[5], y);
        } else if (ppmVal) {
          doc.text(perim > 0 ? `${perim.toFixed(1)} ml` : "-", cols[2], y);
        }
        y += 5;
        if (y > 265) { doc.addPage(); y = M; }
      }

      if (hasPrices && totalHT > 0) {
        doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4;
        doc.setFont("helvetica", "bold"); doc.setFontSize(9);
        doc.text("Total HT", W - M - 50, y);
        doc.text(`${totalHT.toFixed(2)} EUR`, W - M, y, { align: "right" });
      }
    }
  }

  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
  doc.text("Genere par FloorScan", W / 2, 292, { align: "center" });
  doc.save(`floorscan_metre_${new Date().toISOString().slice(0, 10)}.pdf`);
}
