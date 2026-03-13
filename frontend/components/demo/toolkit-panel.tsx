"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wrench, ChevronDown, ChevronUp, Grid3X3, Paintbrush, Footprints,
  Thermometer, Zap, Ruler, Scale3D as ScaleIcon, Receipt, TrendingUp,
  PieChart, Plus, Trash2, ArrowRightLeft, Sparkles,
} from "lucide-react";
import { AnalysisResult, Room } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import {
  calcTiles, TileInput, TileLayout,
  calcPaint, PaintInput,
  calcStaircase, StairInput,
  calcThermal, WallLayer, COMMON_MATERIALS,
  calcElectrical, ElecRoomInput, RoomType,
  convertUnit, getUnitsForCategory, UnitCategory,
  scaleToReal, realToScale, COMMON_SCALES,
  calcVat, BTP_VAT_RATES,
  calcRenoBudget, RenoLevel, RENO_LEVELS, REGION_COEFFS,
  calcBudgetBreakdown, LOT_PERCENTAGES,
} from "@/lib/toolkit-calculators";

// ── Props ──────────────────────────────────────────────────────────────────────

interface ToolkitPanelProps {
  result: AnalysisResult;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtN = (v: number, d = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: d });
const fmtEur = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";

const TABS = [
  { id: "tile",    icon: Grid3X3,     key: "tk_tab_tile" },
  { id: "paint",   icon: Paintbrush,  key: "tk_tab_paint" },
  { id: "stair",   icon: Footprints,  key: "tk_tab_stair" },
  { id: "thermal", icon: Thermometer, key: "tk_tab_thermal" },
  { id: "elec",    icon: Zap,         key: "tk_tab_elec" },
  { id: "units",   icon: Ruler,       key: "tk_tab_units" },
  { id: "scale",   icon: ScaleIcon,   key: "tk_tab_scale" },
  { id: "vat",     icon: Receipt,     key: "tk_tab_vat" },
  { id: "reno",    icon: TrendingUp,  key: "tk_tab_reno" },
  { id: "lots",    icon: PieChart,    key: "tk_tab_lots" },
] as const;

type TabId = typeof TABS[number]["id"];

// ── Shared input field component ───────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-white/60">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, min, max, step }: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type="number" min={min} max={max} step={step}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-full rounded bg-white/10 border border-white/10 px-2 py-1.5 text-sm text-white focus:border-amber-400 focus:outline-none"
    />
  );
}

function SelectInput({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      className="w-full rounded bg-white/10 border border-white/10 px-2 py-1.5 text-sm text-white focus:border-amber-400 focus:outline-none"
    >
      {options.map(o => <option key={o.value} value={o.value} className="bg-zinc-800">{o.label}</option>)}
    </select>
  );
}

