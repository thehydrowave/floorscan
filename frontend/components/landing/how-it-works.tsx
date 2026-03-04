"use client";

import { motion } from "framer-motion";
import { Upload, Crop, Brain, ClipboardCheck, Download } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { t } from "@/lib/i18n";

const STEPS = [
  { icon: Upload,         titleKey: "how1_title" as const, descKey: "how1_desc" as const },
  { icon: Crop,           titleKey: "how2_title" as const, descKey: "how2_desc" as const },
  { icon: Brain,          titleKey: "how3_title" as const, descKey: "how3_desc" as const },
  { icon: ClipboardCheck, titleKey: "how4_title" as const, descKey: "how4_desc" as const },
  { icon: Download,       titleKey: "how5_title" as const, descKey: "how5_desc" as const },
];

export default function HowItWorksSection() {
  const { lang } = useLang();

  return (
    <section id="how-it-works" className="py-32 relative bg-ink">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <span className="inline-block bg-brand-950/50 border border-brand-800/50 text-brand-400 text-xs font-semibold rounded-full px-4 py-1.5 mb-5">
            {t("how_badge", lang)}
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-800 tracking-tight mb-4 text-white">
            {t("how_title1", lang)}
            <br />
            <span className="text-gradient">{t("how_title2", lang)}</span>
          </h2>
        </motion.div>

        <div className="relative">
          <div className="hidden lg:block absolute top-10 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand-700/40 to-transparent" />

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-8 lg:gap-4">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="flex flex-col items-center text-center relative"
                >
                  <div className="w-20 h-20 rounded-2xl border-2 border-brand-700/50 bg-brand-950/40 flex items-center justify-center mb-5 relative z-10 shadow-glow-sm">
                    <Icon className="w-8 h-8 text-brand-400" />
                  </div>
                  <h3 className="font-display font-600 text-slate-200 mb-2 text-sm">
                    {t(step.titleKey, lang)}
                  </h3>
                  <p className="text-slate-500 text-xs leading-relaxed">
                    {t(step.descKey, lang)}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
