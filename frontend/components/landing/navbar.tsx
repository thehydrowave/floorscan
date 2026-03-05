"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, Menu, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { LANGUAGES, t } from "@/lib/i18n";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const { lang, setLang } = useLang();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentLang = LANGUAGES.find((l) => l.code === lang)!;

  const links = [
    { href: "/#features",     labelKey: "nav_features" as const },
    { href: "/#how-it-works", labelKey: "nav_how"      as const },
    { href: "/#use-cases",    labelKey: "nav_cases"    as const },
  ];

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-slate-900/90 backdrop-blur-xl border-b border-slate-700/50 py-3 shadow-lg shadow-black/20"
          : "py-5 bg-transparent"
      )}
    >
      <nav className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-shadow">
            <ScanLine className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-700 text-lg tracking-tight text-white">
            Floor<span className="text-gradient">Scan</span>
          </span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/60 transition-all duration-150 font-medium"
            >
              {t(link.labelKey, lang)}
            </Link>
          ))}
        </div>

        {/* Right side: lang + CTAs */}
        <div className="hidden md:flex items-center gap-3">
          {/* Language selector */}
          <div ref={langRef} className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-300 border border-slate-700 rounded-lg hover:bg-slate-800 hover:border-slate-600 transition-all bg-slate-800/50"
            >
              <span className="text-base leading-none">{currentLang.flag}</span>
              <span className="text-xs font-semibold uppercase tracking-wide">{currentLang.code}</span>
              <ChevronDown className={cn("w-3.5 h-3.5 text-slate-500 transition-transform duration-200", langOpen && "rotate-180")} />
            </button>

            <AnimatePresence>
              {langOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full mt-1.5 w-40 bg-slate-800 border border-slate-700 rounded-xl shadow-xl shadow-black/30 overflow-hidden z-50"
                >
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => { setLang(l.code); setLangOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors text-left",
                        lang === l.code
                          ? "bg-brand-900/50 text-brand-400 font-semibold"
                          : "text-slate-300 hover:bg-slate-700/50"
                      )}
                    >
                      <span className="text-base">{l.flag}</span>
                      <span>{l.label}</span>
                      {lang === l.code && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-400" />}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Button variant="ghost" size="sm" asChild>
            <Link href="/measure">Métré</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/demo">{t("nav_try", lang)}</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/demo">{t("nav_start", lang)}</Link>
          </Button>
        </div>

        {/* Mobile burger */}
        <button
          className="md:hidden p-2 rounded-lg hover:bg-slate-800/60 transition-colors"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X className="w-5 h-5 text-slate-400" /> : <Menu className="w-5 h-5 text-slate-400" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="md:hidden bg-slate-900 border-t border-slate-700/50 px-6 py-4 flex flex-col gap-2 shadow-xl"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="px-4 py-2.5 text-sm text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/60"
            >
              {t(link.labelKey, lang)}
            </Link>
          ))}
          {/* Mobile lang selector */}
          <div className="border-t border-slate-700/50 pt-2 mt-1 flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setMenuOpen(false); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                  lang === l.code
                    ? "bg-brand-900/40 border-brand-700 text-brand-400"
                    : "border-slate-700 text-slate-400 hover:bg-slate-800/60"
                )}
              >
                <span>{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
          <Link href="/measure" onClick={() => setMenuOpen(false)}
            className="px-4 py-2.5 text-sm text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/60">
            Métré
          </Link>
          <Button className="mt-2" asChild>
            <Link href="/demo">{t("nav_try", lang)} →</Link>
          </Button>
        </motion.div>
      )}
    </motion.header>
  );
}
