import type { FacadeAnalysisResult, FacadeElement } from "./types";
import { polygonAreaPx } from "./measure-types";

/* ── Custom type (mirrors facade-editor-step) ── */
export interface CustomType { id: string; name: string; color: string; replacesWall: boolean; }

/* ── Retour line data per element ── */
export interface RetourLine {
  e: FacadeElement;
  w: number | null; h: number | null;
  lonLinteau: number | null; lonAppui: number | null; lonTableau: number | null;
  surfLinteau: number | null; surfAppui: number | null; surfTableau: number | null;
  totalRetour: number | null;
}

/* ── Full export data ── */
export interface ExportData {
  retourLines: RetourLine[];
  totLonT: number; totLonL: number; totLonA: number;
  totSurfT: number; totSurfL: number; totSurfA: number; totSurfRetours: number;
  pxITE: number; pxRetour: number; pxEchaf: number;
  cITE: number; cRet: number; cEch: number; cTotal: number;
  epT: number; epL: number; epA: number;
}

/* ── Compute retour + financial data from elements ── */
export function computeExportData(
  elements: FacadeElement[],
  ppm: number | undefined | null,
  imgNat: { w: number; h: number },
  netFacadeArea: number,
  facadeArea: number,
): ExportData {
  const epT = 0.14, epL = 0.14, epA = 0.14;
  const openings = elements.filter(e => !["floor_line", "roof", "column", "wall_opaque"].includes(e.type));
  const retourLines: RetourLine[] = openings.map(e => {
    const w = e.w_m ?? (ppm && imgNat.w > 0 ? (e.bbox_norm.w * imgNat.w / ppm) : null);
    const h = e.h_m ?? (ppm && imgNat.h > 0 ? (e.bbox_norm.h * imgNat.h / ppm) : null);
    const lonLinteau = w, lonAppui = w, lonTableau = h != null ? h * 2 : null;
    const surfLinteau = lonLinteau != null ? lonLinteau * epL : null;
    const surfAppui = lonAppui != null ? lonAppui * epA : null;
    const surfTableau = lonTableau != null ? lonTableau * epT : null;
    const totalRetour = surfLinteau != null && surfAppui != null && surfTableau != null
      ? surfLinteau + surfAppui + surfTableau : null;
    return { e, w, h, lonLinteau, lonAppui, lonTableau, surfLinteau, surfAppui, surfTableau, totalRetour };
  });
  const totLonT = retourLines.reduce((s, l) => s + (l.lonTableau ?? 0), 0);
  const totLonL = retourLines.reduce((s, l) => s + (l.lonLinteau ?? 0), 0);
  const totLonA = retourLines.reduce((s, l) => s + (l.lonAppui ?? 0), 0);
  const totSurfT = retourLines.reduce((s, l) => s + (l.surfTableau ?? 0), 0);
  const totSurfL = retourLines.reduce((s, l) => s + (l.surfLinteau ?? 0), 0);
  const totSurfA = retourLines.reduce((s, l) => s + (l.surfAppui ?? 0), 0);
  const totSurfRetours = totSurfT + totSurfL + totSurfA;
  const pxITE = 120, pxRetour = 45, pxEchaf = 25;
  const cITE = netFacadeArea * pxITE;
  const cRet = (totLonT + totLonL + totLonA) * pxRetour;
  const cEch = facadeArea * pxEchaf;
  return { retourLines, totLonT, totLonL, totLonA, totSurfT, totSurfL, totSurfA, totSurfRetours, pxITE, pxRetour, pxEchaf, cITE, cRet, cEch, cTotal: cITE + cRet + cEch, epT, epL, epA };
}

