"use client";

import { BACKEND } from "@/lib/backend";
import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ScanLine, ArrowLeft, BrainCircuit, PenLine, Building2,
  History, X, AlertTriangle, Check,
  KeyRound, Upload, Crop, Ruler, Brain, BarChart3, PenSquare,
  GitCompare, FileSearch, Loader2, ClipboardList,
} from "lucide-react";
import Stepper from "@/components/demo/stepper";
import ConnectStep from "@/components/demo/connect-step";
import UploadStep from "@/components/demo/upload-step";
import CropStep from "@/components/demo/crop-step";
import ScaleStep from "@/components/demo/scale-step";
import AnalyzeStep from "@/components/demo/analyze-step";
import ResultsStep from "@/components/demo/results-step";
import EditorStep from "@/components/demo/editor-step";
import FacadeAnalyzeStep from "@/components/facade/facade-analyze-step";
import FacadeResultsStep from "@/components/facade/facade-results-step";
import FacadeEditorStep from "@/components/facade/facade-editor-step";
import DiffViewStep from "@/components/diff/diff-view-step";
import CartoucheResultStep from "@/components/cartouche/cartouche-result-step";
import MeasureClient from "@/app/measure/measure-client";
import ChantierModule from "@/components/chantier/chantier-module";
import ChatPanel from "@/components/demo/chat-panel";
import LangSwitcher from "@/components/ui/lang-switcher";
import ThemeSwitcher from "@/components/ui/theme-switcher";
import { RoboflowConfig, AnalysisResult, CustomDetection, FacadeAnalysisResult, DiffResult, CartoucheResult } from "@/lib/types";
import type { FacadeZoneCrop, CropBox } from "@/components/demo/crop-step";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/use-auth";

const DEFAULT_CONFIG: RoboflowConfig = { apiKey: "tyCM9PZp8cs3KtifPUaQ", modelName: "cubicasa5k-2-qpmsa-1gd2e/1" };
const SESSION_STORAGE_KEY = "floorscan_ia_session_v1";

interface SavedSession { step: number; demoMode: "ia"|"measure"|"facade"; config: RoboflowConfig|null; sessionId: string|null; uploadedImageB64: string|null; ppm: number|null; analysisResult: AnalysisResult|null; savedAt: number; }

function saveSession(data: Omit<SavedSession,"savedAt">) { try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({...data,uploadedImageB64:null,savedAt:Date.now()})); } catch {} }
function loadSession(): SavedSession|null { try { const raw=localStorage.getItem(SESSION_STORAGE_KEY); if(!raw)return null; const p:SavedSession=JSON.parse(raw); if(Date.now()-p.savedAt>2*60*60*1000){localStorage.removeItem(SESSION_STORAGE_KEY);return null;} if(!p.analysisResult)return null; return p; } catch{return null;} }
function clearSession() { try{localStorage.removeItem(SESSION_STORAGE_KEY);}catch{} }

const FACADE_STEP_ICONS=[KeyRound,Upload,Crop,Ruler,Brain,BarChart3,PenSquare];
const FACADE_STEP_KEYS:DTKey[]=["fa_st_connect","fa_st_upload","fa_st_crop","fa_st_scale","fa_st_analyze","fa_st_results","fa_st_editor"];

