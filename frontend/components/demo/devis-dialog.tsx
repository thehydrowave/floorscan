"use client";

import { useState, useEffect } from "react";
import { X, FileSignature, Loader2 } from "lucide-react";
import type { DpgfState, DevisOptions, DevisCompanyInfo, DevisClientInfo } from "@/lib/types";
import { downloadDevisPdf } from "@/lib/devis-pdf";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { toast } from "@/components/ui/use-toast";

interface DevisDialogProps {
  dpgf: DpgfState;
  onClose: () => void;
}

const STORAGE_KEY = "floorscan_company_info";

function generateQuoteNumber(): string {
  const now = new Date();
  const yy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DEV-${yy}-${mm}${dd}-${rand}`;
}

export default function DevisDialog({ dpgf, onClose }: DevisDialogProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // Company info
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companySiret, setCompanySiret] = useState("");
  const [companyRcs, setCompanyRcs] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyRge, setCompanyRge] = useState("");
  const [companyAssurance, setCompanyAssurance] = useState("");

  // Client info
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");

  // Quote params
  const [quoteNumber, setQuoteNumber] = useState(generateQuoteNumber);
  const [validityDays, setValidityDays] = useState(30);
  const [paymentTerms, setPaymentTerms] = useState("30% a la commande, solde a la reception des travaux");
  const [executionDelay, setExecutionDelay] = useState("");
  const [notes, setNotes] = useState("");

  const [generating, setGenerating] = useState(false);

  // Load persisted company info
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const c = JSON.parse(stored) as DevisCompanyInfo;
        if (c.name) setCompanyName(c.name);
        if (c.address) setCompanyAddress(c.address);
        if (c.siret) setCompanySiret(c.siret);
        if (c.rcs) setCompanyRcs(c.rcs);
        if (c.phone) setCompanyPhone(c.phone);
        if (c.email) setCompanyEmail(c.email);
        if (c.rge) setCompanyRge(c.rge);
        if (c.assurance) setCompanyAssurance(c.assurance);
      }
    } catch { /* ignore */ }
  }, []);

  // Save company info on change
  const saveCompanyInfo = () => {
    const info: DevisCompanyInfo = {
      name: companyName, address: companyAddress, siret: companySiret,
      rcs: companyRcs, phone: companyPhone, email: companyEmail,
      rge: companyRge, assurance: companyAssurance,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(info)); } catch { /* ignore */ }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    saveCompanyInfo();
    try {
      const company: DevisCompanyInfo = {
        name: companyName, address: companyAddress, siret: companySiret,
        rcs: companyRcs, phone: companyPhone, email: companyEmail,
        rge: companyRge, assurance: companyAssurance,
      };
      const client: DevisClientInfo = {
        name: clientName, address: clientAddress,
        phone: clientPhone, email: clientEmail,
      };
      const options: DevisOptions = {
        quote_number: quoteNumber,
        validity_days: validityDays,
        payment_terms: paymentTerms,
        execution_delay: executionDelay,
        company, client, notes,
        date: new Date().toLocaleDateString("fr-FR"),
      };
      await downloadDevisPdf(dpgf, options, lang);
      toast({ title: d("devis_generated" as DTKey), variant: "success" });
      onClose();
    } catch (e: any) {
      toast({ title: d("devis_error" as DTKey), description: e.message, variant: "error" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative glass rounded-2xl border border-white/10 w-full max-w-xl p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh]">
        {/* Close */}
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div>
          <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-sky-400" />
            {d("devis_title" as DTKey)}
          </h3>
          <p className="text-xs text-slate-500 mt-1">{d("devis_generate" as DTKey)}</p>
        </div>

        {/* Company info */}
        <Section title={d("devis_company" as DTKey)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={d("devis_company_name" as DTKey)} value={companyName} onChange={setCompanyName} placeholder="Ex: ABC Renovation SARL" />
            <Field label={d("devis_company_addr" as DTKey)} value={companyAddress} onChange={setCompanyAddress} placeholder="Ex: 12 rue de la Paix, 75002 Paris" />
            <Field label={d("devis_siret" as DTKey)} value={companySiret} onChange={setCompanySiret} placeholder="123 456 789 00012" />
            <Field label={d("devis_rcs" as DTKey)} value={companyRcs} onChange={setCompanyRcs} placeholder="RCS Paris 123 456 789" />
            <Field label={d("devis_phone" as DTKey)} value={companyPhone} onChange={setCompanyPhone} placeholder="06 12 34 56 78" />
            <Field label={d("devis_email" as DTKey)} value={companyEmail} onChange={setCompanyEmail} placeholder="contact@abc-reno.fr" />
            <Field label={d("devis_rge" as DTKey)} value={companyRge} onChange={setCompanyRge} placeholder="Optionnel" />
            <Field label={d("devis_assurance" as DTKey)} value={companyAssurance} onChange={setCompanyAssurance} placeholder="Optionnel" />
          </div>
        </Section>

        {/* Client info */}
        <Section title={d("devis_client" as DTKey)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={d("devis_client_name" as DTKey)} value={clientName} onChange={setClientName} placeholder="M. / Mme Dupont" />
            <Field label={d("devis_client_addr" as DTKey)} value={clientAddress} onChange={setClientAddress} placeholder="Adresse du client" />
            <Field label={d("devis_phone" as DTKey)} value={clientPhone} onChange={setClientPhone} placeholder="06 98 76 54 32" />
            <Field label={d("devis_email" as DTKey)} value={clientEmail} onChange={setClientEmail} placeholder="client@email.com" />
          </div>
        </Section>

        {/* Quote params */}
        <Section title="Devis">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={d("devis_quote_number" as DTKey)} value={quoteNumber} onChange={setQuoteNumber} />
            <div>
              <label className="block text-xs text-slate-400 mb-1">{d("devis_validity" as DTKey)}</label>
              <input
                type="number" min={1} max={120}
                value={validityDays}
                onChange={(e) => setValidityDays(parseInt(e.target.value) || 30)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 transition-colors"
              />
            </div>
            <Field label={d("devis_payment" as DTKey)} value={paymentTerms} onChange={setPaymentTerms} />
            <Field label={d("devis_execution" as DTKey)} value={executionDelay} onChange={setExecutionDelay} placeholder="Ex: 4 semaines" />
          </div>
          <div className="mt-3">
            <label className="block text-xs text-slate-400 mb-1">{d("devis_notes" as DTKey)}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Observations, conditions particulieres..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 transition-colors resize-none"
            />
          </div>
        </Section>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-white font-semibold text-sm transition-colors"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {d("devis_generating" as DTKey)}
            </>
          ) : (
            <>
              <FileSignature className="w-4 h-4" />
              {d("devis_generate" as DTKey)}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-2">{title}</h4>
      {children}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 transition-colors"
      />
    </div>
  );
}
