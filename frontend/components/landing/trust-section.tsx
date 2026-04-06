"use client";

import { motion } from "framer-motion";
import { Shield, Lock, Clock, Users, Award, RefreshCw } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { t } from "@/lib/i18n";

export default function TrustSection() {
  const { lang } = useLang();

  const TESTIMONIALS = [
    { quote: t("trust_quote1", lang), author: t("trust_name1", lang), role: t("trust_role1", lang), initials: "MT", color: "bg-brand-500" },
    { quote: t("trust_quote2", lang), author: t("trust_name2", lang), role: t("trust_role2", lang), initials: "SL", color: "bg-cyan-500" },
    { quote: t("trust_quote3", lang), author: t("trust_name3", lang), role: t("trust_role3", lang), initials: "DM", color: "bg-violet-500" },
  ];

  const TRUST_ITEMS = [
    { icon: Shield, title: t("trust_secure", lang), desc: t("trust_secure_d", lang), color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    { icon: Lock, title: t("trust_rgpd", lang), desc: t("trust_rgpd_d", lang), color: "text-brand-400", bg: "bg-brand-500/10 border-brand-500/20" },
    { icon: Clock, title: t("trust_fast", lang), desc: t("trust_fast_d", lang), color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
    { icon: Users, title: t("trust_btp", lang), desc: t("trust_btp_d", lang), color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
    { icon: Award, title: t("trust_map", lang), desc: t("trust_map_d", lang), color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
    { icon: RefreshCw, title: t("trust_update", lang), desc: t("trust_update_d", lang), color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20" },
  ];

  return (
    <section id="trust" className="py-32 relative bg-[#080c18]">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-brand-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative">

        {/* ── Testimonials ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6 }} className="text-center mb-14">
          <h2 className="font-display text-4xl md:text-5xl font-800 tracking-tight text-white mb-4">
            {t("trust_title1", lang)}<br />
            <span className="text-gradient">{t("trust_title2", lang)}</span>
          </h2>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">{t("trust_sub", lang)}</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-32">
          {TESTIMONIALS.map((testi, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
              className="glass border border-white/10 rounded-2xl p-6 text-left hover:border-brand-500/30 transition-all">
              <div className="text-brand-400 text-3xl mb-4 font-display">&ldquo;</div>
              <p className="text-slate-300 text-sm leading-relaxed mb-6">{testi.quote}</p>
              <div className="flex text-amber-400 gap-0.5 mb-4">{[...Array(5)].map((_, j) => <span key={j}>★</span>)}</div>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full ${testi.color} flex items-center justify-center text-white text-xs font-bold`}>{testi.initials}</div>
                <div>
                  <div className="text-white text-sm font-semibold">{testi.author}</div>
                  <div className="text-slate-500 text-xs">{testi.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── Why trust ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6 }} className="text-center mb-14">
          <h2 className="font-display text-3xl md:text-4xl font-800 tracking-tight text-white mb-3">{t("trust_why", lang)}</h2>
          <p className="text-slate-400 max-w-lg mx-auto">{t("trust_why_sub", lang)}</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-20">
          {TRUST_ITEMS.map((item, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
              className={`rounded-xl border p-5 ${item.bg} hover:scale-[1.02] transition-transform`}>
              <item.icon className={`w-8 h-8 ${item.color} mb-3`} />
              <h3 className="text-white font-semibold mb-1">{item.title}</h3>
              <p className="text-slate-400 text-sm">{item.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* ── Stats bar ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
          className="glass border border-white/10 rounded-2xl p-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: t("trust_stat1", lang), label: t("trust_stat1l", lang), color: "text-brand-400" },
              { value: t("trust_stat2", lang), label: t("trust_stat2l", lang), color: "text-emerald-400" },
              { value: t("trust_stat3", lang), label: t("trust_stat3l", lang), color: "text-amber-400" },
              { value: t("trust_stat4", lang), label: t("trust_stat4l", lang), color: "text-violet-400" },
            ].map((s, i) => (
              <div key={i}>
                <div className={`font-display text-3xl font-800 ${s.color}`}>{s.value}</div>
                <div className="text-slate-500 text-sm mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </motion.div>

      </div>
    </section>
  );
}
