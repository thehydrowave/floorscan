"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { t, type TKey } from "@/lib/i18n";

const FAQ_KEYS: Array<{ q: TKey; a: TKey }> = [
  { q: "faq_q1", a: "faq_a1" },
  { q: "faq_q2", a: "faq_a2" },
  { q: "faq_q3", a: "faq_a3" },
  { q: "faq_q4", a: "faq_a4" },
  { q: "faq_q5", a: "faq_a5" },
  { q: "faq_q6", a: "faq_a6" },
];

export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { lang } = useLang();

  return (
    <section id="faq" className="py-32 relative bg-[#080c18]">
      <div className="absolute inset-0 opacity-20"
        style={{ backgroundImage: "linear-gradient(rgba(14,165,233,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.06) 1px, transparent 1px)", backgroundSize: "64px 64px" }} />

      <div className="max-w-3xl mx-auto px-6 relative">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6 }} className="text-center mb-14">
          <span className="inline-block bg-brand-950/50 border border-brand-800/50 text-brand-400 text-xs font-semibold rounded-full px-4 py-1.5 mb-5">FAQ</span>
          <h2 className="font-display text-4xl md:text-5xl font-800 tracking-tight text-white mb-4">
            {t("faq_title1", lang)} <span className="text-gradient">{t("faq_title2", lang)}</span>
          </h2>
          <p className="text-slate-400 text-lg">{t("faq_sub", lang)}</p>
        </motion.div>

        <div className="space-y-3">
          {FAQ_KEYS.map((faq, i) => {
            const isOpen = openIndex === i;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.4, delay: i * 0.05 }}>
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className={cn(
                    "w-full text-left px-6 py-4 rounded-xl border transition-all duration-200 flex items-start justify-between gap-4",
                    isOpen ? "bg-brand-950/40 border-brand-800/60" : "bg-slate-900/50 border-slate-800/60 hover:border-slate-700 hover:bg-slate-900/80"
                  )}>
                  <span className={cn("font-medium text-sm leading-relaxed", isOpen ? "text-white" : "text-slate-200")}>{t(faq.q, lang)}</span>
                  <ChevronDown className={cn("w-4 h-4 shrink-0 mt-0.5 transition-transform duration-200", isOpen ? "rotate-180 text-brand-400" : "text-slate-500")} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: "easeInOut" }} className="overflow-hidden">
                      <div className="px-6 py-4 text-slate-400 text-sm leading-relaxed">{t(faq.a, lang)}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
