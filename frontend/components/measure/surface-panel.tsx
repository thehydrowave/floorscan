"use client";

import { useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { SurfaceType, MeasureZone, aggregateByType } from "@/lib/measure-types";

const PRESET_COLORS = [
  "#3B82F6", "#F97316", "#8B5CF6", "#6B7280", "#EC4899",
  "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#84CC16",
];

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

  const totals = aggregateByType(zones, imageW, imageH, ppm);
  const totalAll = Object.values(totals).reduce((a, b) => a + b, 0);

  const addType = () => {
    if (!newName.trim()) return;
    const id = newName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    onTypesChange([...types, { id, name: newName.trim(), color: newColor }]);
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">Types de surface</h3>
        <button
          onClick={() => setAdding(v => !v)}
          className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
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
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{
                  background: c,
                  borderColor: newColor === c ? "white" : "transparent",
                  transform: newColor === c ? "scale(1.2)" : "scale(1)",
                }}
              />
            ))}
          </div>
          <button
            onClick={addType}
            disabled={!newName.trim()}
            className="flex items-center justify-center gap-1.5 bg-accent hover:bg-accent/80 disabled:opacity-40 text-white rounded-lg py-1.5 text-xs font-medium transition-colors"
          >
            <Check className="w-3.5 h-3.5" /> Ajouter
          </button>
        </div>
      )}

      {/* Type list */}
      <div className="flex flex-col gap-1.5">
        {types.map(type => {
          const area = totals[type.id] ?? 0;
          const isActive = activeTypeId === type.id;
          const zoneCount = zones.filter(z => z.typeId === type.id).length;

          return (
            <button
              key={type.id}
              onClick={() => onActiveTypeChange(type.id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all border ${
                isActive
                  ? "border-accent/40 bg-accent/10"
                  : "border-white/5 glass hover:border-white/15"
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: type.color }}
              />
              <span className={`text-sm font-medium flex-1 ${isActive ? "text-white" : "text-slate-300"}`}>
                {type.name}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                {zoneCount > 0
                  ? ppm
                    ? `${area.toFixed(2)} m²`
                    : `${zoneCount} zone${zoneCount > 1 ? "s" : ""}`
                  : "—"}
              </span>
              {!["carrelage","parquet","peinture","beton","moquette"].includes(type.id) && (
                <button
                  onClick={e => { e.stopPropagation(); removeType(type.id); }}
                  className="text-slate-600 hover:text-red-400 transition-colors ml-1"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </button>
          );
        })}
      </div>

      {/* Total */}
      {zones.length > 0 && (
        <div className="mt-2 pt-3 border-t border-white/5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Total mesuré</span>
            <span className="font-mono text-sm text-white font-600">
              {ppm ? `${totalAll.toFixed(2)} m²` : `${zones.length} zone${zones.length > 1 ? "s" : ""}`}
            </span>
          </div>
          {!ppm && (
            <p className="text-xs text-slate-600 mt-1">Définissez l'échelle pour voir les m²</p>
          )}
        </div>
      )}
    </div>
  );
}