/* ── CSV export ── */
export function exportFacadeCSV(
  data: ExportData,
  getTypeLabel: (t: string) => string,
) {
  const BOM = "\uFEFF";
  const header = "ID;Type;Etage;Surface (m2);Perimetre (m);Largeur (m);Hauteur (m);Linteau (ml);Appui (ml);Tableau (ml);Surf. linteau (m2);Surf. appui (m2);Surf. tableau (m2);Total retours (m2)";
  const rows = data.retourLines.map(l =>
    `${l.e.id};${getTypeLabel(l.e.type)};${l.e.floor_level ?? 0};${l.e.area_m2?.toFixed(3) ?? "-"};${l.e.perimeter_m?.toFixed(3) ?? "-"};${l.w?.toFixed(3) ?? "-"};${l.h?.toFixed(3) ?? "-"};${l.lonLinteau?.toFixed(3) ?? "-"};${l.lonAppui?.toFixed(3) ?? "-"};${l.lonTableau?.toFixed(3) ?? "-"};${l.surfLinteau?.toFixed(4) ?? "-"};${l.surfAppui?.toFixed(4) ?? "-"};${l.surfTableau?.toFixed(4) ?? "-"};${l.totalRetour?.toFixed(4) ?? "-"}`
  );
  const csv = BOM + [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "facade_elements.csv"; a.click();
  URL.revokeObjectURL(url);
}

/* ── XLSX export ── */
export async function exportFacadeXLSX(
  data: ExportData,
  stats: { windowsCount: number; windowsArea: number; windowsPerimeter: number; netFacadeArea: number; facadeArea: number; floorsCount?: number | null },
  elements: FacadeElement[],
  customTypes: CustomType[],
  getTypeLabel: (t: string) => string,
) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const d = data;

  const summary: any[][] = [
    ["RAPPORT ANALYSE FACADE"], ["Date", new Date().toLocaleDateString("fr-FR")], [],
    ["=== SURFACES ==="],
    ["Fenetres (nombre)", stats.windowsCount],
    ["Fenetres surface (m2)", Number(stats.windowsArea.toFixed(2))],
    ["Perimetre fenetres (m)", Number(stats.windowsPerimeter.toFixed(2))],
    ["Surface nette mur (m2)", Number(stats.netFacadeArea.toFixed(2))],
    ["Surface facade (m2)", Number(stats.facadeArea.toFixed(2))],
    ["Etages detectes", stats.floorsCount ?? "-"],
    [],
    ["=== RETOURS DE TABLEAU ==="],
    ["Epaisseur (cm)", d.epT * 100],
    ["", "Tableau (ml)", "Linteau (ml)", "Appui (ml)", "Total (ml)"],
    ["Lineaires", Number(d.totLonT.toFixed(2)), Number(d.totLonL.toFixed(2)), Number(d.totLonA.toFixed(2)), Number((d.totLonT + d.totLonL + d.totLonA).toFixed(2))],
    ["", "Tableau (m2)", "Linteau (m2)", "Appui (m2)", "Total (m2)"],
    ["Surfaces retours", Number(d.totSurfT.toFixed(2)), Number(d.totSurfL.toFixed(2)), Number(d.totSurfA.toFixed(2)), Number(d.totSurfRetours.toFixed(2))],
    [],
    ["=== ESTIMATIONS FINANCIERES ==="],
    ["Poste", "Quantite", "Prix unit.", "Montant HT"],
    ["ITE mur opaque", `${stats.netFacadeArea.toFixed(1)} m2`, `${d.pxITE} EUR/m2`, `${d.cITE.toFixed(0)} EUR`],
    ["Retours linteau", `${d.totLonL.toFixed(1)} ml`, `${d.pxRetour} EUR/ml`, `${(d.totLonL * d.pxRetour).toFixed(0)} EUR`],
    ["Retours appui", `${d.totLonA.toFixed(1)} ml`, `${d.pxRetour} EUR/ml`, `${(d.totLonA * d.pxRetour).toFixed(0)} EUR`],
    ["Retours tableau", `${d.totLonT.toFixed(1)} ml`, `${d.pxRetour} EUR/ml`, `${(d.totLonT * d.pxRetour).toFixed(0)} EUR`],
    ["Echafaudage", `${stats.facadeArea.toFixed(1)} m2`, `${d.pxEchaf} EUR/m2`, `${d.cEch.toFixed(0)} EUR`],
    [], ["TOTAL ESTIME HT", "", "", `${d.cTotal.toFixed(0)} EUR`],
  ];
  for (const ct of customTypes) {
    const ctEls = elements.filter(e => e.type === ct.id);
    if (ctEls.length > 0) {
      const ctArea = ctEls.reduce((s, e) => s + (e.area_m2 ?? 0), 0);
      summary.push([], [`Type "${ct.name}"`, ctEls.length, `${ctArea.toFixed(2)} m2`, ct.replacesWall ? "(remplace mur)" : ""]);
    }
  }
  const ws1 = XLSX.utils.aoa_to_sheet(summary);
  ws1["!cols"] = [{ wch: 28 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Resume");

  const hdr = ["ID", "Type", "Etage", "Surface (m2)", "Perimetre (m)", "L (m)", "H (m)", "Linteau (ml)", "Appui (ml)", "Tableau (ml)", "Surf linteau", "Surf appui", "Surf tableau", "Total retours"];
  const rows = d.retourLines.map(l => [
    l.e.id, getTypeLabel(l.e.type), l.e.floor_level ?? 0,
    l.e.area_m2 != null ? Number(l.e.area_m2.toFixed(3)) : "",
    l.e.perimeter_m != null ? Number(l.e.perimeter_m.toFixed(3)) : "",
    l.w != null ? Number(l.w.toFixed(3)) : "", l.h != null ? Number(l.h.toFixed(3)) : "",
    l.lonLinteau != null ? Number(l.lonLinteau.toFixed(3)) : "", l.lonAppui != null ? Number(l.lonAppui.toFixed(3)) : "",
    l.lonTableau != null ? Number(l.lonTableau.toFixed(3)) : "",
    l.surfLinteau != null ? Number(l.surfLinteau.toFixed(4)) : "", l.surfAppui != null ? Number(l.surfAppui.toFixed(4)) : "",
    l.surfTableau != null ? Number(l.surfTableau.toFixed(4)) : "", l.totalRetour != null ? Number(l.totalRetour.toFixed(4)) : "",
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([hdr, ...rows]);
  ws2["!cols"] = hdr.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws2, "Elements");

  const fHdr = ["Poste", "Quantite", "Unite", "Prix unit. (EUR)", "Montant HT (EUR)"];
  const fRows: any[][] = [
    ["ITE mur opaque", Number(stats.netFacadeArea.toFixed(2)), "m2", d.pxITE, Number(d.cITE.toFixed(0))],
    ["Retours linteau", Number(d.totLonL.toFixed(2)), "ml", d.pxRetour, Number((d.totLonL * d.pxRetour).toFixed(0))],
    ["Retours appui", Number(d.totLonA.toFixed(2)), "ml", d.pxRetour, Number((d.totLonA * d.pxRetour).toFixed(0))],
    ["Retours tableau", Number(d.totLonT.toFixed(2)), "ml", d.pxRetour, Number((d.totLonT * d.pxRetour).toFixed(0))],
    ["Echafaudage", Number(stats.facadeArea.toFixed(2)), "m2", d.pxEchaf, Number(d.cEch.toFixed(0))],
    [], ["TOTAL HT", "", "", "", Number(d.cTotal.toFixed(0))],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet([fHdr, ...fRows]);
  ws3["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Estimations");

  XLSX.writeFile(wb, "rapport_facade.xlsx");
}
