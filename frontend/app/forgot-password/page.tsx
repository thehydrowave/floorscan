"use client";

import { useState } from "react";
import Link from "next/link";
import { ScanLine, Loader2, ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erreur serveur");
      } else {
        setSent(true);
      }
    } catch {
      setError("Une erreur est survenue, réessayez.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center">
              <ScanLine className="w-4 h-4 text-white" />
            </div>
            <span className="font-display text-2xl font-700 bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">
              FloorScan
            </span>
          </Link>
        </div>

        <div className="glass rounded-2xl border border-white/10 p-8">
          {sent ? (
            /* ── État envoyé ── */
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <h1 className="font-display text-xl font-700 text-white mb-2">Email envoyé !</h1>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                Si un compte existe pour <strong className="text-slate-300">{email}</strong>, vous recevrez un email avec un lien de réinitialisation valable <strong className="text-slate-300">1 heure</strong>.
              </p>
              <p className="text-slate-500 text-xs mb-6">
                Vérifiez aussi vos spams si vous ne voyez rien dans les prochaines minutes.
              </p>
              <Link href="/login" className="text-brand-400 hover:text-brand-300 transition-colors text-sm flex items-center justify-center gap-1.5">
                <ArrowLeft className="w-3.5 h-3.5" />
                Retour à la connexion
              </Link>
            </div>
          ) : (
            /* ── Formulaire ── */
            <>
              <div className="mb-6">
                <div className="w-10 h-10 rounded-xl bg-brand-950/50 border border-brand-900/50 flex items-center justify-center mb-4">
                  <Mail className="w-5 h-5 text-brand-400" />
                </div>
                <h1 className="font-display text-xl font-700 text-white mb-1">
                  Mot de passe oublié
                </h1>
                <p className="text-sm text-slate-400">
                  Entrez votre adresse email et nous vous enverrons un lien pour réinitialiser votre mot de passe.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-xs font-semibold text-slate-400 mb-1.5">
                    Adresse email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    placeholder="votre@email.com"
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/25 transition-colors"
                  />
                </div>

                {error && (
                  <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Envoi en cours...</>
                  ) : (
                    "Envoyer le lien de réinitialisation"
                  )}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link href="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Retour à la connexion
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