function ResultRow({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${highlight ? "text-amber-300 font-semibold" : "text-white/80"}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function PrefillBadge({ d }: { d: (k: DTKey) => string }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-amber-400/70 mb-2">
      <Sparkles className="w-3 h-3" /> {d("tk_prefilled")}
    </div>
  );
}

// ── Tab: Tile Calculator ──────────────────────────────────────────────────────

function TileTab({ result, d }: { result: AnalysisResult; d: (k: DTKey) => string }) {
  const defaultSurface = result.surfaces?.area_hab_m2 ?? result.surfaces?.area_building_m2 ?? 20;
  const [surface, setSurface] = useState(defaultSurface);
  const [tileW, setTileW] = useState(30);
  const [tileH, setTileH] = useState(30);
  const [joint, setJoint] = useState(3);
  const [waste, setWaste] = useState(10);
  const [layout, setLayout] = useState<TileLayout>("straight");

  const res = useMemo(() => calcTiles({ surface_m2: surface, tile_w_cm: tileW, tile_h_cm: tileH, joint_mm: joint, waste_pct: waste, layout }), [surface, tileW, tileH, joint, waste, layout]);

  return (
    <div className="space-y-3">
      {(result.surfaces?.area_hab_m2 || result.surfaces?.area_building_m2) && <PrefillBadge d={d} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label={d("tk_tile_surface")}><NumInput value={surface} onChange={setSurface} min={0.1} step={0.1} /></Field>
        <Field label={d("tk_tile_size")}>
          <div className="flex gap-1 items-center">
            <NumInput value={tileW} onChange={setTileW} min={1} step={1} />
            <span className="text-white/40">×</span>
            <NumInput value={tileH} onChange={setTileH} min={1} step={1} />
            <span className="text-xs text-white/40">cm</span>
          </div>
        </Field>
        <Field label={d("tk_tile_joint")}><NumInput value={joint} onChange={setJoint} min={0} max={15} step={0.5} /></Field>
        <Field label={d("tk_tile_waste")}><NumInput value={waste} onChange={setWaste} min={0} max={30} step={1} /></Field>
      </div>
      <Field label={d("tk_tile_layout")}>
        <div className="flex gap-2">
          {(["straight", "diagonal", "chevron"] as TileLayout[]).map(l => (
            <button key={l} onClick={() => setLayout(l)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${layout === l ? "bg-amber-500 text-black" : "bg-white/10 text-white/60 hover:bg-white/20"}`}>
              {d(`tk_tile_${l}` as DTKey)}
            </button>
          ))}
        </div>
      </Field>
      <div className="border-t border-white/10 pt-3 space-y-1">
        <p className="text-xs font-medium text-white/50 uppercase mb-2">{d("tk_tile_result")}</p>
        <ResultRow label={d("tk_tile_count")} value={fmtN(res.tiles_count, 0)} highlight />
        <ResultRow label={d("tk_tile_boxes")} value={fmtN(res.boxes_count, 0)} />
        <ResultRow label={d("tk_tile_glue")} value={`${fmtN(res.glue_kg, 0)} kg`} />
        <ResultRow label={d("tk_tile_grout")} value={`${fmtN(res.joint_kg, 0)} kg`} />
        <ResultRow label={`Surface + chute`} value={`${fmtN(res.surface_with_waste_m2)} m²`} />
      </div>
    </div>
  );
}

// ── Tab: Paint Calculator ─────────────────────────────────────────────────────

function PaintTab({ result, d }: { result: AnalysisResult; d: (k: DTKey) => string }) {
  // Estimate net wall surface: perimeter_interior * 2.5m height - openings area
  const rooms = result.rooms ?? [];
  const totalPerim = rooms.reduce((s, r) => s + (r.perimeter_m ?? 0), 0);
  const ppm = result.pixels_per_meter ?? 1;
  const openingsArea = (result.openings ?? []).reduce((s, o) => s + (o.length_m ?? o.length_px / ppm) * 2.1, 0);
  const defaultWallSurf = totalPerim > 0 ? Math.max(1, totalPerim * 2.5 - openingsArea) : 50;

  const [wallSurf, setWallSurf] = useState(parseFloat(defaultWallSurf.toFixed(1)));
  const [coats, setCoats] = useState(2);
  const [coverage, setCoverage] = useState(10);
  const [potSize, setPotSize] = useState(10);
  const [primer, setPrimer] = useState(true);

  const res = useMemo(() => calcPaint({ wall_surface_m2: wallSurf, coats, coverage_m2_per_l: coverage, pot_size_l: potSize, primer }), [wallSurf, coats, coverage, potSize, primer]);

  return (
    <div className="space-y-3">
      {totalPerim > 0 && <PrefillBadge d={d} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label={d("tk_paint_surface")}><NumInput value={wallSurf} onChange={setWallSurf} min={1} step={1} /></Field>
        <Field label={d("tk_paint_coats")}>
          <div className="flex gap-2">
            {[1, 2, 3].map(c => (
              <button key={c} onClick={() => setCoats(c)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${coats === c ? "bg-amber-500 text-black" : "bg-white/10 text-white/60 hover:bg-white/20"}`}>
                {c}
              </button>
            ))}
          </div>
        </Field>
        <Field label={d("tk_paint_coverage")}><NumInput value={coverage} onChange={setCoverage} min={1} step={0.5} /></Field>
        <Field label={d("tk_paint_pot")}>
          <SelectInput value={String(potSize)} onChange={v => setPotSize(parseFloat(v))}
            options={[{ value: "2.5", label: "2.5 L" }, { value: "5", label: "5 L" }, { value: "10", label: "10 L" }, { value: "15", label: "15 L" }]} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
        <input type="checkbox" checked={primer} onChange={e => setPrimer(e.target.checked)} className="rounded" />
        {d("tk_paint_primer")}
      </label>
      <div className="border-t border-white/10 pt-3 space-y-1">
        <ResultRow label={d("tk_paint_liters")} value={`${fmtN(res.liters_needed)} L`} highlight />
        <ResultRow label={d("tk_paint_pots")} value={`${res.pots_needed} × ${potSize} L`} />
        {primer && <ResultRow label={d("tk_paint_primer_l")} value={`${fmtN(res.primer_liters)} L (${res.primer_pots} pot${res.primer_pots > 1 ? "s" : ""})`} />}
        <ResultRow label={`Surface totale (${coats} couche${coats > 1 ? "s" : ""})`} value={`${fmtN(res.total_surface_m2)} m²`} />
      </div>
    </div>
  );
}

// ── Tab: Staircase Calculator ─────────────────────────────────────────────────

function StairTab({ d }: { d: (k: DTKey) => string }) {
  const [height, setHeight] = useState(280);
  const [opening, setOpening] = useState(400);
  const [tread, setTread] = useState(25);

  const res = useMemo(() => calcStaircase({ floor_height_cm: height, opening_length_cm: opening, step_depth_cm: tread }), [height, opening, tread]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={d("tk_stair_height")}><NumInput value={height} onChange={setHeight} min={100} max={500} step={10} /></Field>
        <Field label={d("tk_stair_opening")}><NumInput value={opening} onChange={setOpening} min={100} max={800} step={10} /></Field>
        <Field label={d("tk_stair_tread")}><NumInput value={tread} onChange={setTread} min={18} max={35} step={0.5} /></Field>
      </div>
      <div className="border-t border-white/10 pt-3 space-y-1">
        <ResultRow label={d("tk_stair_steps")} value={res.step_count} highlight />
        <ResultRow label={d("tk_stair_riser")} value={`${fmtN(res.riser_height_cm)} cm`} />
        <ResultRow label={d("tk_stair_blondel")} value={`${fmtN(res.blondel)} cm`} />
        <ResultRow label={d("tk_stair_ok")} value={res.blondel_ok ? "✅" : "⚠️"} highlight />
        <ResultRow label={d("tk_stair_angle")} value={`${fmtN(res.angle_deg)}°`} />
        <ResultRow label={d("tk_stair_run")} value={`${fmtN(res.total_run_cm, 0)} cm`} />
      </div>
    </div>
  );
}

// ── Tab: Thermal Calculator ───────────────────────────────────────────────────

function ThermalTab({ d }: { d: (k: DTKey) => string }) {
  const [layers, setLayers] = useState<WallLayer[]>([
    { name: "Parpaing", thickness_cm: 20, lambda: 1.05 },
    { name: "Laine de verre", thickness_cm: 10, lambda: 0.035 },
    { name: "BA13", thickness_cm: 1.3, lambda: 0.25 },
  ]);

  const res = useMemo(() => calcThermal(layers), [layers]);

  const addLayer = () => setLayers([...layers, { name: "Béton", thickness_cm: 10, lambda: 1.75 }]);
  const removeLayer = (i: number) => setLayers(layers.filter((_, idx) => idx !== i));
  const updateLayer = (i: number, field: keyof WallLayer, val: string | number) => {
    const next = [...layers];
    if (field === "name") {
      next[i] = { ...next[i], name: val as string };
      const mat = COMMON_MATERIALS.find(m => m.name === val);
      if (mat) next[i].lambda = mat.lambda;
    } else {
      (next[i] as any)[field] = typeof val === "string" ? parseFloat(val) || 0 : val;
    }
    setLayers(next);
  };

  const DPE_COLORS: Record<string, string> = { A: "#319834", B: "#33cc31", C: "#cbfc33", D: "#fbef34", E: "#fccc33", F: "#fc9833", G: "#fc1a22" };

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">{d("tk_therm_title")}</p>
      {layers.map((l, i) => (
        <div key={i} className="flex gap-2 items-end">
          <Field label={d("tk_therm_material")}>
            <SelectInput value={l.name} onChange={v => updateLayer(i, "name", v)}
              options={COMMON_MATERIALS.map(m => ({ value: m.name, label: m.name }))} />
          </Field>
          <Field label={d("tk_therm_thick")}><NumInput value={l.thickness_cm} onChange={v => updateLayer(i, "thickness_cm", v)} min={0.1} step={0.5} /></Field>
          <Field label={d("tk_therm_lambda")}><NumInput value={l.lambda} onChange={v => updateLayer(i, "lambda", v)} min={0.001} step={0.001} /></Field>
          <button onClick={() => removeLayer(i)} className="text-red-400/60 hover:text-red-400 p-1 mb-1"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <button onClick={addLayer} className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
        <Plus className="w-3 h-3" /> {d("tk_therm_add")}
      </button>
      <div className="border-t border-white/10 pt-3 space-y-1">
        {res.layers_detail.map((l, i) => (
          <ResultRow key={i} label={`${l.name}`} value={`R = ${l.r} m²·K/W`} />
        ))}
        <div className="border-t border-white/10 pt-2 mt-2">
          <ResultRow label={d("tk_therm_r")} value={res.r_total} highlight />
          <ResultRow label={d("tk_therm_u")} value={res.u_value} />
          <div className="flex justify-between py-1 text-sm items-center">
            <span className="text-white/80">{d("tk_therm_dpe")}</span>
            <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ backgroundColor: DPE_COLORS[res.dpe_class] ?? "#888", color: "#000" }}>
              {res.dpe_class}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Electrical Planner ──────────────────────────────────────────────────

function ElecTab({ result, d }: { result: AnalysisResult; d: (k: DTKey) => string }) {
  const rooms = result.rooms ?? [];
  const mapRoomType = (t: string): RoomType => {
    const map: Record<string, RoomType> = {
      bedroom: "bedroom", living: "living", "living room": "living", kitchen: "kitchen",
      bathroom: "bathroom", wc: "wc", toilet: "wc", hallway: "hallway", corridor: "hallway",
      office: "office", study: "office", garage: "garage", laundry: "laundry",
    };
    return map[t?.toLowerCase()] ?? "bedroom";
  };

  const defaultRooms: ElecRoomInput[] = rooms.length > 0
    ? rooms.map(r => ({ type: mapRoomType(r.type), area_m2: r.area_m2 ?? 12, label: r.label_fr }))
    : [{ type: "living", area_m2: 25, label: "Séjour" }, { type: "bedroom", area_m2: 12, label: "Chambre" }, { type: "kitchen", area_m2: 10, label: "Cuisine" }, { type: "bathroom", area_m2: 5, label: "SdB" }];

  const [elecRooms, setElecRooms] = useState(defaultRooms);
  const res = useMemo(() => calcElectrical(elecRooms), [elecRooms]);

  const addRoom = () => setElecRooms([...elecRooms, { type: "bedroom", area_m2: 12, label: "Pièce" }]);
  const removeRoom = (i: number) => setElecRooms(elecRooms.filter((_, idx) => idx !== i));
  const updateRoom = (i: number, field: keyof ElecRoomInput, val: any) => {
    const next = [...elecRooms];
    (next[i] as any)[field] = val;
    setElecRooms(next);
  };

  const roomTypes: RoomType[] = ["bedroom", "living", "kitchen", "bathroom", "wc", "hallway", "office", "garage", "laundry"];

  return (
    <div className="space-y-3">
      {rooms.length > 0 && <PrefillBadge d={d} />}
      <div className="max-h-[300px] overflow-y-auto pr-1 space-y-2">
        {elecRooms.map((r, i) => (
          <div key={i} className="flex gap-2 items-end">
            <Field label="Type">
              <SelectInput value={r.type} onChange={v => updateRoom(i, "type", v)}
                options={roomTypes.map(rt => ({ value: rt, label: rt.charAt(0).toUpperCase() + rt.slice(1) }))} />
            </Field>
            <Field label="m²"><NumInput value={r.area_m2} onChange={v => updateRoom(i, "area_m2", v)} min={1} step={1} /></Field>
            <Field label="Label">
              <input value={r.label} onChange={e => updateRoom(i, "label", e.target.value)}
                className="w-full rounded bg-white/10 border border-white/10 px-2 py-1.5 text-sm text-white focus:border-amber-400 focus:outline-none" />
            </Field>
            <button onClick={() => removeRoom(i)} className="text-red-400/60 hover:text-red-400 p-1 mb-1"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <button onClick={addRoom} className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
        <Plus className="w-3 h-3" /> Ajouter pièce
      </button>
      <div className="border-t border-white/10 pt-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/50 border-b border-white/10">
                <th className="text-left py-1">Pièce</th>
                <th className="text-center py-1">{d("tk_elec_outlets")}</th>
                <th className="text-center py-1">{d("tk_elec_lights")}</th>
                <th className="text-center py-1">RJ45</th>
                <th className="text-left py-1">{d("tk_elec_dedicated")}</th>
              </tr>
            </thead>
            <tbody>
              {res.rooms.map((r, i) => (
                <tr key={i} className="border-b border-white/5 text-white/80">
                  <td className="py-1">{r.label}</td>
                  <td className="text-center">{r.outlets}</td>
                  <td className="text-center">{r.lights}</td>
                  <td className="text-center">{r.rj45}</td>
                  <td className="text-xs text-white/50">{r.dedicated.join(", ") || "—"}</td>
                </tr>
              ))}
              <tr className="text-amber-300 font-semibold">
                <td className="py-1">{d("tk_elec_total")}</td>
                <td className="text-center">{res.total_outlets}</td>
                <td className="text-center">{res.total_lights}</td>
                <td className="text-center">{res.total_rj45}</td>
                <td className="text-center">{res.total_dedicated}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-1">
          <p className="text-xs font-medium text-white/50 uppercase">{d("tk_elec_breakers")}</p>
          <ResultRow label={d("tk_elec_16a")} value={res.min_breaker_16a} />
          <ResultRow label={d("tk_elec_10a")} value={res.min_breaker_10a} />
          <ResultRow label={d("tk_elec_20a")} value={res.min_breaker_20a} />
        </div>
      </div>
    </div>
  );
}

// ── Tab: Unit Converter ──────────────────────────────────────────────────────

function UnitsTab({ d }: { d: (k: DTKey) => string }) {
  const [category, setCategory] = useState<UnitCategory>("length");
  const [value, setValue] = useState(1);
  const [from, setFrom] = useState("m");
  const [to, setTo] = useState("cm");

  const units = useMemo(() => getUnitsForCategory(category), [category]);
  const result = useMemo(() => convertUnit(value, from, to, category), [value, from, to, category]);

  const catOptions: { value: UnitCategory; key: DTKey }[] = [
    { value: "length", key: "tk_unit_length" },
    { value: "area", key: "tk_unit_area" },
    { value: "volume", key: "tk_unit_volume" },
    { value: "weight", key: "tk_unit_weight" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {catOptions.map(c => (
          <button key={c.value} onClick={() => { setCategory(c.value); setFrom(getUnitsForCategory(c.value)[0]); setTo(getUnitsForCategory(c.value)[1]); setValue(1); }}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${category === c.value ? "bg-amber-500 text-black" : "bg-white/10 text-white/60 hover:bg-white/20"}`}>
            {d(c.key)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 items-end">
        <Field label={d("tk_unit_value")}><NumInput value={value} onChange={setValue} step={0.01} /></Field>
        <Field label={d("tk_unit_from")}>
          <SelectInput value={from} onChange={setFrom} options={units.map(u => ({ value: u, label: u }))} />
        </Field>
        <Field label={d("tk_unit_to")}>
          <SelectInput value={to} onChange={setTo} options={units.map(u => ({ value: u, label: u }))} />
        </Field>
      </div>
      <div className="flex items-center justify-center gap-3 py-3">
        <span className="text-lg font-mono text-white">{fmtN(value, 4)} {from}</span>
        <ArrowRightLeft className="w-4 h-4 text-amber-400" />
        <span className="text-lg font-mono text-amber-300 font-semibold">{fmtN(result, 6)} {to}</span>
      </div>
    </div>
  );
}

// ── Tab: Scale Converter ──────────────────────────────────────────────────────

function ScaleTab({ d }: { d: (k: DTKey) => string }) {
  const [scaleFactor, setScaleFactor] = useState(100);
  const [planCm, setPlanCm] = useState(5);
  const [realM, setRealM] = useState(5);
  const [mode, setMode] = useState<"plan_to_real" | "real_to_plan">("plan_to_real");

  const result = useMemo(() =>
    mode === "plan_to_real" ? scaleToReal(planCm, scaleFactor) : realToScale(realM, scaleFactor),
    [mode, planCm, realM, scaleFactor]
  );

  return (
    <div className="space-y-3">
      <Field label={d("tk_scale_select")}>
        <div className="flex gap-1 flex-wrap">
          {COMMON_SCALES.map(s => (
            <button key={s.factor} onClick={() => setScaleFactor(s.factor)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${scaleFactor === s.factor ? "bg-amber-500 text-black" : "bg-white/10 text-white/60 hover:bg-white/20"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </Field>
      <div className="flex gap-2">
        <button onClick={() => setMode("plan_to_real")}
          className={`flex-1 py-1.5 rounded text-xs font-medium ${mode === "plan_to_real" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-white/5 text-white/50"}`}>
          {d("tk_scale_plan")} → {d("tk_scale_real")}
        </button>
        <button onClick={() => setMode("real_to_plan")}
          className={`flex-1 py-1.5 rounded text-xs font-medium ${mode === "real_to_plan" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-white/5 text-white/50"}`}>
          {d("tk_scale_real")} → {d("tk_scale_plan")}
        </button>
      </div>
      {mode === "plan_to_real" ? (
        <Field label={d("tk_scale_plan")}><NumInput value={planCm} onChange={setPlanCm} min={0.01} step={0.1} /></Field>
      ) : (
        <Field label={d("tk_scale_real")}><NumInput value={realM} onChange={setRealM} min={0.01} step={0.1} /></Field>
      )}
      <div className="text-center py-3">
        <span className="text-xs text-white/50">1:{scaleFactor}</span>
        <p className="text-lg font-mono text-amber-300 font-semibold mt-1">
          {mode === "plan_to_real" ? `${fmtN(result, 3)} m` : `${fmtN(result, 2)} cm`}
        </p>
      </div>
    </div>
  );
}

// ── Tab: VAT Calculator ──────────────────────────────────────────────────────

function VatTab({ d }: { d: (k: DTKey) => string }) {
  const [amount, setAmount] = useState(10000);
  const [rate, setRate] = useState(0.10);
  const [mode, setMode] = useState<"ht_to_ttc" | "ttc_to_ht">("ht_to_ttc");

  const res = useMemo(() => calcVat(amount, rate, mode), [amount, rate, mode]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button onClick={() => setMode("ht_to_ttc")}
          className={`flex-1 py-1.5 rounded text-xs font-medium ${mode === "ht_to_ttc" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-white/5 text-white/50"}`}>
          {d("tk_vat_mode_ht")}
        </button>
        <button onClick={() => setMode("ttc_to_ht")}
          className={`flex-1 py-1.5 rounded text-xs font-medium ${mode === "ttc_to_ht" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-white/5 text-white/50"}`}>
          {d("tk_vat_mode_ttc")}
        </button>
      </div>
      <Field label={d("tk_vat_amount") + (mode === "ht_to_ttc" ? " HT" : " TTC")}>
        <NumInput value={amount} onChange={setAmount} min={0} step={100} />
      </Field>
      <div className="space-y-2">
        {BTP_VAT_RATES.map(vr => (
          <label key={vr.rate} className="flex items-start gap-2 cursor-pointer group" onClick={() => setRate(vr.rate)}>
            <input type="radio" checked={rate === vr.rate} onChange={() => setRate(vr.rate)} className="mt-1" />
            <div>
              <span className={`text-sm ${rate === vr.rate ? "text-amber-300" : "text-white/70"}`}>{d(vr.label_key as DTKey)}</span>
              <p className="text-[10px] text-white/40">{d(vr.description_key as DTKey)}</p>
            </div>
          </label>
        ))}
      </div>
      <div className="border-t border-white/10 pt-3 space-y-1">
        <ResultRow label={d("tk_vat_ht")} value={fmtEur(res.ht)} />
        <ResultRow label={d("tk_vat_tva") + ` (${(rate * 100).toFixed(1)}%)`} value={fmtEur(res.vat_amount)} />
        <ResultRow label={d("tk_vat_ttc")} value={fmtEur(res.ttc)} highlight />
      </div>
    </div>
  );
}

// ── Tab: Renovation Budget ───────────────────────────────────────────────────

function RenoTab({ result, d }: { result: AnalysisResult; d: (k: DTKey) => string }) {
  const defaultSurface = result.surfaces?.area_hab_m2 ?? result.surfaces?.area_building_m2 ?? 60;
  const [surface, setSurface] = useState(parseFloat(defaultSurface.toFixed(0)));
  const [level, setLevel] = useState<RenoLevel>("standard");
  const [regionIdx, setRegionIdx] = useState(0);

  const res = useMemo(() => calcRenoBudget(surface, level, REGION_COEFFS[regionIdx].coeff), [surface, level, regionIdx]);

  return (
    <div className="space-y-3">
      {(result.surfaces?.area_hab_m2 || result.surfaces?.area_building_m2) && <PrefillBadge d={d} />}
      <Field label={d("tk_reno_surface")}><NumInput value={surface} onChange={setSurface} min={1} step={1} /></Field>
      <Field label={d("tk_reno_level")}>
        <div className="grid grid-cols-2 gap-2">
          {(["light", "standard", "heavy", "luxury"] as RenoLevel[]).map(l => (
            <button key={l} onClick={() => setLevel(l)}
              className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${level === l ? "bg-amber-500 text-black" : "bg-white/10 text-white/60 hover:bg-white/20"}`}>
              {d(RENO_LEVELS[l].label_key as DTKey)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={d("tk_reno_region")}>
        <SelectInput value={String(regionIdx)} onChange={v => setRegionIdx(parseInt(v))}
          options={REGION_COEFFS.map((r, i) => ({ value: String(i), label: `${r.region} (×${r.coeff})` }))} />
      </Field>
      <div className="border-t border-white/10 pt-3 space-y-1">
        <ResultRow label={d("tk_reno_base")} value={fmtEur(res.base_per_m2)} />
        <ResultRow label={d("tk_reno_coeff")} value={`×${res.region_coeff}`} />
        <ResultRow label={d("tk_reno_final")} value={fmtEur(res.final_per_m2)} />
        <ResultRow label={d("tk_reno_total_ht")} value={fmtEur(res.total_ht)} highlight />
        <ResultRow label={d("tk_reno_total_ttc")} value={fmtEur(res.total_ttc_10)} />
      </div>
    </div>
  );
}

// ── Tab: Budget Breakdown ────────────────────────────────────────────────────

function LotsTab({ d }: { d: (k: DTKey) => string }) {
  const [budget, setBudget] = useState(100000);
  const breakdown = useMemo(() => calcBudgetBreakdown(budget), [budget]);

  return (
    <div className="space-y-3">
      <Field label={d("tk_lots_budget")}><NumInput value={budget} onChange={setBudget} min={1000} step={5000} /></Field>
      <div className="border-t border-white/10 pt-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/50 border-b border-white/10">
              <th className="text-left py-1">{d("tk_lots_trade")}</th>
              <th className="text-center py-1">{d("tk_lots_pct")}</th>
              <th className="text-right py-1">{d("tk_lots_amount")}</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((lot, i) => (
              <tr key={i} className="border-b border-white/5 text-white/80">
                <td className="py-1">{d(lot.label_key as DTKey)}</td>
                <td className="text-center">{lot.pct}%</td>
                <td className="text-right font-mono">{fmtEur(lot.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* mini bar chart */}
        <div className="mt-3 flex gap-px rounded overflow-hidden h-4">
          {breakdown.map((lot, i) => (
            <div key={i} title={`${d(lot.label_key as DTKey)}: ${lot.pct}%`}
              className="h-full transition-all"
              style={{
                width: `${lot.pct}%`,
                backgroundColor: `hsl(${30 + i * 28}, 70%, ${55 - i * 2}%)`,
              }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export default function ToolkitPanel({ result }: ToolkitPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("tile");

  return (
    <div className="mt-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-gradient-to-r from-amber-600/20 to-orange-500/20 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-300">
          <Wrench className="w-4 h-4" /> {d("tk_title")}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/40 hidden sm:inline">{d("tk_subtitle")}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-xl bg-white/[0.03] border border-white/10 p-4">
              {/* Tabs */}
              <div className="flex gap-1 flex-wrap mb-4">
                {TABS.map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isActive ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70"
                      }`}>
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{d(tab.key as DTKey)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="min-h-[200px]">
                {activeTab === "tile" && <TileTab result={result} d={d} />}
                {activeTab === "paint" && <PaintTab result={result} d={d} />}
                {activeTab === "stair" && <StairTab d={d} />}
                {activeTab === "thermal" && <ThermalTab d={d} />}
                {activeTab === "elec" && <ElecTab result={result} d={d} />}
                {activeTab === "units" && <UnitsTab d={d} />}
                {activeTab === "scale" && <ScaleTab d={d} />}
                {activeTab === "vat" && <VatTab d={d} />}
                {activeTab === "reno" && <RenoTab result={result} d={d} />}
                {activeTab === "lots" && <LotsTab d={d} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
