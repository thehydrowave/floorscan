"use client";

import { motion } from "framer-motion";
import { Shield, Lock, Clock, Users, Award, RefreshCw } from "lucide-react";

const TESTIMONIALS = [
  {
    quote: "On gagne facilement 45 minutes par dossier sur le comptage des ouvertures. Le DPGF généré est directement exploitable.",
    author: "Marc T.",
    role: "Métreur-économiste, Paris",
    initials: "MT",
    color: "bg-brand-500",
  },
  {
    quote: "Idéal pour les avant-métrés rapides sur appel d'offres. La détection des pièces est surprenante de précision.",
    author: "Sophie L.",
    role: "Architecte DPLG, Lyon",
    initials: "SL",
    color: "bg-cyan-500",
  },
  {
    quote: "J'utilise FloorScan pour tous mes chiffrages de rénovation. Le module chantier pour suivre l'avancement est un vrai plus.",
    author: "David M.",
    role: "Conducteur de travaux, Bordeaux",
    initials: "DM",
    color: "bg-violet-500",
  },
];

const TRUST_ITEMS = [
  {
    icon: Shield,
    title: "Données sécurisées",
    desc: "Plans traités en RAM, TTL 1h, jamais stockés sur disque",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
  {
    icon: Lock,
    title: "Conforme RGPD",
    desc: "Hébergement UE, droits utilisateurs, pas de revente de données",
    color: "text-brand-400",
    bg: "bg-brand-500/10 border-brand-500/20",
  },
  {
    icon: Clock,
    title: "Analyse en 30s",
    desc: "Multi-passes IA parallèles, résultat immédiat",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  {
    icon: Users,
    title: "Métiers BTP",
    desc: "Conçu avec métreurs, architectes et conducteurs de travaux",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-500/20",
  },
  {
    icon: Award,
    title: "95,8% mAP",
    desc: "Meilleur score sur la détection d'ouvertures architecturales",
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  {
    icon: RefreshCw,
    title: "Mis à jour en continu",
    desc: "Modèles IA améliorés et nouvelles fonctionnalités chaque mois",
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/20",
  },
];

export default function TrustSection() {
  return (
    <section id="trust" className="py-32 relative bg-[#080c18]">
      {/* Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-brand-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative">

        {/* ── Témoignages ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <span className="inline-block bg-brand-950/50 border border-brand-800/50 text-brand-400 text-xs font-semibold rounded-full px-4 py-1.5 mb-5">
            Ils utilisent FloorScan
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-800 tracking-tight text-white mb-4">
            La confiance des<br />
            <span className="text-gradient">professionnels BTP</span>
          </h2>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Architectes, métreurs, conducteurs de travaux — ils ont intégré FloorScan dans leur flux de travail.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="card p-6 flex flex-col gap-4"
            >
              {/* Quote marks */}
              <span className="text-brand-500/40 text-5xl font-serif leading-none select-none">&ldquo;</span>
              <p className="text-slate-300 text-sm leading-relaxed flex-1 -mt-4">
                {t.quote}
              </p>
              {/* Stars */}
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, s) => (
                  <svg key={s} className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1 border-t border-white/5">
                <div className={`w-8 h-8 rounded-full ${t.color} flex items-center justify-center text-white text-xs font-700 shrink-0`}>
                  {t.initials}
                </div>
                <div>
                  <p className="text-white text-xs font-semibold">{t.author}</p>
                  <p className="text-slate-500 text-xs">{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── Trust badges ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <h3 className="font-display text-2xl font-700 text-white mb-2">Pourquoi faire confiance à FloorScan</h3>
          <p className="text-slate-500 text-sm">Sécurité, conformité et performance — nos engagements.</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TRUST_ITEMS.map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: i * 0.07 }}
                className="flex items-start gap-4 p-5 rounded-xl border border-slate-800/60 bg-slate-900/40 hover:border-slate-700 transition-colors"
              >
                <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${item.bg}`}>
                  <Icon className={`w-4.5 h-4.5 ${item.color}`} />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm mb-0.5">{item.title}</p>
                  <p className="text-slate-400 text-xs leading-relaxed">{item.desc}</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ── Stat bar ─────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 border border-slate-800/60 rounded-2xl p-8 bg-slate-900/30"
        >
          {[
            { value: "< 30s",    label: "Temps d'analyse moyen" },
            { value: "95,8%",   label: "mAP détection ouvertures" },
            { value: "0 plan",  label: "Stocké sur nos serveurs" },
            { value: "13 pages", label: "Rapport Pro complet" },
          ].map(({ value, label }) => (
            <div key={label} className="text-center">
              <div className="font-display text-2xl md:text-3xl font-800 text-gradient mb-1">{value}</div>
              <div className="text-slate-500 text-xs">{label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
