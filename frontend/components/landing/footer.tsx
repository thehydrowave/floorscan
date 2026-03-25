"use client";

import Link from "next/link";
import { ScanLine, Mail, Linkedin, Twitter } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { t } from "@/lib/i18n";

export default function Footer() {
  const { lang } = useLang();

  const cols = [
    {
      title: "Produit",
      links: [
        { label: "Fonctionnalités", href: "/#features" },
        { label: "Comment ça marche", href: "/#how-it-works" },
        { label: "Cas d'usage", href: "/#use-cases" },
        { label: "FAQ", href: "/#faq" },
        { label: "Essayer gratuitement", href: "/demo" },
      ],
    },
    {
      title: "Ressources",
      links: [
        { label: "Contact", href: "/contact" },
        { label: "Blog", href: "/blog" },
        { label: "API (bientôt)", href: "/contact" },
      ],
    },
    {
      title: "Légal",
      links: [
        { label: "Mentions légales", href: "/mentions-legales" },
        { label: "Politique de confidentialité", href: "/politique-confidentialite" },
        { label: "CGU", href: "/cgu" },
      ],
    },
  ];

  return (
    <footer className="border-t border-slate-800/60 bg-[#06090f]">
      <div className="max-w-7xl mx-auto px-6 py-16">

        {/* Top: logo + cols */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-14">

          {/* Brand col */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2.5 mb-4 group w-fit">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-shadow">
                <ScanLine className="w-4 h-4 text-white" />
              </div>
              <span className="font-display font-700 text-lg text-white">
                Floor<span className="text-gradient">Scan</span>
              </span>
            </Link>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs mb-5">
              Analyse de plans architecturaux par IA. Détection ouvertures, métrés, rapports pro — en 30 secondes.
            </p>
            {/* Contact */}
            <a
              href="mailto:contact@floorscan.ai"
              className="flex items-center gap-2 text-slate-400 hover:text-brand-400 transition-colors text-sm mb-4"
            >
              <Mail className="w-4 h-4" />
              contact@floorscan.ai
            </a>
            {/* Socials */}
            <div className="flex gap-3">
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer"
                className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-600 transition-all">
                <Linkedin className="w-3.5 h-3.5" />
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer"
                className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-600 transition-all">
                <Twitter className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Nav cols */}
          {cols.map((col) => (
            <div key={col.title}>
              <h4 className="text-white font-semibold text-xs uppercase tracking-widest mb-4">{col.title}</h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-slate-400 hover:text-slate-200 transition-colors text-sm"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-slate-800/60 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-slate-600 text-xs">
            © {new Date().getFullYear()} FloorScan SAS. Tous droits réservés.
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <Link href="/mentions-legales" className="hover:text-slate-400 transition-colors">Mentions légales</Link>
            <span>·</span>
            <Link href="/politique-confidentialite" className="hover:text-slate-400 transition-colors">Confidentialité</Link>
            <span>·</span>
            <Link href="/cgu" className="hover:text-slate-400 transition-colors">CGU</Link>
          </div>
          <p className="text-slate-700 text-xs">{t("footer_built", lang)}</p>
        </div>
      </div>
    </footer>
  );
}
