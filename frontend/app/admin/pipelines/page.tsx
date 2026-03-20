"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  ScanLine, Loader2, ArrowLeft, Upload,
  BarChart3, AlertTriangle, CheckCircle2,
  TrendingUp, Layers, ChevronDown, ChevronUp, Zap
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/use-auth";
import { cn } from "@/lib/utils";
import { BACKEND } from "@/lib/backend";

interface PipelineResult {
  id: string; name: string; description: string; color: string;
  doors_count: number; windows_count: number; french_doors_count?: number;
  footprint_area_m2: number|null; walls_area_m2: number|null; hab_area_m2: number|null;
  rooms_count: number; timing_seconds: number; error: string|null;
  mask_walls_b64: string|null; mask_doors_b64: string|null; mask_windows_b64: string|null;
  mask_footprint_b64: string|null; mask_hab_b64: string|null; mask_rooms_b64: string|null;
  is_diagonal?: boolean;
  mask_diagonal_walls_b64?: string|null;
  diagonal_stats?: { total_segments:number; diagonal_segments:number; horizontal_segments:number; vertical_segments:number; diagonal_pct:number; };
}

interface ComparisonResult {
  pipelines: Record<string, PipelineResult>;
  comparison_table: Array<{ id:string; name:string; color:string; doors:number; windows:number; french_doors?:number; footprint_m2:number|null; walls_m2:number|null; hab_m2:number|null; rooms:number; time_s:number; error:string|null; }>;
  total_time_seconds: number;
}

