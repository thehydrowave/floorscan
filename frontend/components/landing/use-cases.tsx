"use client";

import { motion } from "framer-motion";
import { useLang } from "@/lib/lang-context";
import { t } from "@/lib/i18n";

const CASES = [
  { titleKey: "case1_title" as const, descKey: "case1_desc" as const, statKey: "case1_stat" as const, statlKey: "case1_statl" as const, accent: "border-l-brand-500" },
  { titleKey: "case2_title" as const, descKey: "case2_desc" as const, statKey: "case2_stat" as const, statlKey: "case2_statl" as const, accent: "border-l-brand-400" },
  { titleKey: "case3_title" as const, descKey: "case3_desc" as const, statKey: "case3_stat" as const, statlKey: "case3_statl" as const, accent: "border-l-brand-600" },
  { titleKey: "case4_title" as const, descKey: "case4_desc" as const, statKey: "case4_stat" as const, statlKey: "case4_statl" as const, accent: "border-l-brand-700" },
];

export default function UseCasesSection() {
  const { lang } = useLang();

  return (
    <section id="use-cases" className="py-32 relative bg-[#0a0e1a]">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block bg-brand-950/50 border border-brand-800/50 text-brand-400 text-xs font-semibold rounded-full px-4 py-1.5 mb-5">
            {t("cases_badge", lang)}
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-800 tracking-tight mb-4 text-white">
            {t("cases_title1", lang)}
            <br />
            <span className="text-gradient">{t("cases_title2", lang)}</span>
          </h2>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            {t("cases_sub", lang)}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {CASES.map((c, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={`card card-hover p-8 border-l-4 ${c.accent}`}
            >
              <h3 className="font-display font-600 text-slate-100 mb-2">{t(c.titleKey, lang)}</h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-5">{t(c.descKey, lang)}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-display font-700 text-gradient">{t(c.statKey, lang)}</span>
                <span className="text-xs text-slate-500">{t(c.statlKey, lang)}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
