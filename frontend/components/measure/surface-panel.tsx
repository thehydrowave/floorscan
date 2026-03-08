"use client";

import { useState } from "react";
import { Plus, Trash2, Check, Package, Download } from "lucide-react";
import {
  SurfaceType, MeasureZone,
  aggregateByType, aggregatePerimeterByType,
} from "@/lib/measure-types";

const PRESET_COLORS = [
  "#3B82F6", "#F97316", "#8B5CF6", "#6B7280", "#EC4899",
  "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#84CC16",
];

const DEFAULT_IDS = ["carrelage", "parquet", "peinture", "beton", "moquette"];

interface SurfacePanelProps {
  types: SurfaceType[];
  zones: MeasureZone[];
  activeTypeId: string;
  imageW: number;
  imageH: number;
  ppm: number | null;
  onTypesChange: (types: SurfaceType[]) => void;
  onActiveTypeChange: (id: string) => void;
}

export default function SurfacePanel({
  types, zones, activeTypeId, imageW, imageH, ppm,
  onTypesChange, onActiveTypeChange,
}: SurfacePanelProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[5]);

  const totals    = aggregateByType(zones, imageW, imageH, ppm);
  const perims    = ppm ? aggregatePerimeterByType(zones, imageW, imageH, ppm) : {};
  const totalAll  = Object.values(totals).reduce((a, b) => a + b, 0);
  const totalHT   = ppm
    ? types.reduce((sum, t) => sum + (totals[t.id] ?? 0) * (t.pricePerM2 ?? 0), 0)
    : 0;
  const hasPrices = types.some(t => (t.pricePerM2 ?? 0) > 0);

  const addType = () => {
    if (!newName.trim()) return;
    const id = newName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    onTypesChange([...types, { id, name: newName.trim(), color: newColor, wastePercent: 10 }]);
    onActiveTypeChange(id);
    setNewName("");
    setAdding(false);
  };

  const removeType = (id: string) => {
    onTypesChange(types.filter(t => t.id !== id));
    if (activeTypeId === id && types.length > 1) {
      onActiveTypeChange(types.find(t => t.id !== id)!.id);
    }
  };

  const updatePrice    = (id: string, val: string) => {
    const v = parseFloat(val);
    onTypesChange(types.map(t =>
      t.id === id ? { ...t, pricePerM2: val === "" || isNaN(v) ? undefined : v } : t
    ));
  };
  const updateWaste    = (id: string, val: string) => {
    const v = parseFloat(val);
    onTypesChange(types.map(t =>
      t.id === id ? { ...t, wastePercent: val === "" || isNaN(v) ? undefined : Math.max(0, v) } : t
    ));
  };
  const updateBoxSize  = (id: string, val: string) => {
    const v = parseFloat(val);
    onTypesChange(types.map(t =>
      t.id === id ? { ...t, boxSizeM2: val === "" || isNaN(v) ? undefined : Math.max(0, v) } : t
    ));
  };
  const updateColor    = (id: string, color: string) => {
    onTypesChange(types.map(t => t.id === id ? { ...t, color } : t));
  };

  /** Export CSV du métré */
  const exportCSV = () => {
    const sep = ";";
    const headers = [
      "Type", "Surface nette (m²)", "Périmètre (ml)", "Chute (%)",
      "Qté à commander (m²)", "m²/boîte", "Boîtes", "Prix/m²", "Montant HT (€)",
    ];
    const rows: (string | number)[][] = types
      .filter(t => (totals[t.id] ?? 0) > 0 || zones.some(z => z.typeId === t.id))
      .map(type => {
        const area  = totals[type.id] ?? 0;
        const perim = perims[type.id] ?? 0;
        const waste = type.wastePercent ?? 10;
        const cmd   = area > 0 ? area * (1 + waste / 100) : 0;
        const boxes = type.boxSizeM2 && type.boxSizeM2 > 0 && cmd > 0
          ? Math.ceil(cmd / type.boxSizeM2) : "";
        const ht = ppm && area > 0 && (type.pricePerM2 ?? 0) > 0
          ? (area * type.pricePerM2!).toFixed(2) : "";
        return [
          type.name,
          ppm ? area.toFixed(2) : "",
          ppm ? perim.toFixed(2) : "",
          waste,
          ppm ? cmd.toFixed(2) : "",
          type.boxSizeM2 ?? "",
          boxes,
          type.pricePerM2 ?? "",
          ht,
        ];
      });

    const totalCmd = ppm
      ? types.reduce((s, t) => {
          const a = totals[t.id] ?? 0;
          return s + a * (1 + (t.wastePercent ?? 10) / 100);
        }, 0)
      : 0;

    const lines = [
      headers.join(sep),
      ...rows.map(r => r.join(sep)),
      "",
      ["TOTAL NET", ppm ? totalAll.toFixed(2) : "", "", "", ppm ? totalCmd.toFixed(2) : ""].join(sep),
      ...(hasPrices && ppm && totalHT > 0
        ? [["TOTAL HT", "", "", "", "", "", "", "", totalHT.toFixed(2)].join(sep)]
        : []),
    ];

    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `floorscan_metre_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">Types de surface</h3>
        <div className="flex items-center gap-1">
          {zones.length > 0 && (
            <button
              onClick={exportCSV}
              title="Exporter CSV"
              className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setAdding(v => !v)}
            className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Add type form */}
      {adding && (
        <div className="glass border border-white/10 rounded-xl p-3 flex flex-col gap-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addType(); if (e.key === "Escape") setAdding(false); }}
            placeholder="Nom du type..."
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                className="w-5 h-5 rounded-full border-2 transition-all"
                style={{ background: c, borderColor: newColor === c ? "white" : "transparent", transform: newColor === c ? "scale(1.2)" : "scale(1)" }}
              />
            ))}
            <label className="relative w-6 h-6 cursor-pointer" title="Couleur personnalisée">
              <span className="flex items-center justify-center w-6 h-6 rounded-full border-2 text-white text-xs font-bold"
                style={{ background: PRESET_COLORS.includes(newColor) ? "#374151" : newColor, borderColor: PRESET_COLORS.includes(newColor) ? "#6B7280" : "white" }}>
                +
              </span>
              <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
            </label>
          </div>
          <button onClick={addType} disabled={!newName.trim()}
            className="flex items-center justify-center gap-1.5 bg-accent hover:bg-accent/80 disabled:opacity-40 text-white rounded-lg py-1.5 text-xs font-medium transition-colors">
            <Check className="w-3.5 h-3.5" /> Ajouter
          </button>
        </div>
      )}

      {/* Type list */}
      <div className="flex flex-col gap-1.5">
        {types.map(type => {
          const area       = totals[type.id] ?? 0;
          const perimM     = perims[type.id] ?? 0;
          const isActive   = activeTypeId === type.id;
          const zoneCount  = zones.filter(z => z.typeId === type.id && !z.isDeduction).length;
          const waste      = type.wastePercent ?? 10;
          const areaCmd    = area > 0 ? area * (1 + waste / 100) : 0;
          const boxes      = type.boxSizeM2 && type.boxSizeM2 > 0 && areaCmd > 0
            ? Math.ceil(areaCmd / type.boxSizeM2) : null;
          const lineTotal  = ppm && area > 0 && (type.pricePerM2 ?? 0) > 0
            ? area * type.pricePerM2! : null;

          return (
            <div key={type.id}
              className={`rounded-xl border transition-all ${isActive ? "border-accent/40 bg-accent/10" : "border-white/5 glass"}`}>

              {/* Row 1 — nom + surface + périmètre */}
              <div onClick={() => onActiveTypeChange(type.id)}
                className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 cursor-pointer">
                <label className="relative w-3.5 h-3.5 shrink-0 cursor-pointer" title="Changer la couleur"
                  onClick={e => e.stopPropagation()}>
                  <span className="block w-3.5 h-3.5 rounded-full ring-1 ring-white/20 hover:ring-white/60 transition-all"
                    style={{ background: type.color }} />
                  <input type="color" value={type.color} onChange={e => updateColor(type.id, e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                </label>
                <span className={`text-sm font-medium flex-1 ${isActive ? "text-white" : "text-slate-300"}`}>
                  {type.name}
                </span>
                <div className="flex flex-col items-end gap-0">
                  <span className="text-xs text-slate-400 font-mono">
                    {zoneCount > 0
                      ? ppm ? `${area.toFixed(2)} m²` : `${zoneCount} zone${zoneCount > 1 ? "s" : ""}`
                      : "—"}
                  </span>
                  {ppm && perimM > 0 && (
                    <span className="text-[10px] text-slate-600 font-mono">{perimM.toFixed(1)} ml périm.</span>
                  )}
                </div>
                {!DEFAULT_IDS.includes(type.id) && (
                  <button onClick={e => { e.stopPropagation(); removeType(type.id); }}
                    className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Row 2 — prix + chute */}
              <div className="flex items-center gap-2 px-3 pb-1.5" onClick={e => e.stopPropagation()}>
                <span className="text-xs text-slate-600">€/m²</span>
                <input type="number" value={type.pricePerM2 ?? ""} onChange={e => updatePrice(type.id, e.target.value)}
                  placeholder="0" min={0} step={1}
                  className="w-16 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-accent" />
                <span className="text-xs text-slate-600 ml-1">Chute</span>
                <input type="number" value={type.wastePercent ?? 10} onChange={e => updateWaste(type.id, e.target.value)}
                  placeholder="10" min={0} max={100} step={1}
                  className="w-12 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-accent" />
                <span className="text-xs text-slate-600">%</span>
                {lineTotal !== null && (
                  <span className="ml-auto text-xs text-accent font-mono">
                    {lineTotal.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                  </span>
                )}
              </div>

              {/* Row 3 — boîte + quantité à commander */}
              {ppm && area > 0 && (
                <div className="flex items-center gap-2 px-3 pb-2" onClick={e => e.stopPropagation()}>
                  <Package className="w-3 h-3 text-slate-600 shrink-0" />
                  <input type="number" value={type.boxSizeM2 ?? ""} onChange={e => updateBoxSize(type.id, e.target.value)}
                    placeholder="m²/boîte" min={0} step={0.1}
                    className="w-20 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-accent" />
                  <span className="text-xs text-slate-600">m²/boîte</span>
                  <span className="ml-auto text-xs text-slate-400 font-mono">
                    {areaCmd.toFixed(2)} m²
                    {boxes !== null && <span className="text-amber-400 ml-1">→ {boxes} boîtes</span>}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Totaux */}
      {zones.length > 0 && (
        <div className="mt-2 pt-3 border-t border-white/5 flex flex-col gap-1">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Total net</span>
            <span className="font-mono text-sm text-white font-600">
              {ppm ? `${totalAll.toFixed(2)} m²` : `${zones.filter(z => !z.isDeduction).length} zone${zones.length > 1 ? "s" : ""}`}
            </span>
          </div>
          {ppm && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">À commander (avec chutes)</span>
              <span className="font-mono text-xs text-amber-400">
                {types.reduce((sum, t) => {
                  const a = totals[t.id] ?? 0;
                  return sum + a * (1 + (t.wastePercent ?? 10) / 100);
                }, 0).toFixed(2)} m²
              </span>
            </div>
          )}
          {hasPrices && ppm && totalHT > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Total HT</span>
              <span className="font-mono text-sm text-accent font-600">
                {totalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
              </span>
            </div>
          )}
          {!ppm && (
            <p className="text-xs text-slate-600 mt-1">Définissez l'échelle pour voir les m²</p>
          )}
          {/* Export CSV shortcut */}
          {zones.length > 0 && (
            <button
              onClick={exportCSV}
              className="mt-1 flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 glass border border-white/5 rounded-lg py-1.5 transition-colors"
            >
              <Download className="w-3 h-3" /> Exporter CSV
            </button>
          )}
        </div>
      )}
    </div>
  );
}
