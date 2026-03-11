"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Link2, ArrowRight, CheckCircle2, XCircle, Loader2, Eye, EyeOff, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoboflowConfig } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

interface ConnectStepProps {
  onConnected: (config: RoboflowConfig) => void;
}

type Status = "idle" | "testing" | "ok" | "error";

export default function ConnectStep({ onConnected }: ConnectStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const [apiKey, setApiKey] = useState("Kh56ukn5foPflRVreiNOM");
  const [modelId, setModelId] = useState("cubicasa5k-2-qpmsa-1gd2e/1");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");

  const canTest = apiKey.trim() !== "" && modelId.trim() !== "";

  /** Parse "workspace/model-slug/version" ou "model-slug/version" → { modelName, version } */
  const parseModel = (raw: string): { modelName: string; version: number } | null => {
    const parts = raw.trim().split("/");
    if (parts.length < 2) return null;
    const version = parseInt(parts[parts.length - 1], 10);
    if (isNaN(version) || version < 1) return null;
    const modelName = parts.slice(0, -1).join("/");
    return { modelName, version };
  };

  const handleTest = async () => {
    setStatus("testing");
    const parsed = parseModel(modelId);
    if (!parsed) {
      setStatus("error");
      setMsg("Format de Model ID invalide. Attendu : workspace/model/version");
      return;
    }
    try {
      const r = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          modelName: parsed.modelName,
          modelVersion: parsed.version,
        }),
      });
      const data = await r.json();
      if (data.ok) {
        setStatus("ok");
        const name = data.model?.name ?? parsed.modelName;
        const classes = data.model?.classes?.length
          ? ` · ${data.model.classes.length} classes`
          : "";
        setMsg(`Connexion OK · ${name} v${parsed.version}${classes}`);
      } else {
        throw new Error(data.error ?? "Erreur inconnue");
      }
    } catch (e: any) {
      setStatus("error");
      setMsg(e.message || dt("co_err", lang));
    }
  };

  const handleContinue = () => {
    onConnected({ apiKey: apiKey.trim(), modelName: modelId.trim() });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-lg mx-auto">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center mx-auto mb-4 shadow-glow">
          <KeyRound className="w-7 h-7 text-white" />
        </div>
        <h2 className="font-display text-2xl font-700 text-white mb-2">{d("co_title")}</h2>
        <p className="text-slate-400 text-sm">{d("co_sub")}</p>
      </div>

      <div className="glass rounded-2xl border border-white/10 p-6 flex flex-col gap-5">
        {/* API Key */}
        <div>
          <label className="block text-xs font-600 text-slate-400 uppercase tracking-wide mb-2">
            <KeyRound className="inline w-3.5 h-3.5 mr-1 -mt-0.5" /> {d("co_key")}
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setStatus("idle"); }}
              placeholder="rf_••••••••••••••••••••••"
              className="w-full bg-ink border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-accent/50 pr-12"
            />
            <button type="button" onClick={() => setShowKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-1.5">{d("co_key_hint")}</p>
        </div>

        {/* Model ID */}
        <div>
          <label className="block text-xs font-600 text-slate-400 uppercase tracking-wide mb-2">
            <Link2 className="inline w-3.5 h-3.5 mr-1 -mt-0.5" /> Model ID
          </label>
          <input
            type="text"
            value={modelId}
            onChange={(e) => { setModelId(e.target.value); setStatus("idle"); }}
            placeholder="workspace/model-slug/version"
            className="w-full bg-ink border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-accent/50 font-mono"
          />
          <p className="text-xs text-slate-600 mt-1.5">
            Format : <code className="text-slate-500">workspace/model/version</code> ex:{" "}
            <code className="text-slate-500">cubicasa-xmyt3-d4s04/3</code>
          </p>
        </div>

        {/* Status */}
        {status !== "idle" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            className={cn("rounded-xl p-3.5 flex items-start gap-3 text-sm border",
              status === "ok"      && "bg-accent-green/10 border-accent-green/25 text-accent-green",
              status === "error"   && "bg-red-500/10 border-red-500/25 text-red-400",
              status === "testing" && "bg-white/5 border-white/10 text-slate-400")}>
            {status === "testing" && <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />}
            {status === "ok"      && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
            {status === "error"   && <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
            <p className="font-medium">{status === "testing" ? "Test de la connexion Roboflow…" : msg}</p>
          </motion.div>
        )}

        {/* Info backend */}
        <div className="flex items-start gap-2 text-xs text-slate-600 bg-white/[0.02] rounded-xl p-3 border border-white/5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-500" />
          <span>{d("co_backend")}</span>
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1" onClick={handleTest} disabled={!canTest || status === "testing"}>
            {status === "testing"
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {d("co_testing")}</>
              : d("co_test")}
          </Button>
          <Button className="flex-1" onClick={handleContinue} disabled={!canTest}>
            {d("up_continue")} <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
