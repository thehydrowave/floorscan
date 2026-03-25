"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  ChantierProjet, ChantierPiece, ChantierTache, TacheStatut,
  InventaireArticle, InventaireStatut, InventaireCategorie,
  Reserve, ReserveStatut, ReserveNiveau, ReserveCommentaire,
  Intervenant, TravauxCategorie,
  CATEGORIE_LABELS, CATEGORIE_ICONS, CATEGORIE_COLORS,
  STATUT_LABELS, STATUT_COLORS,
  INVENTAIRE_STATUT_LABELS, INVENTAIRE_STATUT_COLORS, INVENTAIRE_STATUT_ICONS,
  INVENTAIRE_CAT_LABELS, INVENTAIRE_CAT_ICONS,
  RESERVE_STATUT_LABELS, RESERVE_STATUT_COLORS,
  RESERVE_NIVEAU_LABELS, RESERVE_NIVEAU_COLORS,
  progressionPiece, progressionGlobale, inventaireStats, reservesStats,
  createProjet, createPieceFromRoom, createPieceManuelle,
  OpeningRef, CHANTIER_STORAGE_KEY,
} from "@/lib/chantier-types";
import { Room, Opening } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, ChevronDown, ChevronRight, CheckCircle2,
  Clock, AlertCircle, Circle, PenLine, X, Save,
  ClipboardList, Layers, RotateCcw, Download,
  Package, AlertTriangle, BarChart3,
  Truck, Wrench, MessageSquare, Cloud, CloudOff,
} from "lucide-react";

const STATUT_ICONS: Record<TacheStatut, React.ReactNode> = {
  a_faire: <Circle className="w-4 h-4" />, en_cours: <Clock className="w-4 h-4" />,
  termine: <CheckCircle2 className="w-4 h-4" />, bloque: <AlertCircle className="w-4 h-4" />,
};
function getNextStatut(s: TacheStatut): TacheStatut { const o: TacheStatut[] = ["a_faire","en_cours","termine","bloque"]; return o[(o.indexOf(s)+1)%o.length]; }
function ProgressBar({ value, className }: { value: number; className?: string }) { const c = value===100?"#10B981":value>60?"#3B82F6":value>30?"#F59E0B":"#94A3B8"; return <div className={cn("h-1.5 bg-white/5 rounded-full overflow-hidden",className)}><div className="h-full rounded-full transition-all duration-500" style={{width:`${value}%`,background:c}}/></div>; }
function fmt(n: number) { return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(n); }

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiLoad(): Promise<ChantierProjet | null> {
  try {
    const res = await fetch("/api/chantier");
    if (!res.ok) return null;
    const { data } = await res.json();
    return data as ChantierProjet | null;
  } catch { return null; }
}

async function apiSave(projet: ChantierProjet): Promise<void> {
  try {
    const { planImageB64: _img, ...safe } = projet as any;
    await fetch("/api/chantier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safe),
    });
  } catch { /* silencieux */ }
}

async function apiDelete(): Promise<void> {
  try { await fetch("/api/chantier", { method: "DELETE" }); } catch { /* silencieux */ }
}

