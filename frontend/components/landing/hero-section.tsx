"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/lang-context";
import { t } from "@/lib/i18n";

export default function HeroSection() {
  const { lang } = useLang();

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20 bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(14,165,233,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-brand-100/50 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-sky-100/40 rounded-full blur-3xl" />

      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-full px-4 py-1.5 text-xs font-semibold text-brand-700 mb-8"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
          {t("hero_badge", lang)}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-display text-5xl md:text-7xl font-800 leading-[1.05] tracking-tight mb-6 text-slate-900"
        >
          {t("hero_title1", lang)}
          <br />
          <span className="text-gradient">{t("hero_title2", lang)}</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-slate-500 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          {t("hero_sub", lang)}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 justify-center mb-14"
        >
          <Button size="xl" asChild>
            <Link href="/demo" className="group">
              {t("hero_cta1", lang)}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </Button>
          <Button size="xl" variant="outline" asChild>
            <Link href="#how-it-works">{t("hero_cta2", lang)}</Link>
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="flex flex-wrap items-center justify-center gap-8 mb-16"
        >
          {[
            { vk: "hero_stat1v" as const, lk: "hero_stat1l" as const },
            { vk: "hero_stat2v" as const, lk: "hero_stat2l" as const },
            { vk: "hero_stat3v" as const, lk: "hero_stat3l" as const },
          ].map(({ vk, lk }) => (
            <div key={lk} className="flex flex-col items-center gap-0.5">
              <span className="text-lg font-display font-700 text-brand-600">{t(vk, lang)}</span>
              <span className="text-xs text-slate-400">{t(lk, lang)}</span>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="relative"
        >
          <div className="mb-4 text-center">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              {t("hero_label", lang)}
            </span>
          </div>

          <div className="animated-border mx-auto max-w-4xl shadow-xl">
            <div className="animated-border-inner p-1">
              <div className="rounded-xl overflow-hidden bg-white aspect-video flex items-center justify-center relative border border-slate-100">
                <svg viewBox="0 0 800 450" className="w-full h-full opacity-85" style={{ maxHeight: "400px" }}>
                  <rect width="800" height="450" fill="#f8fafc" />
                  {Array.from({ length: 20 }).map((_, i) => (<line key={`v${i}`} x1={i * 40} y1="0" x2={i * 40} y2="450" stroke="#e2e8f0" strokeWidth="0.5" />))}
                  {Array.from({ length: 12 }).map((_, i) => (<line key={`h${i}`} x1="0" y1={i * 40} x2="800" y2={i * 40} stroke="#e2e8f0" strokeWidth="0.5" />))}
                  <rect x="60" y="40" width="680" height="370" fill="none" stroke="#334155" strokeWidth="6" />
                  <line x1="340" y1="40" x2="340" y2="250" stroke="#334155" strokeWidth="5" />
                  <line x1="60" y1="250" x2="450" y2="250" stroke="#334155" strokeWidth="5" />
                  <line x1="550" y1="250" x2="550" y2="410" stroke="#334155" strokeWidth="5" />
                  <rect x="65" y="45" width="268" height="198" fill="rgba(14,165,233,0.05)" />
                  <rect x="345" y="45" width="388" height="198" fill="rgba(14,165,233,0.04)" />
                  <rect x="65" y="255" width="378" height="148" fill="rgba(14,165,233,0.03)" />
                  <rect x="455" y="255" width="288" height="148" fill="rgba(14,165,233,0.04)" />
                  {[{ x: 182, y: 243, w: 68, h: 12 }, { x: 333, y: 122, w: 12, h: 56 }, { x: 538, y: 334, w: 12, h: 60 }].map((d, i) => (
                    <g key={`door${i}`}>
                      <rect x={d.x} y={d.y} width={d.w} height={d.h} fill="rgba(239,68,68,0.12)" stroke="#ef4444" strokeWidth="1.5" rx="2" />
                      <text x={d.x + d.w / 2} y={d.y - 6} textAnchor="middle" fill="#dc2626" fontSize="9" fontFamily="monospace" fontWeight="bold">PORTE</text>
                    </g>
                  ))}
                  {[{ x: 122, y: 36, w: 88, h: 10 }, { x: 442, y: 36, w: 88, h: 10 }, { x: 54, y: 152, w: 10, h: 66 }].map((w, i) => (
                    <g key={`win${i}`}>
                      <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth="1.5" rx="2" />
                      <text x={w.x + w.w / 2} y={w.y - 6} textAnchor="middle" fill="#2563eb" fontSize="9" fontFamily="monospace" fontWeight="bold">FENÊTRE</text>
                    </g>
                  ))}
                  <text x="199" y="144" textAnchor="middle" fill="#0ea5e9" fontSize="12" fontFamily="Syne, sans-serif" fontWeight="600">Séjour</text>
                  <text x="199" y="160" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">34,5 m²</text>
                  <text x="539" y="139" textAnchor="middle" fill="#0284c7" fontSize="12" fontFamily="Syne, sans-serif" fontWeight="600">Chambre</text>
                  <text x="539" y="155" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">28,2 m²</text>
                  <text x="254" y="329" textAnchor="middle" fill="#0369a1" fontSize="11" fontFamily="Syne, sans-serif" fontWeight="600">Cuisine</text>
                  <text x="254" y="344" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">16,8 m²</text>
                  <text x="599" y="329" textAnchor="middle" fill="#075985" fontSize="11" fontFamily="Syne, sans-serif" fontWeight="600">Salle de bain</text>
                  <text x="599" y="344" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">8,4 m²</text>
                  <circle cx="728" cy="56" r="4" fill="#10b981" />
                  <text x="738" y="60" fill="#64748b" fontSize="9" fontFamily="monospace">97% confiance</text>
                </svg>
                <div className="absolute top-4 left-4 flex flex-col gap-1.5">
                  {[
                    { color: "bg-red-400", label: "3 Portes détectées" },
                    { color: "bg-blue-400", label: "3 Fenêtres détectées" },
                    { color: "bg-emerald-400", label: "84,2 m² habitables" },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5 bg-white/95 backdrop-blur rounded-lg px-2.5 py-1 text-xs text-slate-700 border border-slate-200/80 shadow-sm">
                      <span className={`w-2 h-2 rounded-full ${color}`} />
                      {label}
                    </div>
                  ))}
                </div>
                <div className="absolute top-4 right-4 bg-brand-600 text-white rounded-lg px-3 py-1.5 text-xs font-mono font-semibold shadow-sm">
                  IA ACTIVE ● 97%
                </div>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-16 bg-brand-200/30 blur-3xl rounded-full" />
        </motion.div>
      </div>
    </section>
  );
}
