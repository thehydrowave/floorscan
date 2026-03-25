"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ScanLine, ArrowLeft, Home, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#080c18] flex flex-col items-center justify-center px-6 relative overflow-hidden">

      {/* Grille de fond */}
      <div className="absolute inset-0 opacity-30" style={{
        backgroundImage: "linear-gradient(rgba(14,165,233,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.07) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
      }} />

      {/* Glows */}
      <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-brand-500/6 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 text-center max-w-xl">

        {/* Logo */}
        <Link href="/" className="inline-flex items-center gap-2.5 mb-12 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-shadow">
            <ScanLine className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-700 text-lg text-white">
            Floor<span className="bg-gradient-to-r from-brand-400 to-cyan-300 bg-clip-text text-transparent">Scan</span>
          </span>
        </Link>

        {/* 404 grand */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative mb-6"
        >
          <div className="font-display text-[10rem] md:text-[14rem] font-800 leading-none select-none"
            style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.15) 0%, rgba(14,165,233,0.05) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            404
          </div>
          {/* Icône plan centré dans le 404 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-950/60 border border-brand-800/60 flex items-center justify-center shadow-glow-sm">
              <FileSearch className="w-8 h-8 text-brand-400" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <h1 className="font-display text-2xl md:text-3xl font-700 text-white mb-3">
            Page introuvable
          </h1>
          <p className="text-slate-400 text-base leading-relaxed mb-8 max-w-md mx-auto">
            Cette page n&apos;existe pas ou a été déplacée. Il n&apos;y a pas de plan pour cet endroit — revenez à l&apos;accueil ou lancez une analyse.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild>
              <Link href="/demo">
                <ScanLine className="w-4 h-4" />
                Lancer une analyse
              </Link>
            </Button>
            <Button variant="outline" asChild className="border-slate-700 text-slate-300 hover:bg-slate-800">
              <Link href="/">
                <Home className="w-4 h-4" />
                Accueil
              </Link>
            </Button>
          </div>

          <div className="mt-8">
            <Link href="javascript:history.back()"
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Retour à la page précédente
            </Link>
          </div>
        </motion.div>

        {/* Mini plan SVG décoratif */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-14 opacity-20"
        >
          <svg viewBox="0 0 300 120" className="w-48 mx-auto" fill="none">
            <rect x="10" y="10" width="280" height="100" stroke="#38bdf8" strokeWidth="2" rx="2"/>
            <line x1="130" y1="10" x2="130" y2="110" stroke="#38bdf8" strokeWidth="1.5"/>
            <line x1="10" y1="60" x2="200" y2="60" stroke="#38bdf8" strokeWidth="1.5"/>
            <rect x="50" y="52" width="30" height="12" fill="#f8717160" stroke="#f87171" strokeWidth="1" rx="1"/>
            <rect x="60" y="4" width="40" height="8" fill="#60a5fa60" stroke="#60a5fa" strokeWidth="1" rx="1"/>
            <text x="55" y="42" fill="#38bdf8" fontSize="10" fontFamily="monospace">?</text>
            <text x="160" y="42" fill="#38bdf8" fontSize="10" fontFamily="monospace">?</text>
            <text x="55" y="88" fill="#38bdf8" fontSize="10" fontFamily="monospace">?</text>
          </svg>
        </motion.div>
      </div>
    </div>
  );
}
