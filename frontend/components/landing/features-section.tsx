"use client";

import { motion } from "framer-motion";
import { Brain, PenLine, TableProperties, FileText, Layers, Zap } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { t } from "@/lib/i18n";

const FEATURES = [
  { icon: Brain,           titleKey: "feat1_title" as const, descKey: "feat1_desc" as const },
  { icon: PenLine,         titleKey: "feat2_title" as const, descKey: "feat2_desc" as const },
  { icon: TableProperties, titleKey: "feat3_title" as const, descKey: "feat3_desc" as const },
  { icon: FileText,        titleKey: "feat4_title" as const, descKey: "feat4_desc" as const },
  { icon: Layers,          titleKey: "feat5_title" as const, descKey: "feat5_desc" as const },
  { icon: Zap,             titleKey: "feat6_title" as const, descKey: "feat6_desc" as const },
];

export default function FeaturesSection() {
  const { lang } = useLang();

  return (
    <section id="features" className="py-32 relative bg-[#0a0e1a]">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block bg-brand-950/50 border border-brand-800/50 text-brand-400 text-xs font-semibold rounded-full px-4 py-1.5 mb-5">
            {t("feat_badge", lang)}
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-800 tracking-tight mb-4 text-white">
            {t("feat_title1", lang)}
            <br />
            <span className="text-gradient">{t("feat_title2", lang)}</span>
          </h2>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            {t("feat_sub", lang)}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: index * 0.08 }}
                className="card card-hover p-6"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-950/40 border border-brand-900/50 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-brand-400" />
                </div>
                <h3 className="font-display font-600 text-slate-100 mb-2 text-base">
                  {t(feature.titleKey, lang)}
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  {t(feature.descKey, lang)}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
