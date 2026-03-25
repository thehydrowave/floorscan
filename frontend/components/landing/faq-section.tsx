"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "Quelle est la précision de la détection IA ?",
    a: "FloorScan utilise un ensemble de modèles spécialisés (architecture CubiCasa5k + modèles Roboflow fine-tunés) avec un mAP allant jusqu'à 95,8% sur la détection des ouvertures. La précision dépend de la qualité du plan : sur un plan vectoriel propre, la détection atteint 90–97%. Sur un plan scanné ou photographié, comptez 75–88%. Un système de calibration multi-sources (lignes de cotes, largeur des portes, cartouche) assure la précision des métrés.",
  },
  {
    q: "Quels formats de fichiers sont supportés ?",
    a: "FloorScan accepte les fichiers PDF (plans vectoriels ou scannés), PNG, JPG et JPEG. La taille maximale recommandée est de 20 Mo. Pour les PDF multi-pages, chaque page peut être analysée séparément. Les plans A4 à A0 sont supportés, avec un zoom automatique ×3 pour la résolution.",
  },
  {
    q: "Mes plans sont-ils stockés sur vos serveurs ?",
    a: "Non. Les fichiers uploadés sont traités en mémoire vive (RAM) sur notre backend, avec une durée de vie maximale de 1 heure (TTL automatique). Aucun plan n'est écrit sur disque ni conservé après la session. Vos données restent confidentielles et ne sont jamais utilisées pour entraîner nos modèles sans votre consentement explicite. Pour plus de détails, voir notre politique de confidentialité.",
  },
  {
    q: "Les résultats peuvent-ils être utilisés dans un contexte contractuel ?",
    a: "Les analyses FloorScan ont une valeur indicative et constituent un excellent point de départ pour établir des devis, DPGF ou métrés. Elles ne remplacent pas un relevé de géomètre certifié. Nous recommandons qu'un professionnel qualifié valide les surfaces avant signature d'un contrat. Le rapport Pro est explicitement marqué 'estimatif' à cet effet.",
  },
  {
    q: "L'application fonctionne-t-elle sur des plans de façade ou uniquement des plans de sol ?",
    a: "FloorScan propose deux modules distincts : l'analyse de plans de sol (module principal, détection portes/fenêtres/pièces/surfaces) et l'analyse de façades (module Façade, détection fenêtres/portes/balcons/étages/surfaces murales). Chaque module utilise des modèles IA spécialisés pour son type de plan.",
  },
  {
    q: "Peut-on exporter les données vers d'autres logiciels ?",
    a: "Oui. FloorScan permet l'export en CSV (données brutes), PDF professionnel (rapport complet, DPGF, devis, CCTP, métré, conformité) et DXF (AutoCAD). Les exports PDF suivent le même style graphique professionnel cohérent, prêts à être transmis à un client.",
  },
  {
    q: "Y a-t-il une API disponible ?",
    a: "Une API REST est en cours de développement pour les intégrations tierces (logiciels BIM, ERP BTP, etc.). Contactez-nous à contact@floorscan.ai si vous êtes intéressé par un accès anticipé ou une intégration personnalisée.",
  },
  {
    q: "Comment fonctionne la calibration de l'échelle ?",
    a: "FloorScan utilise un système de calibration multi-sources : (1) lignes de cotes annotées sur le plan (OCR + détection Hough), (2) largeur médiane des portes détectées (0,80 m par convention), (3) ratio d'échelle depuis le cartouche (1:100, 1:50...). Ces sources sont croisées pour produire une estimation avec niveau de confiance. Vous pouvez aussi calibrer manuellement en traçant un segment de longueur connue.",
  },
];

export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-32 relative bg-[#080c18]">
      {/* subtle grid */}
      <div className="absolute inset-0 opacity-20"
        style={{ backgroundImage: "linear-gradient(rgba(14,165,233,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.06) 1px, transparent 1px)", backgroundSize: "64px 64px" }} />

      <div className="max-w-3xl mx-auto px-6 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <span className="inline-block bg-brand-950/50 border border-brand-800/50 text-brand-400 text-xs font-semibold rounded-full px-4 py-1.5 mb-5">
            FAQ
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-800 tracking-tight text-white mb-4">
            Questions <span className="text-gradient">fréquentes</span>
          </h2>
          <p className="text-slate-400 text-lg">
            Tout ce que vous devez savoir avant de démarrer.
          </p>
        </motion.div>

        <div className="space-y-3">
          {FAQS.map((faq, i) => {
            const isOpen = openIndex === i;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className={cn(
                    "w-full text-left px-6 py-4 rounded-xl border transition-all duration-200 flex items-start justify-between gap-4",
                    isOpen
                      ? "bg-brand-950/40 border-brand-800/60"
                      : "bg-slate-900/50 border-slate-800/60 hover:border-slate-700 hover:bg-slate-900/80"
                  )}
                >
                  <span className={cn("font-medium text-sm leading-relaxed", isOpen ? "text-white" : "text-slate-200")}>
                    {faq.q}
                  </span>
                  <ChevronDown className={cn(
                    "w-4 h-4 shrink-0 mt-0.5 transition-transform duration-200",
                    isOpen ? "rotate-180 text-brand-400" : "text-slate-500"
                  )} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 py-4 text-slate-400 text-sm leading-relaxed border border-t-0 border-brand-800/40 rounded-b-xl bg-brand-950/20">
                        {faq.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-center mt-12 text-slate-500 text-sm"
        >
          Une question non listée ?{" "}
          <a href="/contact" className="text-brand-400 hover:text-brand-300 transition-colors font-medium">
            Contactez-nous →
          </a>
        </motion.div>
      </div>
    </section>
  );
}