function FacadeStepper({currentStep,lang,onStepClick}:{currentStep:number;lang:string;onStepClick?:(step:number)=>void}) {
  const d=(key:DTKey)=>dt(key,lang as any);
  return (
    <div className="flex items-center w-full max-w-3xl mx-auto">
      {FACADE_STEP_ICONS.map((Icon,index)=>{const sn=index+1;const isActive=sn===currentStep;const isDone=sn<currentStep;const isLast=index===FACADE_STEP_ICONS.length-1;const isClickable=isDone&&!!onStepClick;return(<div key={index} className="flex items-center flex-1"><div className={cn("flex flex-col items-center gap-1.5 flex-shrink-0",isClickable&&"cursor-pointer")} onClick={isClickable?()=>onStepClick(sn):undefined}><div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-600 font-display transition-all duration-300",isActive&&"step-active text-white",isDone&&"step-done text-accent-green",!isActive&&!isDone&&"step-inactive text-slate-500")}>{isDone?<Check className="w-3.5 h-3.5"/>:<Icon className="w-3.5 h-3.5"/>}</div><span className={cn("text-xs font-medium transition-colors hidden sm:block",isActive&&"text-white",isDone&&"text-accent-green",!isActive&&!isDone&&"text-slate-600")}>{d(FACADE_STEP_KEYS[index])}</span></div>{!isLast&&<div className={cn("flex-1 h-px mx-2 transition-colors duration-300 -mt-5 sm:-mt-5",isDone?"bg-accent-green/40":"bg-white/5")}/>}</div>);})}
    </div>
  );
}

export default function DemoClient() {
  const {lang}=useLang();
  const d=(key:DTKey)=>dt(key,lang);
  const {isAdmin}=useAuth();
  const [step,setStep]=useState(1);
  const [demoMode,setDemoMode]=useState<null|"ia"|"measure"|"facade"|"diff"|"cartouche"|"chantier">(null);
  const STEP_TITLES=isAdmin?[d("st_connect"),d("st_upload"),d("st_crop"),d("st_scale"),d("st_analyze"),d("st_results"),d("st_editor")]:[d("st_upload"),d("st_crop"),d("st_scale"),d("st_analyze"),d("st_results"),d("st_editor")];
  const [config,setConfig]=useState<RoboflowConfig|null>(isAdmin?null:DEFAULT_CONFIG);
  const [sessionId,setSessionId]=useState<string|null>(null);
  const [uploadedImageB64,setUploadedImageB64]=useState<string|null>(null);
  const [ppm,setPpm]=useState<number|null>(null);
  const [analysisResult,setAnalysisResult]=useState<AnalysisResult|null>(null);
  const [savedPdfData,setSavedPdfData]=useState<{pdfBase64:string;fileName:string;pageCount:number}|null>(null);
  const [pageResults,setPageResults]=useState<Map<number,{ppm:number|null;analysisResult:AnalysisResult;customDetections:CustomDetection[]}>>(new Map());
  const [currentPageIdx,setCurrentPageIdx]=useState<number>(0);
  const [customDetections,setCustomDetections]=useState<CustomDetection[]>([]);
  const [cropRect,setCropRect]=useState<{x:number;y:number;w:number;h:number}|null>(null);
  const [facadeResult,setFacadeResult]=useState<FacadeAnalysisResult|null>(null);
  const [facadeZones,setFacadeZones]=useState<FacadeZoneCrop[]>([]);
  const [measurementData,setMeasurementData]=useState<any>(null);
  const [v1SessionId,setV1SessionId]=useState<string|null>(null);
  const [v1ImageB64,setV1ImageB64]=useState<string|null>(null);
  const [v2SessionId,setV2SessionId]=useState<string|null>(null);
  const [v2ImageB64,setV2ImageB64]=useState<string|null>(null);
  const [diffResult,setDiffResult]=useState<DiffResult|null>(null);
  const [diffLoading,setDiffLoading]=useState(false);
  const [cartoucheResult,setCartoucheResult]=useState<CartoucheResult|null>(null);
  const [cartoucheLoading,setCartoucheLoading]=useState(false);
  const [restoredSession,setRestoredSession]=useState<SavedSession|null>(null);
  const [showRestoreBanner,setShowRestoreBanner]=useState(false);

  const selectIaMode=()=>{setDemoMode("ia");if(!isAdmin){setConfig(DEFAULT_CONFIG);setStep(2);}};

  useEffect(()=>{const saved=loadSession();if(saved){setRestoredSession(saved);setShowRestoreBanner(true);}},[]);
  useEffect(()=>{if(demoMode==="ia"&&(analysisResult||step>5))saveSession({step,demoMode,config,sessionId,uploadedImageB64,ppm,analysisResult});},[step,demoMode,config,sessionId,ppm,analysisResult]);
  useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(demoMode&&(sessionId||analysisResult||facadeResult))e.preventDefault();};window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);},[demoMode,sessionId,analysisResult,facadeResult]);

  const handleRestoreSession=()=>{if(!restoredSession)return;setConfig(restoredSession.config);setSessionId(restoredSession.sessionId);setPpm(restoredSession.ppm);setAnalysisResult(restoredSession.analysisResult);setStep(restoredSession.analysisResult?6:Math.min(restoredSession.step,5));selectIaMode();setShowRestoreBanner(false);setRestoredSession(null);};
  const handleConnected=(cfg:RoboflowConfig)=>{setConfig(cfg);setStep(2);};
  const handlePdfMetadata=(data:{pdfBase64:string;fileName:string;pageCount:number})=>setSavedPdfData(data);
  const handleUploaded=(sid:string,imgB64:string)=>{setSessionId(sid);setUploadedImageB64(imgB64);setStep(3);};
  const handleCropped=(cropBox?: CropBox)=>{
    if(cropBox && demoMode==="facade" && facadeZones.length>0){
      const {x0,y0,x1,y1,imgW,imgH}=cropBox;
      const cw=x1-x0, ch=y1-y0;
      if(cw>0&&ch>0){
        setFacadeZones(prev=>prev.map(z=>({...z,pts:z.pts.map(p=>({
          x:Math.max(0,Math.min(1,(p.x*imgW-x0)/cw)),
          y:Math.max(0,Math.min(1,(p.y*imgH-y0)/ch)),
        }))})));
      }
    }
    // Store crop rect for admin full-plan overlay
    if(cropBox){
      const {x0,y0,x1,y1,imgW,imgH}=cropBox;
      if(imgW>0&&imgH>0) setCropRect({x:x0/imgW, y:y0/imgH, w:(x1-x0)/imgW, h:(y1-y0)/imgH});
    }
    setStep(4);
  };
  const handleScaled=(value:number|null)=>{setPpm(value);setStep(5);};
  const handleAnalyzed=(result:AnalysisResult)=>{setAnalysisResult(result);if(savedPdfData)setPageResults(prev=>{const next=new Map(prev);next.set(currentPageIdx,{ppm,analysisResult:result,customDetections:[]});return next;});setStep(6);};
  const handleGoEditor=()=>setStep(7);
  const handleStepClick=(targetStep:number)=>{if(targetStep<step)setStep(targetStep);};
  const handleBack=()=>{if(step>(isAdmin?1:2))setStep(step-1);};
  const handleGoResults=(updatedResult:AnalysisResult,detections?:CustomDetection[])=>{setAnalysisResult(updatedResult);if(detections)setCustomDetections(detections);setStep(6);};
  const handleAddPage=()=>{if(analysisResult)setPageResults(prev=>{const next=new Map(prev);next.set(currentPageIdx,{ppm,analysisResult,customDetections});return next;});setStep(2);setSessionId(null);setUploadedImageB64(null);setPpm(null);setAnalysisResult(null);setCustomDetections([]);};
  const handleSwitchPage=(pageIdx:number)=>{if(analysisResult)setPageResults(prev=>{const next=new Map(prev);next.set(currentPageIdx,{ppm,analysisResult,customDetections});return next;});const target=pageResults.get(pageIdx);if(target){setCurrentPageIdx(pageIdx);setPpm(target.ppm);setAnalysisResult(target.analysisResult);setCustomDetections(target.customDetections);}};
  const handleRestart=()=>{setStep(isAdmin?1:2);setSessionId(null);setUploadedImageB64(null);setPpm(null);setAnalysisResult(null);setFacadeResult(null);setFacadeZones([]);setV1SessionId(null);setV1ImageB64(null);setV2SessionId(null);setV2ImageB64(null);setDiffResult(null);setDiffLoading(false);setCartoucheResult(null);setCartoucheLoading(false);clearSession();};
  const handleFullReset=()=>{setStep(1);setConfig(isAdmin?null:DEFAULT_CONFIG);setSessionId(null);setUploadedImageB64(null);setPpm(null);setAnalysisResult(null);setFacadeResult(null);setFacadeZones([]);setV1SessionId(null);setV1ImageB64(null);setV2SessionId(null);setV2ImageB64(null);setDiffResult(null);setDiffLoading(false);setCartoucheResult(null);setCartoucheLoading(false);clearSession();};
  const handleFacadeAnalyzed=(result:FacadeAnalysisResult)=>{setFacadeResult(result);setStep(6);};
  const handleFacadeGoEditor=()=>setStep(7);
  const handleFacadeGoResults=(updatedResult:FacadeAnalysisResult)=>{setFacadeResult(updatedResult);setStep(6);};
  const handleDiffV1Uploaded=(sid:string,imgB64:string)=>{setV1SessionId(sid);setV1ImageB64(imgB64);setStep(2);};
  const handleDiffV2Uploaded=async(sid:string,imgB64:string)=>{setV2SessionId(sid);setV2ImageB64(imgB64);setDiffLoading(true);setStep(3);try{const res=await fetch(`${BACKEND}/diff-plans`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id_v1:v1SessionId,session_id_v2:sid})});if(!res.ok)throw new Error();setDiffResult(await res.json());}catch{setDiffResult({session_id_v1:v1SessionId!,session_id_v2:sid,aligned_v1_b64:v1ImageB64!,aligned_v2_b64:imgB64,diff_overlay_b64:v1ImageB64!,diff_stats:{changed_pixels_pct:0,added_area_pct:0,removed_area_pct:0}});}finally{setDiffLoading(false);}};
  const handleCartoucheUploaded=async(sid:string,imgB64:string)=>{setSessionId(sid);setUploadedImageB64(imgB64);setCartoucheLoading(true);setStep(2);try{const res=await fetch(`${BACKEND}/extract-cartouche`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:sid})});if(!res.ok)throw new Error();setCartoucheResult(await res.json());}catch{setCartoucheResult({session_id:sid,cartouche_bbox_norm:null,cartouche_b64:null,fields:[{key:"project_name",label_fr:"Nom du projet",value:"",confidence:0},{key:"architect",label_fr:"Architecte",value:"",confidence:0},{key:"scale",label_fr:"Échelle",value:"",confidence:0},{key:"date",label_fr:"Date",value:"",confidence:0},{key:"plan_number",label_fr:"N° de plan",value:"",confidence:0},{key:"revision",label_fr:"Révision",value:"",confidence:0}],raw_text:"(Backend non disponible)",plan_b64:imgB64});}finally{setCartoucheLoading(false);}};

  return (
    <div className="min-h-screen bg-ink">
      <div className="border-b border-white/5 glass sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center"><ScanLine className="w-3.5 h-3.5 text-white"/></div>
            <span className="font-display font-700 text-base text-white">Floor<span className="text-gradient">Scan</span></span>
          </Link>
          <div className="flex items-center gap-2"><ThemeSwitcher/><LangSwitcher/></div>
          {demoMode!==null&&(
            <div className="flex items-center gap-1 glass border border-white/10 rounded-xl p-1">
              {([{key:"ia",icon:BrainCircuit,label:d("sel_ia_title"),active:"bg-accent",adminOnly:false},{key:"measure",icon:PenLine,label:d("sel_met_title"),active:"bg-accent",adminOnly:false},{key:"chantier",icon:ClipboardList,label:"Chantier",active:"bg-orange-600",adminOnly:false},{key:"facade",icon:Building2,label:d("sel_fa_title"),active:"bg-amber-600",adminOnly:false},{key:"diff",icon:GitCompare,label:d("sel_di_title"),active:"bg-teal-600",adminOnly:true},{key:"cartouche",icon:FileSearch,label:d("sel_ca_title"),active:"bg-violet-600",adminOnly:true}] as const).filter(({adminOnly})=>!adminOnly||isAdmin).map(({key,icon:Icon,label,active})=>(
                <button key={key} onClick={()=>key==="ia"?selectIaMode():setDemoMode(key as any)} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",demoMode===key?`${active} text-white shadow-sm`:"text-slate-400 hover:text-white")}>
                  <Icon className="w-3.5 h-3.5"/><span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          )}
          {demoMode===null?<Link href="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"><ArrowLeft className="w-4 h-4"/>{d("bar_back")}</Link>:<button onClick={()=>{setDemoMode(null);handleFullReset();}} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"><ArrowLeft className="w-4 h-4"/>{d("sel_change")}</button>}
        </div>
      </div>

      {demoMode==="chantier"&&<div className="bg-orange-500/10 border-b border-orange-500/20"><div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-2.5 text-sm"><AlertTriangle className="w-4 h-4 text-orange-400 shrink-0"/><span className="text-orange-300/90">Module Suivi de chantier — WIP · Données sauvegardées localement</span></div></div>}
      {demoMode==="facade"&&<div className="bg-amber-500/10 border-b border-amber-500/20"><div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-2.5 text-sm"><AlertTriangle className="w-4 h-4 text-amber-400 shrink-0"/><span className="text-amber-300/90">{d("fa_mock_warn")}</span></div></div>}
      {demoMode==="diff"&&<div className="bg-teal-500/10 border-b border-teal-500/20"><div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-2.5 text-sm"><AlertTriangle className="w-4 h-4 text-teal-400 shrink-0"/><span className="text-teal-300/90">{d("di_mock_warn")}</span></div></div>}
      {demoMode==="cartouche"&&<div className="bg-violet-500/10 border-b border-violet-500/20"><div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-2.5 text-sm"><AlertTriangle className="w-4 h-4 text-violet-400 shrink-0"/><span className="text-violet-300/90">{d("ca_mock_warn")}</span></div></div>}

      <AnimatePresence>{showRestoreBanner&&restoredSession&&(<motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="bg-accent/10 border-b border-accent/20"><div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4"><div className="flex items-center gap-2.5 text-sm"><History className="w-4 h-4 text-accent shrink-0"/><span className="text-slate-300">{d("restore_found")} <span className="text-slate-500 text-xs">({new Date(restoredSession.savedAt).toLocaleTimeString(lang==="fr"?"fr-FR":"en-GB",{hour:"2-digit",minute:"2-digit"})})</span>{restoredSession.analysisResult&&<span className="ml-1 text-slate-400">· {restoredSession.analysisResult.doors_count} {d("restore_doors")}, {restoredSession.analysisResult.windows_count} {d("restore_windows")}</span>}</span></div><div className="flex items-center gap-2 shrink-0"><button onClick={handleRestoreSession} className="px-3 py-1.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-xs font-600 transition-colors">{d("restore_resume")}</button><button onClick={()=>{setShowRestoreBanner(false);clearSession();}} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"><X className="w-4 h-4"/></button></div></div></motion.div>)}</AnimatePresence>

      <div className="max-w-7xl mx-auto px-6 py-10">
        <AnimatePresence mode="wait">

          {demoMode===null&&(
            <motion.div key="select" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-12}} transition={{duration:0.25}}>
              <div className="text-center mb-12"><h1 className="font-display text-4xl font-700 text-white mb-3">{d("sel_title")}</h1><p className="text-slate-400 text-lg max-w-lg mx-auto">{d("sel_sub")}</p></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">

                <button onClick={selectIaMode} className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-accent/40 hover:bg-accent/5 transition-all duration-300 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl"/>
                  <div className="relative"><div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-brand-600 flex items-center justify-center mb-6 shadow-glow-sm group-hover:shadow-glow transition-shadow"><BrainCircuit className="w-7 h-7 text-white"/></div><h2 className="font-display text-2xl font-700 text-white mb-3">{d("sel_ia_title")}</h2><p className="text-slate-400 text-sm leading-relaxed mb-6">{d("sel_ia_desc")}</p><div className="flex flex-wrap gap-2 mb-6">{["PDF → Image",d("st_crop"),"Auto scale","AI detection",d("st_editor")].map(tag=><span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">{tag}</span>)}</div><div className="flex items-center gap-2 text-accent text-sm font-medium group-hover:gap-3 transition-all">{d("sel_start")} <ArrowLeft className="w-4 h-4 rotate-180"/></div></div>
                </button>

                <button onClick={()=>setDemoMode("measure")} className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-brand-400/40 hover:bg-brand-400/5 transition-all duration-300 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-brand-400/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl"/>
                  <div className="relative"><div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center mb-6 shadow-glow-sm group-hover:shadow-glow transition-shadow"><PenLine className="w-7 h-7 text-white"/></div><h2 className="font-display text-2xl font-700 text-white mb-3">{d("sel_met_title")}</h2><p className="text-slate-400 text-sm leading-relaxed mb-6">{d("sel_met_desc")}</p><div className="flex flex-wrap gap-2 mb-6">{[d("me_feat1"),d("me_feat2"),"Polygon & Rect","Surface types","Export CSV"].map(tag=><span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">{tag}</span>)}</div><div className="flex items-center gap-2 text-brand-400 text-sm font-medium group-hover:gap-3 transition-all">{d("sel_start")} <ArrowLeft className="w-4 h-4 rotate-180"/></div></div>
                </button>

                <button onClick={()=>setDemoMode("chantier")} className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-orange-500/40 hover:bg-orange-500/5 transition-all duration-300 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl"/>
                  <div className="relative"><div className="flex items-center gap-3 mb-6"><div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-shadow"><ClipboardList className="w-7 h-7 text-white"/></div><span className="text-[10px] bg-orange-500/20 border border-orange-500/30 rounded px-1.5 py-0.5 font-semibold text-orange-400 leading-none uppercase tracking-wider">WIP</span></div><h2 className="font-display text-2xl font-700 text-white mb-3">Suivi de chantier</h2><p className="text-slate-400 text-sm leading-relaxed mb-6">Avancement · Inventaire · Réserves · Planning · Budget · Documents</p><div className="flex flex-wrap gap-2 mb-6">{["Par pièce","Portes & fenêtres IA","Gantt","Budget","Documents"].map(tag=><span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">{tag}</span>)}</div><div className="flex items-center gap-2 text-orange-400 text-sm font-medium group-hover:gap-3 transition-all">{d("sel_start")} <ArrowLeft className="w-4 h-4 rotate-180"/></div></div>
                </button>

                <button onClick={()=>setDemoMode("facade")} className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-amber-500/40 hover:bg-amber-500/5 transition-all duration-300 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl"/>
                  <div className="relative"><div className="flex items-center gap-3 mb-6"><div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-shadow"><Building2 className="w-7 h-7 text-white"/></div><span className="text-[10px] bg-amber-500/20 border border-amber-500/30 rounded px-1.5 py-0.5 font-semibold text-amber-400 leading-none uppercase tracking-wider">{d("fa_wip")}</span></div><h2 className="font-display text-2xl font-700 text-white mb-3">{d("sel_fa_title")}</h2><p className="text-slate-400 text-sm leading-relaxed mb-6">{d("sel_fa_desc")}</p><div className="flex flex-wrap gap-2 mb-6">{[d("fa_windows"),d("fa_doors"),d("fa_balconies"),d("fa_floors"),"Export CSV"].map(tag=><span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">{tag}</span>)}</div><div className="flex items-center gap-2 text-amber-400 text-sm font-medium group-hover:gap-3 transition-all">{d("sel_start")} <ArrowLeft className="w-4 h-4 rotate-180"/></div></div>
                </button>

                {isAdmin&&(<button onClick={()=>setDemoMode("diff")} className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-teal-500/40 hover:bg-teal-500/5 transition-all duration-300 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl"/>
                  <div className="relative"><div className="flex items-center gap-3 mb-6"><div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-shadow"><GitCompare className="w-7 h-7 text-white"/></div><span className="text-[10px] bg-teal-500/20 border border-teal-500/30 rounded px-1.5 py-0.5 font-semibold text-teal-400 leading-none uppercase tracking-wider">{d("fa_wip")}</span></div><h2 className="font-display text-2xl font-700 text-white mb-3">{d("sel_di_title")}</h2><p className="text-slate-400 text-sm leading-relaxed mb-6">{d("sel_di_desc")}</p><div className="flex flex-wrap gap-2 mb-6">{["PDF, JPG, PNG",d("di_side"),d("di_overlay"),d("di_diff"),"Export PNG"].map(tag=><span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">{tag}</span>)}</div><div className="flex items-center gap-2 text-teal-400 text-sm font-medium group-hover:gap-3 transition-all">{d("sel_start")} <ArrowLeft className="w-4 h-4 rotate-180"/></div></div>
                </button>)}

                {isAdmin&&(<button onClick={()=>setDemoMode("cartouche")} className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-violet-500/40 hover:bg-violet-500/5 transition-all duration-300 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl"/>
                  <div className="relative"><div className="flex items-center gap-3 mb-6"><div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-shadow"><FileSearch className="w-7 h-7 text-white"/></div><span className="text-[10px] bg-violet-500/20 border border-violet-500/30 rounded px-1.5 py-0.5 font-semibold text-violet-400 leading-none uppercase tracking-wider">{d("fa_wip")}</span></div><h2 className="font-display text-2xl font-700 text-white mb-3">{d("sel_ca_title")}</h2><p className="text-slate-400 text-sm leading-relaxed mb-6">{d("sel_ca_desc")}</p><div className="flex flex-wrap gap-2 mb-6">{["PDF, JPG, PNG","OCR",d("ca_fields"),"JSON",d("ca_copy")].map(tag=><span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">{tag}</span>)}</div><div className="flex items-center gap-2 text-violet-400 text-sm font-medium group-hover:gap-3 transition-all">{d("sel_start")} <ArrowLeft className="w-4 h-4 rotate-180"/></div></div>
                </button>)}

              </div>
            </motion.div>
          )}

          {demoMode==="measure"&&(<motion.div key="measure" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:0.2}}><MeasureClient embedded/></motion.div>)}

          {demoMode==="chantier"&&(
            <motion.div key="chantier" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:0.2}}>
              <ChantierModule
                rooms={analysisResult?.rooms}
                openings={analysisResult?.openings}
                imgWidth={analysisResult?.img_w}
                imgHeight={analysisResult?.img_h}
                planB64={analysisResult?.plan_b64??uploadedImageB64}
                planMime="image/png"
                sessionId={sessionId}
                pixelsPerMeter={ppm??analysisResult?.pixels_per_meter}
              />
            </motion.div>
          )}

          {demoMode==="ia"&&(
            <motion.div key="ia" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:0.2}}>
              <div className="mb-10"><Stepper currentStep={step} totalSteps={STEP_TITLES.length} skipConnect={!isAdmin} onStepClick={handleStepClick}/></div>
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-10}} transition={{duration:0.25}}>
                  {step===1&&isAdmin&&<ConnectStep onConnected={handleConnected}/>}
                  {step===2&&<UploadStep onUploaded={handleUploaded} onPdfMetadata={handlePdfMetadata} onPageSelected={setCurrentPageIdx} initialPdfData={savedPdfData??undefined} analyzedPages={[...pageResults.keys()]}/>}
                  {step===3&&sessionId&&<CropStep sessionId={sessionId} imageB64={uploadedImageB64!} onCropped={handleCropped} onSkip={handleCropped} onSessionExpired={handleRestart} onBack={handleBack}/>}
                  {step===4&&<ScaleStep imageB64={uploadedImageB64!} onScaled={handleScaled} onBack={handleBack}/>}
                  {step===5&&sessionId&&config&&<AnalyzeStep sessionId={sessionId} config={config} ppm={ppm} onAnalyzed={handleAnalyzed} onSessionExpired={handleRestart} onBack={handleBack}/>}
                  {step===6&&analysisResult&&<ResultsStep result={analysisResult} customDetections={customDetections} onDetectionsChange={setCustomDetections} onGoEditor={handleGoEditor} onGoChantier={() => setDemoMode("chantier")} onRestart={handleRestart} pageCount={savedPdfData?.pageCount} currentPage={savedPdfData?currentPageIdx:undefined} onSwitchPage={savedPdfData&&pageResults.size>1?handleSwitchPage:undefined} analyzedPages={savedPdfData?[...pageResults.keys()]:undefined} onAddPage={savedPdfData?handleAddPage:undefined}/>}
                  {step===7&&analysisResult&&sessionId&&<EditorStep sessionId={sessionId} initialResult={analysisResult} initialCustomDetections={customDetections} onRestart={handleRestart} onSessionExpired={handleRestart} onAddPage={savedPdfData?handleAddPage:undefined} onGoResults={handleGoResults} onMeasurementDataChange={setMeasurementData} originalImageB64={uploadedImageB64} cropRect={cropRect}/>}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}

          {demoMode==="diff"&&(
            <motion.div key="diff" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:0.2}}>
              <div className="flex items-center justify-center gap-4 mb-10">
                {[{icon:Upload,label:d("di_st_upload_v1")},{icon:Upload,label:d("di_st_upload_v2")},{icon:GitCompare,label:d("di_st_compare")}].map((s,i)=>{const sNum=i+1;const isActive=step===sNum;const isDone=step>sNum;return(<div key={i} className="flex items-center gap-3"><div className="flex flex-col items-center gap-1.5"><div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-600 transition-all",isActive&&"bg-teal-500 text-white shadow-md",isDone&&"bg-teal-500/20 text-teal-400",!isActive&&!isDone&&"bg-white/5 text-slate-500")}>{isDone?<Check className="w-3.5 h-3.5"/>:<s.icon className="w-3.5 h-3.5"/>}</div><span className={cn("text-xs font-medium hidden sm:block",isActive?"text-white":isDone?"text-teal-400":"text-slate-600")}>{s.label}</span></div>{i<2&&<div className={cn("w-12 h-px -mt-5",isDone?"bg-teal-500/40":"bg-white/5")}/>}</div>);})}
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-10}} transition={{duration:0.25}}>
                  {step===1&&<UploadStep titleOverride={d("di_upload_v1_title")} subtitleOverride={d("di_upload_v1_sub")} onUploaded={handleDiffV1Uploaded}/>}
                  {step===2&&<UploadStep titleOverride={d("di_upload_v2_title")} subtitleOverride={d("di_upload_v2_sub")} onUploaded={handleDiffV2Uploaded}/>}
                  {step===3&&diffLoading&&<div className="flex flex-col items-center justify-center py-20 gap-4"><Loader2 className="w-8 h-8 text-teal-400 animate-spin"/><p className="text-slate-400 text-sm">{d("di_analyzing")}</p></div>}
                  {step===3&&!diffLoading&&diffResult&&v1ImageB64&&v2ImageB64&&<DiffViewStep result={diffResult} v1ImageB64={v1ImageB64} v2ImageB64={v2ImageB64} onRestart={handleRestart}/>}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}

          {demoMode==="cartouche"&&(
            <motion.div key="cartouche" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:0.2}}>
              <div className="flex items-center justify-center gap-4 mb-10">
                {[{icon:Upload,label:d("ca_st_upload")},{icon:FileSearch,label:d("ca_st_results")}].map((s,i)=>{const sNum=i+1;const isActive=step===sNum;const isDone=step>sNum;return(<div key={i} className="flex items-center gap-3"><div className="flex flex-col items-center gap-1.5"><div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-600 transition-all",isActive&&"bg-violet-500 text-white shadow-md",isDone&&"bg-violet-500/20 text-violet-400",!isActive&&!isDone&&"bg-white/5 text-slate-500")}>{isDone?<Check className="w-3.5 h-3.5"/>:<s.icon className="w-3.5 h-3.5"/>}</div><span className={cn("text-xs font-medium hidden sm:block",isActive?"text-white":isDone?"text-violet-400":"text-slate-600")}>{s.label}</span></div>{i<1&&<div className={cn("w-12 h-px -mt-5",isDone?"bg-violet-500/40":"bg-white/5")}/>}</div>);})}
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-10}} transition={{duration:0.25}}>
                  {step===1&&<UploadStep onUploaded={handleCartoucheUploaded}/>}
                  {step===2&&cartoucheLoading&&<div className="flex flex-col items-center justify-center py-20 gap-4"><Loader2 className="w-8 h-8 text-violet-400 animate-spin"/><p className="text-slate-400 text-sm">{d("ca_analyzing")}</p></div>}
                  {step===2&&!cartoucheLoading&&cartoucheResult&&<CartoucheResultStep result={cartoucheResult} onRestart={handleRestart}/>}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}

          {demoMode==="facade"&&(
            <motion.div key="facade" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:0.2}}>
              <div className="mb-10"><FacadeStepper currentStep={step} lang={lang} onStepClick={handleStepClick}/></div>
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-10}} transition={{duration:0.25}}>
                  {step===1&&<ConnectStep onConnected={handleConnected}/>}
                  {step===2&&<UploadStep onUploaded={handleUploaded}/>}
                  {step===3&&sessionId&&<CropStep sessionId={sessionId} imageB64={uploadedImageB64!} onCropped={(cropBox)=>{if(facadeZones.length===0){toast({title:d("fa_zone_required"),variant:"error"});return;}handleCropped(cropBox);}} onSkip={()=>{if(facadeZones.length===0){toast({title:d("fa_zone_required"),variant:"error"});return;}handleCropped();}} onSessionExpired={handleRestart} onBack={handleBack} showFacadeDelimitation initialFacadeZones={facadeZones} onFacadeZonesChange={setFacadeZones}/>}
                  {step===4&&<ScaleStep imageB64={uploadedImageB64!} onScaled={handleScaled} onBack={handleBack}/>}
                  {step===5&&sessionId&&uploadedImageB64&&config&&<FacadeAnalyzeStep sessionId={sessionId} imageB64={uploadedImageB64} apiKey={config.apiKey} ppm={ppm} onAnalyzed={handleFacadeAnalyzed} onBack={handleBack}/>}
                  {step===6&&facadeResult&&<FacadeResultsStep result={facadeResult} onGoEditor={handleFacadeGoEditor} onRestart={handleRestart} onBack={()=>setStep(5)} initialFacadeZones={facadeZones}/>}
                  {step===7&&facadeResult&&<FacadeEditorStep result={facadeResult} onGoResults={handleFacadeGoResults} onRestart={handleRestart} initialFacadeZones={facadeZones}/>}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <div className="fixed inset-0 pointer-events-none -z-10"><div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 bg-gradient-to-b from-brand-900/10 to-transparent"/><div className="absolute inset-0 bg-grid-pattern bg-grid-size opacity-30"/></div>

      {demoMode&&demoMode!=="chantier"&&<ChatPanel result={demoMode==="facade"?null:analysisResult} facadeResult={demoMode==="facade"?facadeResult:null} currentStep={step} autoOpen={demoMode==="ia"||demoMode==="measure"} measurementData={measurementData}/>}
    </div>
  );
}
