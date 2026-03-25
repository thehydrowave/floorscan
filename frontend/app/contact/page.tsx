"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, MessageSquare, Clock, Building2, CheckCircle2 } from "lucide-react";
import Navbar from "@/components/landing/navbar";
import Footer from "@/components/landing/footer";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", company: "", subject: "", message: "" });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    // Simule envoi — à brancher sur une API route ou Resend
    await new Promise((r) => setTimeout(r, 1200));
    setSending(false);
    setSent(true);
  };

  return (
    <main className="overflow-x-hidden bg-[#080c18] min-h-screen">
      <Navbar />

      <div className="max-w-6xl mx-auto px-6 pt-32 pb-24">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block bg-brand-950/50 border border-brand-800/50 text-brand-400 text-xs font-semibold rounded-full px-4 py-1.5 mb-5">
            Contact
          </span>
          <h1 className="font-display text-4xl md:text-5xl font-800 text-white mb-4">
            On est là pour vous<br />
            <span className="text-gradient">aider</span>
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Question sur le produit, démo, partenariat ou retour d&apos;expérience — écrivez-nous.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">

          {/* Left: info cards */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="lg:col-span-2 flex flex-col gap-5"
          >
            {[
              {
                icon: Mail,
                title: "Email direct",
                desc: "contact@floorscan.ai",
                sub: "Réponse sous 24–48h ouvrées",
                href: "mailto:contact@floorscan.ai",
              },
              {
                icon: Clock,
                title: "Disponibilité",
                desc: "Lun–Ven, 9h–18h CET",
                sub: "Support en français et anglais",
              },
              {
                icon: Building2,
                title: "Professionnel BTP ?",
                desc: "Démo personnalisée",
                sub: "Architectes, métreurs, conducteurs de travaux — on adapte la démo à votre métier.",
              },
            ].map(({ icon: Icon, title, desc, sub, href }) => (
              <div key={title} className="glass rounded-2xl border border-white/10 p-5 flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-brand-950/50 border border-brand-900/50 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <p className="text-white font-medium text-sm mb-0.5">{title}</p>
                  {href ? (
                    <a href={href} className="text-brand-400 hover:text-brand-300 transition-colors text-sm font-mono">{desc}</a>
                  ) : (
                    <p className="text-slate-300 text-sm">{desc}</p>
                  )}
                  <p className="text-slate-500 text-xs mt-1">{sub}</p>
                </div>
              </div>
            ))}

            {/* FAQ link */}
            <div className="glass rounded-2xl border border-white/10 p-5 bg-brand-950/20">
              <p className="text-white font-medium text-sm mb-1">Vous cherchez une réponse rapide ?</p>
              <p className="text-slate-400 text-xs mb-3">La FAQ couvre les questions les plus fréquentes sur la précision IA, les formats supportés et la sécurité des données.</p>
              <a href="/#faq" className="text-brand-400 hover:text-brand-300 text-xs font-semibold transition-colors flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5" /> Voir la FAQ →
              </a>
            </div>
          </motion.div>

          {/* Right: form */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:col-span-3"
          >
            {sent ? (
              <div className="glass rounded-2xl border border-emerald-500/20 p-10 text-center flex flex-col items-center gap-4 h-full justify-center">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
                <h3 className="text-white font-display font-700 text-xl">Message envoyé !</h3>
                <p className="text-slate-400 text-sm max-w-sm">
                  Merci pour votre message. Nous vous répondrons sous 24–48h ouvrées à l&apos;adresse <strong className="text-slate-300">{form.email}</strong>.
                </p>
                <button
                  onClick={() => { setSent(false); setForm({ name: "", email: "", company: "", subject: "", message: "" }); }}
                  className="mt-2 text-brand-400 hover:text-brand-300 text-sm transition-colors"
                >
                  Envoyer un autre message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="glass rounded-2xl border border-white/10 p-8 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field label="Nom *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Jean Dupont" required />
                  <Field label="Email *" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="jean@cabinet.fr" required />
                </div>
                <Field label="Entreprise" value={form.company} onChange={(v) => setForm({ ...form, company: v })} placeholder="Cabinet d'architecture, BET..." />
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 font-medium">Sujet *</label>
                  <select
                    required
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500/50 transition-colors"
                  >
                    <option value="" disabled>Choisir un sujet...</option>
                    <option value="demo">Demande de démo</option>
                    <option value="question">Question produit</option>
                    <option value="technique">Problème technique</option>
                    <option value="partenariat">Partenariat / intégration</option>
                    <option value="tarifs">Tarifs et abonnement</option>
                    <option value="autre">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 font-medium">Message *</label>
                  <textarea
                    required
                    rows={5}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    placeholder="Décrivez votre besoin ou votre question..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500/50 transition-colors resize-none"
                  />
                </div>
                <p className="text-slate-600 text-xs">
                  En soumettant ce formulaire, vous acceptez notre <a href="/politique-confidentialite" className="text-slate-500 hover:text-slate-300 transition-colors underline">politique de confidentialité</a>.
                </p>
                <button
                  type="submit"
                  disabled={sending}
                  className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-400 disabled:bg-brand-500/50 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {sending ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Envoi en cours...
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      Envoyer le message
                    </>
                  )}
                </button>
              </form>
            )}
          </motion.div>
        </div>
      </div>

      <Footer />
    </main>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required = false }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5 font-medium">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500/50 transition-colors"
      />
    </div>
  );
}
