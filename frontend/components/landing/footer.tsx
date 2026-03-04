"use client";

import Link from "next/link";
import { ScanLine } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { t } from "@/lib/i18n";

export default function Footer() {
  const { lang } = useLang();

  return (
    <footer className="border-t border-slate-800/60 py-12 bg-ink">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-glow-sm">
              <ScanLine className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-display font-700 text-sm text-white">
              Floor<span className="text-gradient">Scan</span>
            </span>
          </div>
          <div className="flex items-center gap-6 text-xs text-slate-500">
            <Link href="#features"    className="hover:text-slate-300 transition-colors">{t("nav_features", lang)}</Link>
            <Link href="#how-it-works" className="hover:text-slate-300 transition-colors">{t("nav_how", lang)}</Link>
            <Link href="/demo"        className="hover:text-slate-300 transition-colors">{t("nav_try", lang)}</Link>
          </div>
          <div className="text-xs text-slate-600">
            {t("footer_built", lang)}
          </div>
        </div>
      </div>
    </footer>
  );
}
