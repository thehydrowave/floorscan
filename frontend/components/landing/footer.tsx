"use client";

import Link from "next/link";
import { ScanLine, Mail, Linkedin, Twitter } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { t, type TKey } from "@/lib/i18n";

export default function Footer() {
  const { lang } = useLang();

  const cols = [
    {
      title: t("footer_product" as TKey, lang),
      links: [
        { label: t("footer_features" as TKey, lang), href: "/#features" },
        { label: t("footer_how" as TKey, lang), href: "/#how-it-works" },
        { label: t("footer_cases" as TKey, lang), href: "/#use-cases" },
        { label: "FAQ", href: "/#faq" },
        { label: t("footer_try" as TKey, lang), href: "/demo" },
      ],
    },
    {
      title: t("footer_resources" as TKey, lang),
      links: [
        { label: t("footer_contact" as TKey, lang), href: "/contact" },
        { label: t("footer_blog" as TKey, lang), href: "/blog" },
        { label: t("footer_api" as TKey, lang), href: "/contact" },
      ],
    },
    {
      title: t("footer_legal" as TKey, lang),
      links: [
        { label: t("footer_mentions" as TKey, lang), href: "/mentions-legales" },
        { label: t("footer_privacy" as TKey, lang), href: "/politique-confidentialite" },
        { label: t("footer_terms" as TKey, lang), href: "/cgu" },
      ],
    },
  ];

  return (
    <footer className="border-t border-slate-800/60 bg-[#06090f]">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-14">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2.5 mb-4 group w-fit">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-shadow">
                <ScanLine className="w-4 h-4 text-white" />
              </div>
              <span className="font-display font-700 text-lg text-white">Floor<span className="text-gradient">Scan</span></span>
            </Link>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs mb-5">{t("footer_desc" as TKey, lang)}</p>
            <a href="mailto:contact@floorscan.ai" className="flex items-center gap-2 text-slate-400 hover:text-brand-400 transition-colors text-sm mb-4">
              <Mail className="w-4 h-4" /> contact@floorscan.ai
            </a>
            <div className="flex gap-3">
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-600 transition-all">
                <Linkedin className="w-3.5 h-3.5" />
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-600 transition-all">
                <Twitter className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
          {cols.map((col) => (
            <div key={col.title}>
              <h4 className="text-white font-semibold text-xs uppercase tracking-widest mb-4">{col.title}</h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link href={link.href} className="text-slate-400 hover:text-slate-200 transition-colors text-sm">{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-800/60 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-slate-600 text-xs">© {new Date().getFullYear()} FloorScan SAS. {t("footer_rights" as TKey, lang)}</p>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <Link href="/mentions-legales" className="hover:text-slate-400 transition-colors">{t("footer_mentions" as TKey, lang)}</Link>
            <span>·</span>
            <Link href="/politique-confidentialite" className="hover:text-slate-400 transition-colors">{t("footer_confid" as TKey, lang)}</Link>
            <span>·</span>
            <Link href="/cgu" className="hover:text-slate-400 transition-colors">{t("footer_terms" as TKey, lang)}</Link>
          </div>
          <p className="text-slate-700 text-xs">{t("footer_built", lang)}</p>
        </div>
      </div>
    </footer>
  );
}