function TacheRow({ tache, onUpdate, onDelete }: { tache: ChantierTache; onUpdate: (t: ChantierTache) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(tache.label);
  const [note, setNote] = useState(tache.note ?? "");
  const [entreprise, setEntreprise] = useState(tache.entreprise ?? "");
  const [quantite, setQuantite] = useState(tache.quantite?.toString() ?? "");
  const [unite, setUnite] = useState(tache.unite ?? "");
  const cycleStatut = () => onUpdate({ ...tache, statut: getNextStatut(tache.statut), updatedAt: new Date().toISOString() });
  const saveEdit = () => { onUpdate({ ...tache, label: label.trim()||tache.label, note: note.trim()||undefined, entreprise: entreprise.trim()||undefined, quantite: quantite?parseFloat(quantite):undefined, unite: unite.trim()||undefined, updatedAt: new Date().toISOString() }); setEditing(false); };
  const col = STATUT_COLORS[tache.statut]; const catCol = CATEGORIE_COLORS[tache.categorie];
  const confPct = tache.sourceDetection?.confidence!=null?Math.round(tache.sourceDetection.confidence*100):null;
  return (
    <div className={cn("glass border rounded-xl overflow-hidden transition-all",tache.statut==="termine"?"border-emerald-500/20 opacity-75":tache.statut==="bloque"?"border-red-500/20":tache.statut==="en_cours"?"border-amber-500/30":"border-white/5")}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={cycleStatut} style={{color:col}} className="flex-shrink-0 hover:scale-110 transition-transform">{STATUT_ICONS[tache.statut]}</button>
        <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0" style={{background:catCol+"22",color:catCol}}>{CATEGORIE_ICONS[tache.categorie]}</span>
        {editing?<input value={label} onChange={e=>setLabel(e.target.value)} autoFocus className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-sm text-white outline-none focus:border-accent"/>:<span onClick={()=>setEditing(true)} className={cn("flex-1 text-sm cursor-pointer hover:text-white transition-colors",tache.statut==="termine"?"text-slate-500 line-through":"text-slate-200")}>{tache.label}</span>}
        {tache.sourceDetection&&!editing&&<span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-semibold flex-shrink-0">IA{confPct!=null?` ${confPct}%`:""}</span>}
        {tache.quantite!=null&&!editing&&<span className="text-xs text-slate-500 font-mono flex-shrink-0">{tache.quantite} {tache.unite}</span>}
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 hidden sm:inline" style={{background:col+"22",color:col}}>{STATUT_LABELS[tache.statut]}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {editing?(<><button onClick={saveEdit} className="text-emerald-400 hover:text-emerald-300 p-0.5"><Save className="w-3.5 h-3.5"/></button><button onClick={()=>setEditing(false)} className="text-slate-500 p-0.5"><X className="w-3.5 h-3.5"/></button></>):(<><button onClick={()=>setEditing(true)} className="text-slate-600 hover:text-white p-0.5"><PenLine className="w-3.5 h-3.5"/></button><button onClick={onDelete} className="text-slate-600 hover:text-red-400 p-0.5"><Trash2 className="w-3.5 h-3.5"/></button></>)}
        </div>
      </div>
      {editing&&(<div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-white/5 pt-2"><div className="col-span-2"><label className="text-[10px] text-slate-500 block mb-0.5">Note</label><textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-accent resize-none"/></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Entreprise</label><input value={entreprise} onChange={e=>setEntreprise(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-accent"/></div><div className="flex gap-1"><div className="flex-1"><label className="text-[10px] text-slate-500 block mb-0.5">Qté</label><input type="number" value={quantite} onChange={e=>setQuantite(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-accent"/></div><div className="w-14"><label className="text-[10px] text-slate-500 block mb-0.5">Unité</label><input value={unite} onChange={e=>setUnite(e.target.value)} placeholder="m²" className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-accent"/></div></div></div>)}
      {!editing&&tache.note&&<div className="px-3 pb-2 text-xs text-slate-500 border-t border-white/5 pt-1.5">💬 {tache.note}</div>}
    </div>
  );
}

function PieceCard({ piece, expanded, onToggle, onUpdatePiece, onDeletePiece }: { piece: ChantierPiece; expanded: boolean; onToggle: ()=>void; onUpdatePiece: (p:ChantierPiece)=>void; onDeletePiece: ()=>void }) {
  const [addingTache,setAddingTache]=useState(false); const [newLabel,setNewLabel]=useState(""); const [newCategorie,setNewCategorie]=useState<TravauxCategorie>("autre");
  const [filterStatut,setFilterStatut]=useState<TacheStatut|"all">("all"); const [editingNom,setEditingNom]=useState(false); const [nom,setNom]=useState(piece.nom);
  const pct=progressionPiece(piece); const done=piece.taches.filter(t=>t.statut==="termine").length; const blocked=piece.taches.filter(t=>t.statut==="bloque").length; const inProg=piece.taches.filter(t=>t.statut==="en_cours").length;
  const updateTache=(idx:number,u:ChantierTache)=>{const t=[...piece.taches];t[idx]=u;onUpdatePiece({...piece,taches:t,updatedAt:new Date().toISOString()});};
  const deleteTache=(idx:number)=>onUpdatePiece({...piece,taches:piece.taches.filter((_,i)=>i!==idx),updatedAt:new Date().toISOString()});
  const addTache=()=>{if(!newLabel.trim())return;onUpdatePiece({...piece,taches:[...piece.taches,{id:crypto.randomUUID(),categorie:newCategorie,label:newLabel.trim(),statut:"a_faire",updatedAt:new Date().toISOString()}],updatedAt:new Date().toISOString()});setNewLabel("");setAddingTache(false);};
  const saveNom=()=>{onUpdatePiece({...piece,nom:nom.trim()||piece.nom,updatedAt:new Date().toISOString()});setEditingNom(false);};
  const filtered=filterStatut==="all"?piece.taches:piece.taches.filter(t=>t.statut===filterStatut);
  const byCategorie=filtered.reduce<Record<string,ChantierTache[]>>((acc,t)=>{acc[t.categorie]=[...(acc[t.categorie]??[]),t];return acc;},{});
  return (
    <div className={cn("glass border rounded-2xl overflow-hidden transition-all",pct===100?"border-emerald-500/30":blocked>0?"border-red-500/20":"border-white/10")}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors select-none" onClick={onToggle}>
        {expanded?<ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0"/>:<ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0"/>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {editingNom?<input value={nom} onChange={e=>setNom(e.target.value)} onBlur={saveNom} onKeyDown={e=>e.key==="Enter"&&saveNom()} className="bg-white/10 border border-white/20 rounded px-2 py-0.5 text-sm text-white outline-none" autoFocus onClick={e=>e.stopPropagation()}/>:<span className="text-sm font-semibold text-white hover:text-accent truncate" onClick={e=>{e.stopPropagation();setEditingNom(true);}}>{piece.nom}</span>}
            {piece.aireM2&&<span className="text-xs text-slate-500 font-mono flex-shrink-0">{piece.aireM2.toFixed(1)} m²</span>}
            {piece.openings&&<div className="flex items-center gap-1">{piece.openings.doors>0&&<span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold">🚪 {piece.openings.doors}</span>}{piece.openings.windows>0&&<span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-semibold">🪟 {piece.openings.windows}</span>}{piece.openings.french_doors>0&&<span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-semibold">🚪🪟 {piece.openings.french_doors}</span>}</div>}
          </div>
          <div className="flex items-center gap-2 mt-1"><ProgressBar value={pct} className="flex-1"/><span className={cn("text-xs font-mono flex-shrink-0",pct===100?"text-emerald-400":"text-slate-500")}>{pct}%</span></div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 text-xs">{inProg>0&&<span className="text-amber-400 font-mono hidden sm:block">{inProg} en cours</span>}{blocked>0&&<span className="text-red-400 font-mono">{blocked} bloqué{blocked>1?"s":""}</span>}<span className="text-slate-500 font-mono">{done}/{piece.taches.length}</span></div>
        <button onClick={e=>{e.stopPropagation();onDeletePiece();}} className="text-slate-700 hover:text-red-400 transition-colors p-1 flex-shrink-0"><Trash2 className="w-3.5 h-3.5"/></button>
      </div>
      {expanded&&(
        <div className="border-t border-white/5 px-4 py-3">
          {piece.openings&&(piece.openings.doors+piece.openings.windows+piece.openings.french_doors)>0&&(<div className="mb-3 flex items-center gap-2 text-xs bg-accent/5 border border-accent/10 rounded-xl px-3 py-2"><span className="text-accent font-semibold">Détectées par IA :</span>{piece.openings.doors>0&&<span className="text-amber-400">{piece.openings.doors} porte{piece.openings.doors>1?"s":""}</span>}{piece.openings.windows>0&&<span className="text-cyan-400">{piece.openings.windows} fenêtre{piece.openings.windows>1?"s":""}</span>}{piece.openings.french_doors>0&&<span className="text-orange-400">{piece.openings.french_doors} porte-fenêtre{piece.openings.french_doors>1?"s":""}</span>}</div>)}
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            {(["all","a_faire","en_cours","termine","bloque"] as const).map(s=><button key={s} onClick={()=>setFilterStatut(s)} className={cn("px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-colors",filterStatut===s?"bg-white/15 text-white":"text-slate-500 hover:text-white")} style={filterStatut===s&&s!=="all"?{color:STATUT_COLORS[s]}:{}}>{s==="all"?`Toutes (${piece.taches.length})`:`${STATUT_LABELS[s]} (${piece.taches.filter(t=>t.statut===s).length})`}</button>)}
          </div>
          {Object.entries(byCategorie).map(([cat,taches])=>(<div key={cat} className="mb-3"><div className="flex items-center gap-1.5 mb-1.5"><span className="text-sm">{CATEGORIE_ICONS[cat as TravauxCategorie]}</span><span className="text-xs font-semibold" style={{color:CATEGORIE_COLORS[cat as TravauxCategorie]}}>{CATEGORIE_LABELS[cat as TravauxCategorie]}</span><span className="text-xs text-slate-600">({taches.filter(t=>t.statut==="termine").length}/{taches.length})</span></div><div className="space-y-1.5 pl-4">{taches.map(t=>{const idx=piece.taches.findIndex(pt=>pt.id===t.id);return <TacheRow key={t.id} tache={t} onUpdate={u=>updateTache(idx,u)} onDelete={()=>deleteTache(idx)}/>;})}</div></div>))}
          {filtered.length===0&&<p className="text-center text-slate-600 text-sm py-4">Aucune tâche</p>}
          <textarea value={piece.note??""} onChange={e=>onUpdatePiece({...piece,note:e.target.value,updatedAt:new Date().toISOString()})} rows={2} placeholder="Note générale..." className="w-full mt-3 bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs text-slate-400 outline-none focus:border-accent/30 resize-none"/>
          {addingTache?(<div className="mt-3 flex gap-2 flex-wrap"><select value={newCategorie} onChange={e=>setNewCategorie(e.target.value as TravauxCategorie)} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none">{Object.entries(CATEGORIE_LABELS).map(([k,v])=><option key={k} value={k}>{CATEGORIE_ICONS[k as TravauxCategorie]} {v}</option>)}</select><input value={newLabel} onChange={e=>setNewLabel(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTache()} placeholder="Nom de la tâche..." autoFocus className="flex-1 min-w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent"/><button onClick={addTache} className="text-emerald-400 hover:text-emerald-300 px-2"><Save className="w-4 h-4"/></button><button onClick={()=>setAddingTache(false)} className="text-slate-500 hover:text-white px-1"><X className="w-4 h-4"/></button></div>):(<button onClick={()=>setAddingTache(true)} className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-white border border-dashed border-white/10 hover:border-white/30 rounded-xl py-2 transition-colors"><Plus className="w-3.5 h-3.5"/> Ajouter une tâche</button>)}
        </div>
      )}
    </div>
  );
}

const OPENING_STATUT_COLOR: Record<TacheStatut, string> = {
  a_faire: "#EF4444", en_cours: "#F59E0B", termine: "#10B981", bloque: "#DC2626",
};

function PlanOverlay({ planB64, planMime, pieces, reserves, imgWidth=0, imgHeight=0, onSelectPiece, onToggleTache, selectedPieceId }: {
  planB64: string; planMime: string; pieces: ChantierPiece[]; reserves: Reserve[];
  imgWidth?: number; imgHeight?: number;
  onSelectPiece: (id: string) => void;
  onToggleTache: (pieceId: string, tacheId: string) => void;
  selectedPieceId: string | null;
}) {
  const [size,setSize]=useState({w:1,h:1}); const imgRef=useRef<HTMLImageElement>(null);
  const onLoad=()=>{if(imgRef.current)setSize({w:imgRef.current.offsetWidth,h:imgRef.current.offsetHeight});};
  const openingTasks=pieces.flatMap(piece=>piece.taches.filter(t=>t.sourceDetection?.openingRef&&t.sourceDetection.openingRef.x_px!=null).map(t=>({piece,tache:t,ref:t.sourceDetection!.openingRef as OpeningRef})));
  const W=imgWidth||1; const H=imgHeight||1;
  return (
    <div className="relative rounded-xl overflow-hidden border border-white/10 bg-white/5">
      <img ref={imgRef} src={`data:${planMime};base64,${planB64}`} className="w-full" alt="plan" onLoad={onLoad}/>
      <div className="absolute top-2 left-2 flex items-center gap-1.5 flex-wrap">
        {([["a_faire","À faire"],["en_cours","En cours"],["termine","Fait"]] as [TacheStatut,string][]).map(([s,l])=>(
          <div key={s} className="flex items-center gap-1 bg-black/60 rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{color:OPENING_STATUT_COLOR[s]}}>
            <div className="w-2 h-2 rounded-sm shrink-0" style={{background:OPENING_STATUT_COLOR[s]}}/>{l}
          </div>
        ))}
      </div>
      <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
        {pieces.map(piece=>{if(!piece.polygonNorm||piece.polygonNorm.length<3)return null;const pts=piece.polygonNorm.map(p=>`${p.x*size.w},${p.y*size.h}`).join(" ");const pct=progressionPiece(piece);const fill=pct===100?"#10B98155":pct>50?"#3B82F655":pct>0?"#F59E0B44":"#94A3B822";const stk=selectedPieceId===piece.id?"#06B6D4":pct===100?"#10B981":"#94A3B866";const cx=piece.polygonNorm.reduce((s,p)=>s+p.x,0)/piece.polygonNorm.length*size.w;const cy=piece.polygonNorm.reduce((s,p)=>s+p.y,0)/piece.polygonNorm.length*size.h;return(<g key={piece.id} onClick={()=>onSelectPiece(piece.id)} className="cursor-pointer"><polygon points={pts} fill={fill} stroke={stk} strokeWidth={selectedPieceId===piece.id?2.5:1.5} className="transition-all hover:opacity-80"/><text x={cx} y={cy-6} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="white" className="pointer-events-none select-none drop-shadow">{piece.nom.slice(0,12)}</text><text x={cx} y={cy+8} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill={pct===100?"#10B981":"#94A3B8"} className="pointer-events-none select-none">{pct}%</text></g>);})}
        {openingTasks.map(({piece,tache,ref})=>{
          const cx=(ref.x_px/W)*size.w; const cy=(ref.y_px/H)*size.h;
          const rw=Math.max(8,(ref.width_px/W)*size.w*0.9); const rh=Math.max(8,(ref.height_px/H)*size.h*0.9);
          const col=OPENING_STATUT_COLOR[tache.statut]; const done=tache.statut==="termine";
          return(<g key={tache.id} onClick={e=>{e.stopPropagation();onToggleTache(piece.id,tache.id);}} className="cursor-pointer">
            <rect x={cx-rw/2} y={cy-rh/2} width={rw} height={rh} fill={col+(done?"99":"44")} stroke={col} strokeWidth={done?2.5:1.5} rx="2" className="transition-all hover:opacity-80"/>
            {done&&<line x1={cx-rw*0.25} y1={cy} x2={cx} y2={cy+rh*0.2} stroke="white" strokeWidth="1.5" strokeLinecap="round" className="pointer-events-none"/>}
            {done&&<line x1={cx} y1={cy+rh*0.2} x2={cx+rw*0.3} y2={cy-rh*0.2} stroke="white" strokeWidth="1.5" strokeLinecap="round" className="pointer-events-none"/>}
          </g>);
        })}
        {reserves.filter(r=>r.position&&r.statut!=="levee").map(r=>{const cx=r.position!.x*size.w;const cy=r.position!.y*size.h;const col=RESERVE_NIVEAU_COLORS[r.niveau];return(<g key={r.id} className="cursor-pointer"><circle cx={cx} cy={cy} r="10" fill={col+"cc"} stroke={col} strokeWidth="1.5"/><text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="white" fontWeight="bold" className="pointer-events-none select-none">{r.numero}</text></g>);})}
      </svg>
    </div>
  );
}

function InventaireRow({ article, onUpdate, onDelete }: { article: InventaireArticle; onUpdate: (a: InventaireArticle) => void; onDelete: () => void }) {
  const [editing,setEditing]=useState(false); const [form,setForm]=useState({...article});
  const cycleStatut=()=>{const o:InventaireStatut[]=["commande","livre","pose","retour"];onUpdate({...article,statut:o[(o.indexOf(article.statut)+1)%o.length],updatedAt:new Date().toISOString()});};
  const save=()=>{onUpdate({...form,updatedAt:new Date().toISOString()});setEditing(false);};
  const livColor=INVENTAIRE_STATUT_COLORS[article.statut];
  const livPct=article.quantiteCommandee>0?Math.min(100,Math.round(article.quantiteLivree/article.quantiteCommandee*100)):0;
  const posePct=article.quantiteCommandee>0?Math.min(100,Math.round(article.quantitePosee/article.quantiteCommandee*100)):0;
  const enRetard=article.dateLivraisonPrevue&&article.statut==="commande"&&new Date(article.dateLivraisonPrevue)<new Date();
  return (
    <div className={cn("glass border rounded-xl overflow-hidden transition-all",enRetard?"border-red-500/30":"border-white/5")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button onClick={cycleStatut} className="text-lg flex-shrink-0 hover:scale-110 transition-transform">{INVENTAIRE_STATUT_ICONS[article.statut]}</button>
        <span className="text-sm flex-shrink-0">{INVENTAIRE_CAT_ICONS[article.categorie]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><span className="text-sm text-white font-medium truncate">{article.designation}</span>{article.reference&&<span className="text-[10px] text-slate-500 font-mono">{article.reference}</span>}{enRetard&&<span className="text-[9px] bg-red-500/20 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded font-semibold">RETARD</span>}</div>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
            <div className="flex items-center gap-1.5 flex-1"><Truck className="w-3 h-3 text-amber-400 flex-shrink-0"/><div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-amber-400 rounded-full" style={{width:`${livPct}%`}}/></div><span className="font-mono">{article.quantiteLivree}/{article.quantiteCommandee} {article.unite}</span></div>
            <div className="flex items-center gap-1.5 flex-1"><Wrench className="w-3 h-3 text-emerald-400 flex-shrink-0"/><div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-emerald-400 rounded-full" style={{width:`${posePct}%`}}/></div><span className="font-mono">{article.quantitePosee}/{article.quantiteCommandee}</span></div>
          </div>
        </div>
        {article.prixUnitaireHT!=null&&<span className="text-xs text-slate-400 font-mono flex-shrink-0 hidden sm:block">{fmt(article.prixUnitaireHT*article.quantiteCommandee)} €</span>}
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 hidden sm:inline" style={{background:livColor+"22",color:livColor}}>{INVENTAIRE_STATUT_LABELS[article.statut]}</span>
        <div className="flex items-center gap-1 flex-shrink-0"><button onClick={()=>setEditing(!editing)} className="text-slate-600 hover:text-white p-0.5"><PenLine className="w-3.5 h-3.5"/></button><button onClick={onDelete} className="text-slate-600 hover:text-red-400 p-0.5"><Trash2 className="w-3.5 h-3.5"/></button></div>
      </div>
      {editing&&(<div className="px-3 pb-3 border-t border-white/5 pt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="col-span-2 sm:col-span-3"><label className="text-[10px] text-slate-500 block mb-0.5">Désignation</label><input value={form.designation} onChange={e=>setForm(f=>({...f,designation:e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white outline-none focus:border-accent"/></div>
        <div><label className="text-[10px] text-slate-500 block mb-0.5">Référence</label><input value={form.reference??""} onChange={e=>setForm(f=>({...f,reference:e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-accent"/></div>
        <div><label className="text-[10px] text-slate-500 block mb-0.5">Fournisseur</label><input value={form.fournisseur??""} onChange={e=>setForm(f=>({...f,fournisseur:e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-accent"/></div>
        <div><label className="text-[10px] text-slate-500 block mb-0.5">Qté cmd</label><input type="number" value={form.quantiteCommandee} onChange={e=>setForm(f=>({...f,quantiteCommandee:parseFloat(e.target.value)||0}))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-accent"/></div>
        <div><label className="text-[10px] text-slate-500 block mb-0.5">Qté livrée</label><input type="number" value={form.quantiteLivree} onChange={e=>setForm(f=>({...f,quantiteLivree:parseFloat(e.target.value)||0}))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-accent"/></div>
        <div><label className="text-[10px] text-slate-500 block mb-0.5">Qté posée</label><input type="number" value={form.quantitePosee} onChange={e=>setForm(f=>({...f,quantitePosee:parseFloat(e.target.value)||0}))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-accent"/></div>
        <div><label className="text-[10px] text-slate-500 block mb-0.5">Unité</label><input value={form.unite} onChange={e=>setForm(f=>({...f,unite:e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-accent"/></div>
        <div><label className="text-[10px] text-slate-500 block mb-0.5">Prix HT/u (€)</label><input type="number" value={form.prixUnitaireHT??""} onChange={e=>setForm(f=>({...f,prixUnitaireHT:parseFloat(e.target.value)||undefined}))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-accent"/></div>
        <div><label className="text-[10px] text-slate-500 block mb-0.5">Livr. prévue</label><input type="date" value={form.dateLivraisonPrevue??""} onChange={e=>setForm(f=>({...f,dateLivraisonPrevue:e.target.value||undefined}))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-accent"/></div>
        <div className="col-span-2 sm:col-span-3 flex justify-end gap-2"><button onClick={save} className="px-3 py-1.5 bg-accent/20 hover:bg-accent/30 text-accent rounded-lg text-xs font-semibold flex items-center gap-1"><Save className="w-3 h-3"/> Sauver</button><button onClick={()=>setEditing(false)} className="px-3 py-1.5 text-slate-500 hover:text-white text-xs">Annuler</button></div>
      </div>)}
    </div>
  );
}

function OngletInventaire({ inventaire, onUpdate }: { inventaire: InventaireArticle[]; onUpdate: (inv: InventaireArticle[]) => void }) {
  const [filterStatut,setFilterStatut]=useState<InventaireStatut|"all">("all");
  const [adding,setAdding]=useState(false);
  const [newForm,setNewForm]=useState<Partial<InventaireArticle>>({categorie:"revetements",unite:"m²",quantiteCommandee:0,quantiteLivree:0,quantitePosee:0,statut:"commande"});
  const stats=inventaireStats(inventaire);
  const filtered=inventaire.filter(a=>filterStatut==="all"||a.statut===filterStatut);
  const byCategorie=filtered.reduce<Record<string,InventaireArticle[]>>((acc,a)=>{acc[a.categorie]=[...(acc[a.categorie]??[]),a];return acc;},{});
  const addArticle=()=>{if(!newForm.designation?.trim())return;onUpdate([...inventaire,{id:crypto.randomUUID(),categorie:newForm.categorie??"autre",designation:newForm.designation.trim(),reference:newForm.reference,fournisseur:newForm.fournisseur,quantiteCommandee:newForm.quantiteCommandee??0,quantiteLivree:0,quantitePosee:0,unite:newForm.unite??"U",prixUnitaireHT:newForm.prixUnitaireHT,statut:"commande",updatedAt:new Date().toISOString()}]);setNewForm({categorie:"revetements",unite:"m²",quantiteCommandee:0,quantiteLivree:0,quantitePosee:0,statut:"commande"});setAdding(false);};
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">{[{label:"Articles",value:stats.total,color:"#6366F1"},{label:"Livrés",value:stats.livre,color:"#F59E0B"},{label:"Posés",value:stats.pose,color:"#10B981"},{label:"Retards",value:stats.retard,color:"#EF4444"}].map(({label,value,color})=><div key={label} className="glass border border-white/10 rounded-xl px-4 py-3 text-center"><div className="text-2xl font-700 font-mono" style={{color}}>{value}</div><div className="text-xs text-slate-500 mt-0.5">{label}</div></div>)}</div>
      {stats.totalHT>0&&<div className="glass border border-white/10 rounded-xl px-4 py-3 mb-4 flex items-center justify-between"><span className="text-sm text-slate-400">Total commandé HT</span><span className="text-lg font-700 text-white font-mono">{fmt(stats.totalHT)} €</span></div>}
      <div className="flex flex-wrap gap-1 mb-4">{(["all","commande","livre","pose","retour"] as const).map(s=><button key={s} onClick={()=>setFilterStatut(s)} className={cn("px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-colors",filterStatut===s?"bg-white/15 text-white":"text-slate-500 hover:text-white")} style={filterStatut===s&&s!=="all"?{color:INVENTAIRE_STATUT_COLORS[s]}:{}}>{s==="all"?`Tous (${inventaire.length})`:`${INVENTAIRE_STATUT_LABELS[s]} (${inventaire.filter(a=>a.statut===s).length})`}</button>)}</div>
      {Object.entries(byCategorie).map(([cat,articles])=><div key={cat} className="mb-4"><div className="flex items-center gap-2 mb-2"><span className="text-base">{INVENTAIRE_CAT_ICONS[cat as InventaireCategorie]}</span><span className="text-sm font-semibold text-white">{INVENTAIRE_CAT_LABELS[cat as InventaireCategorie]}</span></div><div className="space-y-2">{articles.map(a=><InventaireRow key={a.id} article={a} onUpdate={u=>onUpdate(inventaire.map(x=>x.id===u.id?u:x))} onDelete={()=>onUpdate(inventaire.filter(x=>x.id!==a.id))}/>)}</div></div>)}
      {filtered.length===0&&<p className="text-center text-slate-600 text-sm py-8">Aucun article</p>}
      {adding?(<div className="glass border border-white/10 rounded-xl p-4 mt-4"><div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><div className="col-span-2 sm:col-span-3"><label className="text-[10px] text-slate-500 block mb-0.5">Désignation *</label><input value={newForm.designation??""} onChange={e=>setNewForm(f=>({...f,designation:e.target.value}))} autoFocus className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm text-white outline-none focus:border-accent"/></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Catégorie</label><select value={newForm.categorie} onChange={e=>setNewForm(f=>({...f,categorie:e.target.value as InventaireCategorie}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none">{Object.entries(INVENTAIRE_CAT_LABELS).map(([k,v])=><option key={k} value={k}>{INVENTAIRE_CAT_ICONS[k as InventaireCategorie]} {v}</option>)}</select></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Qté commandée</label><input type="number" value={newForm.quantiteCommandee??0} onChange={e=>setNewForm(f=>({...f,quantiteCommandee:parseFloat(e.target.value)||0}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none focus:border-accent"/></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Unité</label><input value={newForm.unite??""} onChange={e=>setNewForm(f=>({...f,unite:e.target.value}))} placeholder="m², U, ml…" className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none focus:border-accent"/></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Prix HT/u (€)</label><input type="number" value={newForm.prixUnitaireHT??""} onChange={e=>setNewForm(f=>({...f,prixUnitaireHT:parseFloat(e.target.value)||undefined}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none focus:border-accent"/></div></div><div className="flex gap-2 mt-3 justify-end"><button onClick={addArticle} className="px-4 py-2 bg-accent/20 hover:bg-accent/30 text-accent rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5"><Save className="w-3.5 h-3.5"/> Ajouter</button><button onClick={()=>setAdding(false)} className="px-4 py-2 text-slate-500 hover:text-white text-sm">Annuler</button></div></div>):<button onClick={()=>setAdding(true)} className="mt-4 w-full flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-white border border-dashed border-white/10 hover:border-white/30 rounded-2xl py-3 transition-colors"><Plus className="w-4 h-4"/> Ajouter un article</button>}
    </div>
  );
}

function ReserveCard({ reserve, pieces, onUpdate, onDelete }: { reserve: Reserve; pieces: ChantierPiece[]; onUpdate: (r: Reserve) => void; onDelete: () => void }) {
  const [expanded,setExpanded]=useState(false); const [newComment,setNewComment]=useState("");
  const cycleStatut=()=>{const o:ReserveStatut[]=["ouverte","en_cours","levee","rejetee"];onUpdate({...reserve,statut:o[(o.indexOf(reserve.statut)+1)%o.length],updatedAt:new Date().toISOString()});};
  const addComment=()=>{if(!newComment.trim())return;onUpdate({...reserve,commentaires:[...reserve.commentaires,{id:crypto.randomUUID(),texte:newComment.trim(),date:new Date().toISOString()}],updatedAt:new Date().toISOString()});setNewComment("");};
  const levee=reserve.statut==="levee"; const piece=pieces.find(p=>p.id===reserve.pieceId);
  const nCol=RESERVE_NIVEAU_COLORS[reserve.niveau]; const sCol=RESERVE_STATUT_COLORS[reserve.statut];
  return (
    <div className={cn("glass border rounded-xl overflow-hidden transition-all",levee?"border-emerald-500/20 opacity-75":reserve.niveau==="bloquante"?"border-red-500/30":"border-white/5")}>
      <div className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-white/5" onClick={()=>setExpanded(!expanded)}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5" style={{background:nCol+"33",color:nCol,border:`1px solid ${nCol}66`}}>{reserve.numero}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><span className={cn("text-sm font-medium",levee?"text-slate-500 line-through":"text-white")}>{reserve.titre}</span><span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{background:nCol+"22",color:nCol}}>{RESERVE_NIVEAU_LABELS[reserve.niveau]}</span></div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">{piece&&<span>📍 {piece.nom}</span>}{reserve.entrepriseResponsable&&<span>🏢 {reserve.entrepriseResponsable}</span>}<span>{new Date(reserve.dateConstatee).toLocaleDateString("fr-FR")}</span>{reserve.dateLimiteLevee&&!levee&&<span className={cn(new Date(reserve.dateLimiteLevee)<new Date()?"text-red-400 font-semibold":"")}>⏰ {new Date(reserve.dateLimiteLevee).toLocaleDateString("fr-FR")}</span>}{reserve.commentaires.length>0&&<span className="flex items-center gap-0.5"><MessageSquare className="w-3 h-3"/> {reserve.commentaires.length}</span>}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0"><button onClick={e=>{e.stopPropagation();cycleStatut();}} className="text-[10px] px-2 py-0.5 rounded font-semibold transition-all hover:opacity-80" style={{background:sCol+"22",color:sCol}}>{RESERVE_STATUT_LABELS[reserve.statut]}</button><button onClick={e=>{e.stopPropagation();onDelete();}} className="text-slate-700 hover:text-red-400 p-0.5"><Trash2 className="w-3.5 h-3.5"/></button></div>
      </div>
      {expanded&&(<div className="border-t border-white/5 px-3 py-3">{reserve.description&&<p className="text-sm text-slate-300 mb-3">{reserve.description}</p>}{reserve.commentaires.length>0&&<div className="space-y-2 mb-3">{reserve.commentaires.map(c=><div key={c.id} className="bg-white/5 rounded-lg px-3 py-2"><div className="flex items-center justify-between text-[10px] text-slate-500 mb-1"><span>{c.auteur??"CdT"}</span><span>{new Date(c.date).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span></div><p className="text-xs text-slate-300">{c.texte}</p></div>)}</div>}<div className="flex gap-2"><input value={newComment} onChange={e=>setNewComment(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addComment()} placeholder="Ajouter un commentaire..." className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent"/><button onClick={addComment} className="text-accent hover:text-accent/80 px-2"><MessageSquare className="w-4 h-4"/></button></div></div>)}
    </div>
  );
}

function OngletReserves({ reserves, pieces, onUpdate }: { reserves: Reserve[]; pieces: ChantierPiece[]; onUpdate: (r: Reserve[]) => void }) {
  const [filterStatut,setFilterStatut]=useState<ReserveStatut|"all">("ouverte");
  const [adding,setAdding]=useState(false);
  const [newForm,setNewForm]=useState<Partial<Reserve>>({niveau:"mineure",statut:"ouverte",categorie:"gros_oeuvre",dateConstatee:new Date().toISOString().slice(0,10)});
  const stats=reservesStats(reserves); const filtered=reserves.filter(r=>filterStatut==="all"||r.statut===filterStatut);
  const addReserve=()=>{if(!newForm.titre?.trim())return;onUpdate([...reserves,{id:crypto.randomUUID(),numero:reserves.length>0?Math.max(...reserves.map(r=>r.numero))+1:1,titre:newForm.titre.trim(),description:newForm.description,niveau:newForm.niveau??"mineure",statut:"ouverte",categorie:newForm.categorie??"gros_oeuvre",entrepriseResponsable:newForm.entrepriseResponsable,pieceId:newForm.pieceId,dateConstatee:newForm.dateConstatee??new Date().toISOString().slice(0,10),dateLimiteLevee:newForm.dateLimiteLevee,commentaires:[],updatedAt:new Date().toISOString()}]);setNewForm({niveau:"mineure",statut:"ouverte",categorie:"gros_oeuvre",dateConstatee:new Date().toISOString().slice(0,10)});setAdding(false);};
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">{[{label:"Ouvertes",value:stats.ouvertes,color:"#EF4444"},{label:"En cours",value:stats.en_cours,color:"#F59E0B"},{label:"Levées",value:stats.levees,color:"#10B981"},{label:"Bloquantes",value:stats.bloquantes,color:"#DC2626"}].map(({label,value,color})=><div key={label} className="glass border border-white/10 rounded-xl px-4 py-3 text-center"><div className="text-2xl font-700 font-mono" style={{color}}>{value}</div><div className="text-xs text-slate-500 mt-0.5">{label}</div></div>)}</div>
      <div className="flex items-center gap-1 mb-4 flex-wrap">{(["all","ouverte","en_cours","levee","rejetee"] as const).map(s=><button key={s} onClick={()=>setFilterStatut(s)} className={cn("px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-colors",filterStatut===s?"bg-white/15 text-white":"text-slate-500 hover:text-white")} style={filterStatut===s&&s!=="all"?{color:RESERVE_STATUT_COLORS[s]}:{}}>{s==="all"?`Toutes (${reserves.length})`:`${RESERVE_STATUT_LABELS[s]} (${reserves.filter(r=>r.statut===s).length})`}</button>)}</div>
      <div className="space-y-2">{filtered.map(r=><ReserveCard key={r.id} reserve={r} pieces={pieces} onUpdate={u=>onUpdate(reserves.map(x=>x.id===u.id?u:x))} onDelete={()=>onUpdate(reserves.filter(x=>x.id!==r.id))}/>)}</div>
      {filtered.length===0&&<p className="text-center text-slate-600 text-sm py-8">Aucune réserve</p>}
      {adding?(<div className="glass border border-white/10 rounded-xl p-4 mt-4"><h4 className="text-sm font-semibold text-white mb-3">Nouvelle réserve</h4><div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><div className="col-span-2 sm:col-span-3"><label className="text-[10px] text-slate-500 block mb-0.5">Titre *</label><input value={newForm.titre??""} onChange={e=>setNewForm(f=>({...f,titre:e.target.value}))} autoFocus className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent"/></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Niveau</label><select value={newForm.niveau} onChange={e=>setNewForm(f=>({...f,niveau:e.target.value as ReserveNiveau}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none">{Object.entries(RESERVE_NIVEAU_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Catégorie</label><select value={newForm.categorie} onChange={e=>setNewForm(f=>({...f,categorie:e.target.value as TravauxCategorie}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none">{Object.entries(CATEGORIE_LABELS).map(([k,v])=><option key={k} value={k}>{CATEGORIE_ICONS[k as TravauxCategorie]} {v}</option>)}</select></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Pièce</label><select value={newForm.pieceId??""} onChange={e=>setNewForm(f=>({...f,pieceId:e.target.value||undefined}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none"><option value="">— Aucune —</option>{pieces.map(p=><option key={p.id} value={p.id}>{p.nom}</option>)}</select></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Entreprise</label><input value={newForm.entrepriseResponsable??""} onChange={e=>setNewForm(f=>({...f,entrepriseResponsable:e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none focus:border-accent"/></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Date constatée</label><input type="date" value={newForm.dateConstatee??""} onChange={e=>setNewForm(f=>({...f,dateConstatee:e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none focus:border-accent"/></div><div><label className="text-[10px] text-slate-500 block mb-0.5">Date limite</label><input type="date" value={newForm.dateLimiteLevee??""} onChange={e=>setNewForm(f=>({...f,dateLimiteLevee:e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none focus:border-accent"/></div><div className="col-span-2 sm:col-span-3"><label className="text-[10px] text-slate-500 block mb-0.5">Description</label><textarea value={newForm.description??""} onChange={e=>setNewForm(f=>({...f,description:e.target.value}))} rows={2} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent resize-none"/></div></div><div className="flex gap-2 mt-3 justify-end"><button onClick={addReserve} className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5"/> Créer</button><button onClick={()=>setAdding(false)} className="px-4 py-2 text-slate-500 hover:text-white text-sm">Annuler</button></div></div>):<button onClick={()=>setAdding(true)} className="mt-4 w-full flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-white border border-dashed border-white/10 hover:border-white/30 rounded-2xl py-3 transition-colors"><Plus className="w-4 h-4"/> Signaler une réserve</button>}
    </div>
  );
}

function StatsBar({ projet }: { projet: ChantierProjet }) {
  const pct=progressionGlobale(projet); const invStats=inventaireStats(projet.inventaire); const resStats=reservesStats(projet.reserves);
  return (
    <div className="glass border border-white/10 rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold text-white">Avancement global</span><span className={cn("text-xl font-700 font-mono",pct===100?"text-emerald-400":"text-white")}>{pct}%</span></div>
      <ProgressBar value={pct} className="mb-3"/>
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div className="text-center"><div className="text-slate-400 mb-1">Tâches</div><div className="font-mono text-white">{projet.pieces.flatMap(p=>p.taches).filter(t=>t.statut==="termine").length}/{projet.pieces.flatMap(p=>p.taches).length}</div></div>
        <div className="text-center border-x border-white/5"><div className="text-slate-400 mb-1">Inventaire</div><div className="font-mono text-white">{invStats.pose} posés · {invStats.retard>0?<span className="text-red-400">{invStats.retard} retard{invStats.retard>1?"s":""}</span>:<span className="text-emerald-400">OK</span>}</div></div>
        <div className="text-center"><div className="text-slate-400 mb-1">Réserves</div><div className={cn("font-mono",resStats.bloquantes>0?"text-red-400":resStats.ouvertes>0?"text-amber-400":"text-emerald-400")}>{resStats.ouvertes+resStats.en_cours>0?`${resStats.ouvertes+resStats.en_cours} ouverte${resStats.ouvertes+resStats.en_cours>1?"s":""}` :"Aucune"}</div></div>
      </div>
    </div>
  );
}

export interface ChantierModuleProps {
  rooms?: Room[]; openings?: Opening[]; imgWidth?: number; imgHeight?: number;
  planB64?: string | null; planMime?: string; sessionId?: string | null; pixelsPerMeter?: number | null;
}

export default function ChantierModule({ rooms, openings, imgWidth=0, imgHeight=0, planB64, planMime="image/png", sessionId, pixelsPerMeter }: ChantierModuleProps) {
  const [projet,setProjet]=useState<ChantierProjet|null>(null);
  const [loading,setLoading]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [syncError,setSyncError]=useState(false);
  const [onglet,setOnglet]=useState<"avancement"|"inventaire"|"reserves">("avancement");
  const [expandedIds,setExpandedIds]=useState<Set<string>>(new Set());
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [view,setView]=useState<"liste"|"plan">("liste");
  const [showNew,setShowNew]=useState(false); const [nomProjet,setNomProjet]=useState("");
  const [addingPiece,setAddingPiece]=useState(false); const [newPieceNom,setNewPieceNom]=useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  const openingRefs: OpeningRef[]=(openings??[]).map(o=>({class:o.class,x_px:o.x_px,y_px:o.y_px,width_px:o.width_px,height_px:o.height_px,width_m:o.width_m,height_m:o.height_m}));

  // ── Chargement initial : API d'abord, fallback localStorage ──
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      // Essayer l'API Neon
      const remote = await apiLoad();
      if (remote) {
        setProjet(remote);
        setLoading(false);
        return;
      }
      // Fallback localStorage
      try {
        const raw = localStorage.getItem(CHANTIER_STORAGE_KEY);
        if (raw) setProjet(JSON.parse(raw));
      } catch { /* silencieux */ }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // ── Sauvegarde : debounce 1.5s → API + localStorage ──
  const save = useCallback((p: ChantierProjet) => {
    setProjet(p);
    // localStorage immédiat (backup local)
    try { localStorage.setItem(CHANTIER_STORAGE_KEY, JSON.stringify(p)); } catch { /* silencieux */ }
    // API Neon avec debounce pour éviter les appels excessifs
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSyncing(true);
      setSyncError(false);
      try {
        await apiSave(p);
      } catch {
        setSyncError(true);
      } finally {
        setSyncing(false);
      }
    }, 1500);
  }, []);

  const initFromRooms=()=>{const p=createProjet(nomProjet||"Mon chantier");p.planImageB64=planB64??undefined;p.planImageMime=planMime;p.sessionId=sessionId??undefined;p.pixelsPerMeter=pixelsPerMeter??undefined;if(rooms?.length)p.pieces=rooms.map(r=>createPieceFromRoom(r,openingRefs,imgWidth,imgHeight));setExpandedIds(new Set(p.pieces.map(pc=>pc.id)));save(p);setShowNew(false);setNomProjet("");};
  const initManuel=()=>{const p=createProjet(nomProjet||"Mon chantier");save(p);setShowNew(false);setNomProjet("");};
  const addPieceManuelle=()=>{if(!projet||!newPieceNom.trim())return;const piece=createPieceManuelle(newPieceNom.trim());save({...projet,pieces:[...projet.pieces,piece],updatedAt:new Date().toISOString()});setExpandedIds(prev=>new Set([...prev,piece.id]));setNewPieceNom("");setAddingPiece(false);};
  const exportJson=()=>{if(!projet)return;const{planImageB64:_,...safe}=projet as any;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(safe,null,2)],{type:"application/json"}));a.download=`chantier_${projet.nom.replace(/\s+/g,"_")}.json`;a.click();};
  const resetProjet=async()=>{if(!confirm("Supprimer le suivi de chantier ?"))return;localStorage.removeItem(CHANTIER_STORAGE_KEY);await apiDelete();setProjet(null);};

  if (loading) {
    return (
      <div className="max-w-lg mx-auto flex flex-col items-center justify-center py-20 gap-3">
        <Cloud className="w-8 h-8 text-slate-500 animate-pulse"/>
        <p className="text-slate-400 text-sm">Chargement du chantier…</p>
      </div>
    );
  }

  if(!projet) {
    const openingsCount=openingRefs.length;
    return (
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8"><div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4"><ClipboardList className="w-8 h-8 text-white"/></div><h2 className="font-display text-2xl font-700 text-white mb-2">Suivi de chantier</h2><p className="text-slate-400 text-sm">Avancement · Inventaire · Réserves</p></div>
        {showNew?(
          <div className="glass border border-white/10 rounded-2xl p-6">
            <h3 className="text-white font-semibold mb-4">Nouveau projet de suivi</h3>
            <div className="mb-4"><label className="text-xs text-slate-500 block mb-1">Nom du chantier</label><input value={nomProjet} onChange={e=>setNomProjet(e.target.value)} autoFocus placeholder="Ex: Rénovation appartement Paris 11e" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-accent"/></div>
            <div className="space-y-3">
              {rooms&&rooms.length>0&&<button onClick={initFromRooms} className="w-full glass border border-accent/30 hover:border-accent/60 rounded-xl p-4 text-left transition-all"><div className="flex items-center gap-3"><Layers className="w-5 h-5 text-accent"/><div><p className="text-white font-medium text-sm">Importer depuis le plan analysé</p><p className="text-slate-400 text-xs">{rooms.length} pièce{rooms.length>1?"s":""}{openingsCount>0?` · ${openingsCount} ouverture${openingsCount>1?"s":""} détectée${openingsCount>1?"s":""}`:""} — tâches pré-remplies</p></div></div></button>}
              <button onClick={initManuel} className="w-full glass border border-white/10 hover:border-white/30 rounded-xl p-4 text-left transition-all"><div className="flex items-center gap-3"><PenLine className="w-5 h-5 text-slate-400"/><div><p className="text-white font-medium text-sm">Démarrer manuellement</p><p className="text-slate-400 text-xs">Ajouter les pièces et tâches vous-même</p></div></div></button>
            </div>
            <button onClick={()=>setShowNew(false)} className="w-full mt-3 text-xs text-slate-600 hover:text-slate-400 transition-colors">Annuler</button>
          </div>
        ):<button onClick={()=>setShowNew(true)} className="w-full glass border-2 border-dashed border-white/15 rounded-2xl p-8 flex flex-col items-center gap-3 hover:border-accent/30 transition-all"><Plus className="w-8 h-8 text-slate-500"/><span className="text-slate-300">Démarrer un suivi de chantier</span></button>}
      </div>
    );
  }

  const hasPlan=!!(projet.planImageB64&&projet.planImageMime);
  const resStats=reservesStats(projet.reserves); const invStats=inventaireStats(projet.inventaire);

  return (
    <div>
      <div className="glass border border-white/10 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
        <ClipboardList className="w-5 h-5 text-amber-400 flex-shrink-0"/>
        <div className="flex-1 min-w-0"><span className="text-white font-semibold truncate block">{projet.nom}</span><ProgressBar value={progressionGlobale(projet)} className="mt-1"/></div>
        <span className={cn("text-lg font-700 font-mono flex-shrink-0",progressionGlobale(projet)===100?"text-emerald-400":"text-white")}>{progressionGlobale(projet)}%</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Indicateur de sync */}
          {syncing
            ? <Cloud className="w-3.5 h-3.5 text-slate-500 animate-pulse" title="Synchronisation…"/>
            : syncError
            ? <CloudOff className="w-3.5 h-3.5 text-red-400" title="Erreur de sync — données sauvegardées localement"/>
            : <Cloud className="w-3.5 h-3.5 text-emerald-500/70" title="Synchronisé"/>
          }
          {hasPlan&&onglet==="avancement"&&<div className="flex items-center glass border border-white/10 rounded-lg p-0.5 mr-1"><button onClick={()=>setView("liste")} className={cn("px-2 py-1 rounded text-xs font-medium transition-colors",view==="liste"?"bg-white/15 text-white":"text-slate-500 hover:text-white")}>Liste</button><button onClick={()=>setView("plan")} className={cn("px-2 py-1 rounded text-xs font-medium transition-colors",view==="plan"?"bg-white/15 text-white":"text-slate-500 hover:text-white")}>Plan</button></div>}
          <button onClick={exportJson} title="Exporter JSON" className="text-slate-500 hover:text-white p-1.5 transition-colors"><Download className="w-4 h-4"/></button>
          <button onClick={resetProjet} title="Réinitialiser" className="text-slate-500 hover:text-red-400 p-1.5 transition-colors"><RotateCcw className="w-4 h-4"/></button>
        </div>
      </div>

      <div className="flex items-center gap-1 glass border border-white/10 rounded-xl p-1 mb-4">
        {[{key:"avancement" as const,icon:BarChart3,label:"Avancement",badge:null},{key:"inventaire" as const,icon:Package,label:"Inventaire",badge:invStats.retard>0?{n:invStats.retard,color:"bg-red-500"}:null},{key:"reserves" as const,icon:AlertTriangle,label:"Réserves",badge:(resStats.ouvertes+resStats.en_cours)>0?{n:resStats.ouvertes+resStats.en_cours,color:resStats.bloquantes>0?"bg-red-500":"bg-amber-500"}:null}].map(({key,icon:Icon,label,badge})=>(
          <button key={key} onClick={()=>setOnglet(key)} className={cn("flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all relative",onglet===key?"bg-white/15 text-white":"text-slate-400 hover:text-white")}>
            <Icon className="w-4 h-4"/><span className="hidden sm:inline">{label}</span>
            {badge&&<span className={cn("absolute top-1 right-1 w-4 h-4 rounded-full text-[9px] flex items-center justify-center text-white font-bold",badge.color)}>{badge.n}</span>}
          </button>
        ))}
      </div>

      {onglet==="avancement"&&(
        <>
          {view==="plan"&&hasPlan?(<div className="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-4"><PlanOverlay planB64={projet.planImageB64!} planMime={projet.planImageMime!} pieces={projet.pieces} reserves={projet.reserves} imgWidth={imgWidth} imgHeight={imgHeight} onSelectPiece={id=>{setSelectedId(id);setExpandedIds(prev=>new Set([...prev,id]));setView("liste");}} onToggleTache={(pieceId,tacheId)=>{const updated={...projet,pieces:projet.pieces.map(p=>p.id!==pieceId?p:{...p,taches:p.taches.map(t=>t.id!==tacheId?t:{...t,statut:(t.statut==="termine"?"a_faire":"termine") as TacheStatut,updatedAt:new Date().toISOString()})}),updatedAt:new Date().toISOString()};save(updated);}} selectedPieceId={selectedId}/><StatsBar projet={projet}/></div>):<StatsBar projet={projet}/>}
          <div className="flex items-center justify-between mb-3"><span className="text-sm text-slate-400">{projet.pieces.length} pièce{projet.pieces.length>1?"s":""}</span><div className="flex gap-2"><button onClick={()=>setExpandedIds(new Set(projet.pieces.map(p=>p.id)))} className="text-xs text-slate-500 hover:text-white transition-colors">Tout ouvrir</button><span className="text-slate-700">·</span><button onClick={()=>setExpandedIds(new Set())} className="text-xs text-slate-500 hover:text-white transition-colors">Tout fermer</button></div></div>
          <div className="space-y-3">{projet.pieces.map(piece=><PieceCard key={piece.id} piece={piece} expanded={expandedIds.has(piece.id)} onToggle={()=>setExpandedIds(prev=>{const n=new Set(prev);n.has(piece.id)?n.delete(piece.id):n.add(piece.id);return n;})} onUpdatePiece={updated=>save({...projet,pieces:projet.pieces.map(p=>p.id===piece.id?updated:p),updatedAt:new Date().toISOString()})} onDeletePiece={()=>{if(!confirm("Supprimer cette pièce ?"))return;save({...projet,pieces:projet.pieces.filter(p=>p.id!==piece.id),updatedAt:new Date().toISOString()});}}/>)}</div>
          {addingPiece?(<div className="mt-3 flex gap-2"><input value={newPieceNom} onChange={e=>setNewPieceNom(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPieceManuelle()} placeholder="Nom de la pièce..." autoFocus className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-accent"/><button onClick={addPieceManuelle} className="text-emerald-400 hover:text-emerald-300 px-3"><Save className="w-4 h-4"/></button><button onClick={()=>setAddingPiece(false)} className="text-slate-500 hover:text-white px-2"><X className="w-4 h-4"/></button></div>):<button onClick={()=>setAddingPiece(true)} className="mt-3 w-full flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-white border border-dashed border-white/10 hover:border-white/30 rounded-2xl py-3 transition-colors"><Plus className="w-4 h-4"/> Ajouter une pièce</button>}
        </>
      )}
      {onglet==="inventaire"&&<OngletInventaire inventaire={projet.inventaire} onUpdate={inv=>save({...projet,inventaire:inv,updatedAt:new Date().toISOString()})}/>}
      {onglet==="reserves"&&<OngletReserves reserves={projet.reserves} pieces={projet.pieces} onUpdate={res=>save({...projet,reserves:res,updatedAt:new Date().toISOString()})}/>}
    </div>
  );
}
