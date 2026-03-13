"use client";

import { useState } from "react";
import { X, FileDown, Loader2 } from "lucide-react";
import type { AnalysisResult, CustomDetection } from "@/lib/types";
import { downloadRapportPdf, RapportOptions } from "@/lib/rapport-pdf";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { toast } from "@/components/ui/use-toast";

interface RapportDialogProps {
  result: AnalysisResult;
  customDetections: CustomDetection[];
  onClose: () => void;
}

export default function RapportDialog({ result, customDetections, onClose }: RapportDialogProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [projectName, setProjectName] = useState("");
  const [address, setAddress] = useState("");
  const [clientName, setClientName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const options: RapportOptions = {
        projectName: projectName || "Projet FloorScan",
        projectAddress: address,
        clientName,
        companyName,
        date: new Date().toLocaleDateString("fr-FR"),
        ceilingHeight: 2.5,
      };
      await downloadRapportPdf(result, customDetections, lang, options);
      toast({ title: "PDF rapport genere", variant: "success" });
      onClose();
    } catch (e: any) {
      toast({ title: "Erreur generation PDF", description: e.message, variant: "error" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative glass rounded-2xl border border-white/10 w-full max-w-md p-6 space-y-5 shadow-2xl">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div>
          <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
            <FileDown className="w-5 h-5 text-sky-400" />
            {d("rap_title" as DTKey)}
          </h3>
          <p className="text-xs text-slate-500 mt-1">{d("rap_cover_title" as DTKey)}</p>
        </div>

        {/* Form fields */}
        <div className="space-y-3">
          <Field
            label={d("rap_project" as DTKey)}
            value={projectName}
            onChange={setProjectName}
            placeholder="Ex: Renovation T3 Paris 11e"
          />
          <Field
            label={d("rap_address" as DTKey)}
            value={address}
            onChange={setAddress}
            placeholder="Ex: 12 rue de la Paix, 75002 Paris"
          />
          <Field
            label={d("rap_client" as DTKey)}
            value={clientName}
            onChange={setClientName}
            placeholder="Ex: M. Dupont"
          />
          <Field
            label={d("rap_company" as DTKey)}
            value={companyName}
            onChange={setCompanyName}
            placeholder="Ex: ABC Renovation SARL"
          />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{d("rap_date" as DTKey)} :</span>
            <span className="text-slate-300">{new Date().toLocaleDateString("fr-FR")}</span>
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-white font-semibold text-sm transition-colors"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {d("rap_generating" as DTKey)}
            </>
          ) : (
            <>
              <FileDown className="w-4 h-4" />
              {d("rap_generate" as DTKey)}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Simple field sub-component ── */
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 transition-colors"
      />
    </div>
  );
}