function PipelineCard({ result, planB64, isReference }: { result: PipelineResult; planB64: string; isReference: boolean }) {
  const [showMask, setShowMask] = useState<"walls"|"rooms"|"doors"|"diagonal"|null>("walls");
  const fmt = (v: number|null|undefined) => v!=null ? v.toFixed(1) : "—";

  return (
    <div className={cn("glass border rounded-2xl overflow-hidden", result.error?"border-red-500/30":isReference?"border-accent/40":"border-white/10")}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{background:result.color}}/>
          <span className="text-sm font-semibold text-white">{result.name}</span>
          {isReference&&<span className="text-[10px] bg-accent/20 border border-accent/30 text-accent px-1.5 py-0.5 rounded font-semibold uppercase">Référence</span>}
          {result.is_diagonal&&<span className="text-[10px] bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 px-1.5 py-0.5 rounded font-semibold uppercase">Nouveau</span>}
        </div>
        <span className="text-xs text-slate-500 font-mono">{result.timing_seconds}s</span>
      </div>

      {result.error&&<div className="px-4 py-3 flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5"/><p className="text-xs text-red-400">{result.error}</p></div>}

      {!result.error&&(
        <>
          <div className="grid grid-cols-3 gap-px bg-white/5">
            {[{label:"Portes",value:result.doors_count},{label:"Fenêtres",value:result.windows_count},{label:"Pièces",value:result.rooms_count}].map(({label,value})=>(
              <div key={label} className="bg-ink px-3 py-2 text-center"><div className="text-lg font-700 text-white font-mono">{value}</div><div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div></div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-px bg-white/5">
            {[{label:"Emprise m²",value:fmt(result.footprint_area_m2)},{label:"Murs m²",value:fmt(result.walls_area_m2)},{label:"Hab. m²",value:fmt(result.hab_area_m2)}].map(({label,value})=>(
              <div key={label} className="bg-ink px-3 py-2 text-center"><div className="text-sm font-700 text-white font-mono">{value}</div><div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div></div>
            ))}
          </div>

          {result.is_diagonal&&result.diagonal_stats&&(
            <div className="px-4 py-2 bg-cyan-500/5 border-t border-cyan-500/10">
              <p className="text-xs text-cyan-400 font-semibold mb-1">Statistiques murs diagonaux</p>
              <div className="grid grid-cols-4 gap-1 text-center">
                <div><div className="text-sm font-mono text-white">{result.diagonal_stats.total_segments}</div><div className="text-[9px] text-slate-500">Total</div></div>
                <div><div className="text-sm font-mono text-cyan-400">{result.diagonal_stats.diagonal_segments}</div><div className="text-[9px] text-slate-500">Diag.</div></div>
                <div><div className="text-sm font-mono text-slate-300">{result.diagonal_stats.horizontal_segments}</div><div className="text-[9px] text-slate-500">Horiz.</div></div>
                <div><div className="text-sm font-mono text-slate-300">{result.diagonal_stats.vertical_segments}</div><div className="text-[9px] text-slate-500">Vert.</div></div>
              </div>
              <div className="mt-1.5">
                <div className="flex justify-between text-[10px] text-slate-500 mb-0.5"><span>% diagonaux</span><span className="text-cyan-400 font-mono">{result.diagonal_stats.diagonal_pct.toFixed(1)}%</span></div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 rounded-full transition-all" style={{width:`${Math.min(100,result.diagonal_stats.diagonal_pct)}%`}}/></div>
              </div>
            </div>
          )}

          <div className="px-4 py-2 flex items-center gap-1 flex-wrap border-t border-white/5">
            {[
              {key:"walls" as const,label:"Murs",b64:result.mask_walls_b64},
              {key:"rooms" as const,label:"Pièces",b64:result.mask_rooms_b64},
              {key:"doors" as const,label:"Portes",b64:result.mask_doors_b64},
              ...(result.mask_diagonal_walls_b64?[{key:"diagonal" as const,label:"Diag.",b64:result.mask_diagonal_walls_b64}]:[]),
            ].map(({key,label,b64})=>(
              <button key={key} onClick={()=>setShowMask(showMask===key?null:key)} disabled={!b64} className={cn("px-2 py-0.5 rounded text-[10px] font-semibold transition-colors",showMask===key?"bg-white/20 text-white":b64?"text-slate-500 hover:text-white":"text-slate-700 cursor-not-allowed")}>{label}</button>
            ))}
          </div>

          <div className="px-4 pb-4">
            <div className="relative rounded-lg overflow-hidden border border-white/5 aspect-video bg-white/5">
              <img src={`data:image/png;base64,${planB64}`} className="w-full h-full object-contain" alt="plan"/>
              {showMask==="walls"&&result.mask_walls_b64&&<img src={`data:image/png;base64,${result.mask_walls_b64}`} className="absolute inset-0 w-full h-full object-contain" style={{mixBlendMode:"screen"}} alt="murs"/>}
              {showMask==="rooms"&&result.mask_rooms_b64&&<img src={`data:image/png;base64,${result.mask_rooms_b64}`} className="absolute inset-0 w-full h-full object-contain" style={{mixBlendMode:"screen"}} alt="pièces"/>}
              {showMask==="doors"&&result.mask_doors_b64&&<img src={`data:image/png;base64,${result.mask_doors_b64}`} className="absolute inset-0 w-full h-full object-contain" style={{mixBlendMode:"screen"}} alt="portes"/>}
              {showMask==="diagonal"&&result.mask_diagonal_walls_b64&&<img src={`data:image/png;base64,${result.mask_diagonal_walls_b64}`} className="absolute inset-0 w-full h-full object-contain" style={{mixBlendMode:"screen"}} alt="diagonaux"/>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function PipelinesPage() {
  const {isAdmin}=useAuth();
  const [sessionId,setSessionId]=useState<string|null>(null);
  const [planB64,setPlanB64]=useState<string|null>(null);
  const [uploading,setUploading]=useState(false);
  const [comparing,setComparing]=useState(false);
  const [result,setResult]=useState<ComparisonResult|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [showTable,setShowTable]=useState(true);
  const fileRef=useRef<HTMLInputElement>(null);

  if(!isAdmin)return<div className="min-h-screen bg-ink flex items-center justify-center"><p className="text-slate-400">Accès refusé</p></div>;

  const handleFile=async(file:File)=>{
    setUploading(true);setError(null);setResult(null);
    try{
      const reader=new FileReader();
      reader.onload=async(e)=>{
        const dataUrl=e.target?.result as string;
        const[header,b64]=dataUrl.split(",");
        const mime=header.split(":")[1].split(";")[0];
        if(mime==="application/pdf"){
          const res=await fetch(`${BACKEND}/upload-pdf`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pdf_base64:b64,filename:file.name,zoom:2.0,page:0})});
          if(!res.ok)throw new Error(`Upload PDF failed: ${res.status}`);
          const data=await res.json();setSessionId(data.session_id);setPlanB64(data.image_b64);setUploading(false);return;
        }
        const res=await fetch(`${BACKEND}/upload-image`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image_base64:b64,filename:file.name})});
        if(!res.ok)throw new Error(`Upload failed: ${res.status}`);
        const data=await res.json();setSessionId(data.session_id);setPlanB64(data.image_b64);setUploading(false);
      };
      reader.readAsDataURL(file);
    }catch(e:any){setError(e.message);setUploading(false);}
  };

  const runComparison=async()=>{
    if(!sessionId)return;setComparing(true);setError(null);setResult(null);
    try{
      const res=await fetch(`${BACKEND}/compare`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:sessionId})});
      if(!res.ok)throw new Error(`Compare failed: ${res.status}`);
      setResult(await res.json());
    }catch(e:any){setError(e.message);}
    finally{setComparing(false);}
  };

  const gridOrder=["H","G","A","D","F","E","B","C"];

  return(
    <div className="min-h-screen bg-ink">
      <div className="border-b border-white/10 bg-white/[0.02] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2"><ScanLine className="w-6 h-6 text-sky-400"/><span className="font-display text-lg font-700 bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">FloorScan</span></Link>
            <span className="text-slate-600">|</span>
            <h1 className="text-sm font-semibold text-white flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-cyan-400"/> Comparaison Pipelines (Admin)</h1>
          </div>
          <Link href="/admin"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4"/> Admin</Button></Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="glass border border-cyan-500/20 rounded-xl px-4 py-3 flex items-start gap-3 mb-6">
          <Zap className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5"/>
          <div className="text-sm text-slate-300"><strong className="text-white">Pipeline H (Diagonal)</strong> — Morphologie adaptative + Hough multi-angles pour détecter les murs inclinés. Comparé aux 7 pipelines existants (A–G).</div>
        </div>

        {!sessionId&&(
          <div className="glass border-2 border-dashed border-white/15 rounded-2xl p-12 text-center hover:border-cyan-500/40 transition-all cursor-pointer mb-6" onClick={()=>fileRef.current?.click()} onDrop={(e)=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}} onDragOver={(e)=>e.preventDefault()}>
            {uploading?<Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3"/>:<Upload className="w-8 h-8 text-slate-500 mx-auto mb-3"/>}
            <p className="text-slate-300 font-medium mb-1">{uploading?"Chargement...":"Déposer un plan architectural"}</p>
            <p className="text-slate-600 text-sm">PDF, JPG, PNG — de préférence un plan avec des murs inclinés</p>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.webp" className="hidden" onChange={(e)=>{const f=e.target.files?.[0];if(f)handleFile(f);}}/>
          </div>
        )}

        {sessionId&&planB64&&!result&&(
          <div className="glass border border-white/10 rounded-2xl p-6 mb-6">
            <div className="flex items-start gap-6">
              <div className="flex-1"><img src={`data:image/png;base64,${planB64}`} className="rounded-xl border border-white/10 max-h-64 object-contain w-full" alt="plan"/></div>
              <div className="w-64 shrink-0">
                <h2 className="text-white font-semibold mb-2">Plan chargé ✓</h2>
                <p className="text-sm text-slate-400 mb-4">Lance la comparaison des 8 pipelines (A–H). Durée estimée : 3–8 minutes.</p>
                <Button onClick={runComparison} disabled={comparing} className="w-full">
                  {comparing?<><Loader2 className="w-4 h-4 animate-spin mr-2"/>Comparaison en cours...</>:<><BarChart3 className="w-4 h-4 mr-2"/>Lancer la comparaison</>}
                </Button>
                {comparing&&<p className="text-xs text-slate-500 text-center mt-2">Pipelines B, C, D, H en parallèle...</p>}
                <button onClick={()=>{setSessionId(null);setPlanB64(null);}} className="w-full mt-2 text-xs text-slate-600 hover:text-slate-400 transition-colors">Changer de plan</button>
              </div>
            </div>
          </div>
        )}

        {error&&<div className="glass border border-red-500/30 rounded-xl px-4 py-3 flex items-center gap-2 mb-6"><AlertTriangle className="w-4 h-4 text-red-400"/><p className="text-sm text-red-400">{error}</p></div>}

        {result&&planB64&&(
          <>
            <div className="glass border border-white/10 rounded-2xl p-4 mb-6 flex items-center gap-6">
              <div><p className="text-xs text-slate-500">Temps total</p><p className="text-xl font-700 text-white font-mono">{result.total_time_seconds}s</p></div>
              <div><p className="text-xs text-slate-500">Pipelines comparés</p><p className="text-xl font-700 text-white font-mono">{result.comparison_table.length}</p></div>
              <div className="flex-1"/>
              <Button variant="outline" size="sm" onClick={()=>{setResult(null);setSessionId(null);setPlanB64(null);}}>Nouveau plan</Button>
            </div>

            <div className="glass border border-white/10 rounded-2xl overflow-hidden mb-8">
              <button className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/5 transition-colors" onClick={()=>setShowTable(!showTable)}>
                <span className="text-sm font-semibold text-white flex items-center gap-2"><TrendingUp className="w-4 h-4 text-cyan-400"/>Tableau comparatif</span>
                {showTable?<ChevronUp className="w-4 h-4 text-slate-500"/>:<ChevronDown className="w-4 h-4 text-slate-500"/>}
              </button>
              {showTable&&(
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-t border-white/5 bg-white/[0.02]"><th className="text-left px-4 py-2.5 text-xs text-slate-500 font-600">Pipeline</th><th className="text-center px-3 py-2.5 text-xs text-slate-500 font-600">Portes</th><th className="text-center px-3 py-2.5 text-xs text-slate-500 font-600">Fenêtres</th><th className="text-center px-3 py-2.5 text-xs text-slate-500 font-600">Pièces</th><th className="text-right px-3 py-2.5 text-xs text-slate-500 font-600">Emprise m²</th><th className="text-right px-3 py-2.5 text-xs text-slate-500 font-600">Murs m²</th><th className="text-right px-3 py-2.5 text-xs text-slate-500 font-600">Hab. m²</th><th className="text-right px-3 py-2.5 text-xs text-slate-500 font-600">Temps</th><th className="text-center px-3 py-2.5 text-xs text-slate-500 font-600">Statut</th></tr></thead>
                    <tbody>
                      {result.comparison_table.map((row,i)=>(
                        <tr key={row.id} className={cn("border-t border-white/5",row.id==="H"?"bg-cyan-500/5":i%2===0?"bg-white/[0.01]":"")}>
                          <td className="px-4 py-2.5"><div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{background:row.color}}/><span className="text-white font-medium">{row.name}</span>{row.id==="H"&&<span className="text-[9px] bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 px-1 rounded uppercase font-semibold">NEW</span>}</div></td>
                          <td className="px-3 py-2.5 text-center font-mono text-slate-300">{row.doors}</td>
                          <td className="px-3 py-2.5 text-center font-mono text-slate-300">{row.windows}</td>
                          <td className="px-3 py-2.5 text-center font-mono text-slate-300">{row.rooms}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-300">{row.footprint_m2!=null?row.footprint_m2.toFixed(1):"—"}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-300">{row.walls_m2!=null?row.walls_m2.toFixed(1):"—"}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-white font-semibold">{row.hab_m2!=null?row.hab_m2.toFixed(1):"—"}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-500 text-xs">{row.time_s}s</td>
                          <td className="px-3 py-2.5 text-center">{row.error?<AlertTriangle className="w-3.5 h-3.5 text-red-400 mx-auto"/>:<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mx-auto"/>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <h2 className="text-white font-semibold mb-4 flex items-center gap-2"><Layers className="w-4 h-4 text-cyan-400"/>Détail par pipeline</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {gridOrder.filter(pid=>result.pipelines[pid]).map(pid=>(
                <PipelineCard key={pid} result={result.pipelines[pid]} planB64={planB64} isReference={pid==="A"}/>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
