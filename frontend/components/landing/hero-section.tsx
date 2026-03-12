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
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(rgba(14,165,233,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Glow blobs */}
      <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-brand-500/8 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/6 rounded-full blur-3xl" />
      {/* Top radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-96 bg-gradient-to-b from-brand-500/12 to-transparent" />

      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 bg-brand-950/60 border border-brand-800/60 rounded-full px-4 py-1.5 text-xs font-semibold text-brand-400 mb-8"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          {t("hero_badge", lang)}
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-display text-5xl md:text-7xl font-800 leading-[1.05] tracking-tight mb-6 text-white"
        >
          {t("hero_title1", lang)}
          <br />
          <span className="text-gradient">{t("hero_title2", lang)}</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          {t("hero_sub", lang)}
        </motion.p>

        {/* CTAs */}
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

        {/* Stats */}
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
              <span className="text-lg font-display font-700 text-brand-400">{t(vk, lang)}</span>
              <span className="text-xs text-slate-500">{t(lk, lang)}</span>
            </div>
          ))}
        </motion.div>

        {/* Demo preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="relative"
        >
          <div className="mb-4 text-center">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              {t("hero_label", lang)}
            </span>
          </div>

          <div className="animated-border mx-auto max-w-4xl shadow-glow-lg">
            <div className="animated-border-inner p-1">
              <div className="rounded-xl overflow-hidden bg-[#0c1220] aspect-video flex items-center justify-center relative border border-slate-700/30">
                {/* Dark-themed floor plan SVG */}
                <svg viewBox="0 0 800 450" className="w-full h-full opacity-90" style={{ maxHeight: "400px" }}>
                  <rect width="800" height="450" fill="#0c1220" />
                  {/* Grid lines */}
                  {Array.from({ length: 20 }).map((_, i) => (<line key={`v${i}`} x1={i * 40} y1="0" x2={i * 40} y2="450" stroke="#1e293b" strokeWidth="0.5" />))}
                  {Array.from({ length: 12 }).map((_, i) => (<line key={`h${i}`} x1="0" y1={i * 40} x2="800" y2={i * 40} stroke="#1e293b" strokeWidth="0.5" />))}
                  {/* Walls — cyan on dark */}
                  <rect x="60" y="40" width="680" height="370" fill="none" stroke="#38bdf8" strokeWidth="4" opacity="0.7" />
                  <line x1="340" y1="40" x2="340" y2="250" stroke="#38bdf8" strokeWidth="3.5" opacity="0.7" />
                  <line x1="60" y1="250" x2="450" y2="250" stroke="#38bdf8" strokeWidth="3.5" opacity="0.7" />
                  <line x1="550" y1="250" x2="550" y2="410" stroke="#38bdf8" strokeWidth="3.5" opacity="0.7" />
                  {/* Room fills */}
                  <rect x="65" y="45" width="268" height="198" fill="rgba(14,165,233,0.06)" />
                  <rect x="345" y="45" width="388" height="198" fill="rgba(14,165,233,0.05)" />
                  <rect x="65" y="255" width="378" height="148" fill="rgba(14,165,233,0.04)" />
                  <rect x="455" y="255" width="288" height="148" fill="rgba(14,165,233,0.05)" />
                  {/* Doors */}
                  {[{ x: 182, y: 243, w: 68, h: 12 }, { x: 333, y: 122, w: 12, h: 56 }, { x: 538, y: 334, w: 12, h: 60 }].map((d, i) => (
                    <g key={`door${i}`}>
                      <rect x={d.x} y={d.y} width={d.w} height={d.h} fill="rgba(239,68,68,0.15)" stroke="#f87171" strokeWidth="1.5" rx="2" />
                      <text x={d.x + d.w / 2} y={d.y - 6} textAnchor="middle" fill="#f87171" fontSize="9" fontFamily="monospace" fontWeight="bold">PORTE</text>
                    </g>
                  ))}
                  {/* Windows */}
                  {[{ x: 122, y: 36, w: 88, h: 10 }, { x: 442, y: 36, w: 88, h: 10 }, { x: 54, y: 152, w: 10, h: 66 }].map((w, i) => (
                    <g key={`win${i}`}>
                      <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="rgba(59,130,246,0.18)" stroke="#60a5fa" strokeWidth="1.5" rx="2" />
                      <text x={w.x + w.w / 2} y={w.y - 6} textAnchor="middle" fill="#60a5fa" fontSize="9" fontFamily="monospace" fontWeight="bold">FENÊTRE</text>
                    </g>
                  ))}
                  {/* Room labels */}
                  <text x="199" y="144" textAnchor="middle" fill="#38bdf8" fontSize="12" fontFamily="Syne, sans-serif" fontWeight="600">Séjour</text>
                  <text x="199" y="160" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="monospace">34,5 m²</text>
                  <text x="539" y="139" textAnchor="middle" fill="#7dd3fc" fontSize="12" fontFamily="Syne, sans-serif" fontWeight="600">Chambre</text>
                  <text x="539" y="155" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="monospace">28,2 m²</text>
                  <text x="254" y="329" textAnchor="middle" fill="#38bdf8" fontSize="11" fontFamily="Syne, sans-serif" fontWeight="600">Cuisine</text>
                  <text x="254" y="344" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="monospace">16,8 m²</text>
                  <text x="599" y="329" textAnchor="middle" fill="#7dd3fc" fontSize="11" fontFamily="Syne, sans-serif" fontWeight="600">Salle de bain</text>
                  <text x="599" y="344" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="monospace">8,4 m²</text>
                  {/* Confidence indicator */}
                  <circle cx="728" cy="56" r="4" fill="#10b981" />
                  <text x="738" y="60" fill="#64748b" fontSize="9" fontFamily="monospace">97% confiance</text>
                </svg>

                {/* Overlay badges */}
                <div className="absolute top-4 left-4 flex flex-col gap-1.5">
                  {[
                    { color: "bg-red-400", label: "3 Portes détectées" },
                    { color: "bg-blue-400", label: "3 Fenêtres détectées" },
                    { color: "bg-emerald-400", label: "84,2 m² habitables" },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5 bg-slate-800/90 backdrop-blur rounded-lg px-2.5 py-1 text-xs text-slate-200 border border-slate-600/40 shadow-sm">
                      <span className={`w-2 h-2 rounded-full ${color}`} />
                      {label}
                    </div>
                  ))}
                </div>
                <div className="absolute top-4 right-4 bg-brand-600 text-white rounded-lg px-3 py-1.5 text-xs font-mono font-semibold shadow-glow-sm">
                  IA ACTIVE ● 97%
                </div>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-16 bg-brand-500/15 blur-3xl rounded-full" />
        </motion.div>
      </div>
    </section>
  );
}
