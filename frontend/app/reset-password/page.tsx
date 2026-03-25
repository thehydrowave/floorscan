"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { ScanLine, Loader2, CheckCircle2, XCircle, Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8 caractères minimum", ok: password.length >= 8 },
    { label: "Une majuscule", ok: /[A-Z]/.test(password) },
    { label: "Un chiffre", ok: /[0-9]/.test(password) },
  ];
  const score = checks.filter(c => c.ok).length;
  const colors = ["bg-red-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-400"];
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[0,1,2].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < score ? colors[score] : "bg-slate-700"}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        {checks.map(c => (
          <span key={c.label} className={`text-xs flex items-center gap-1 ${c.ok ? "text-emerald-400" : "text-slate-600"}`}>
            {c.ok ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-slate-700 inline-block" />}
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ResetForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (!token) {
    return (
      <div className="text-center py-4">
        <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-slate-300 text-sm mb-4">Lien invalide ou manquant.</p>
        <Link href="/forgot-password" className="text-brand-400 hover:text-brand-300 text-sm transition-colors">
          Demander un nouveau lien →
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères");
      return;
    }
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur serveur");
      } else {
        setDone(true);
        setTimeout(() => router.push("/login"), 3000);
      }
    } catch {
      setError("Une erreur est survenue, réessayez.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-7 h-7 text-emerald-400" />
        </div>
        <h2 className="font-display text-lg font-700 text-white mb-2">Mot de passe modifié !</h2>
        <p className="text-slate-400 text-sm mb-4">
          Votre mot de passe a été mis à jour avec succès.<br />
          Redirection vers la connexion dans 3 secondes...
        </p>
        <Link href="/login" className="text-brand-400 hover:text-brand-300 text-sm transition-colors">
          Se connecter maintenant →
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand-950/50 border border-brand-900/50 flex items-center justify-center mb-4">
          <KeyRound className="w-5 h-5 text-brand-400" />
        </div>
        <h1 className="font-display text-xl font-700 text-white mb-1">Nouveau mot de passe</h1>
        <p className="text-sm text-slate-400">Choisissez un mot de passe sécurisé pour votre compte.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Nouveau mot de passe</label>
          <div className="relative">
            <input
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              placeholder="Min. 8 caractères"
              className="w-full px-3 py-2.5 pr-10 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/25 transition-colors"
            />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {password && <PasswordStrength password={password} />}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Confirmer le mot de passe</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            placeholder="Retapez le mot de passe"
            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/25 transition-colors"
          />
          {confirm && password !== confirm && (
            <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
              <XCircle className="w-3 h-3" /> Les mots de passe ne correspondent pas
            </p>
          )}
          {confirm && password === confirm && confirm.length >= 8 && (
            <p className="mt-1 text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Les mots de passe correspondent
            </p>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={loading || password !== confirm || password.length < 8}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Mise à jour...</> : "Enregistrer le nouveau mot de passe"}
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-4">
      <div className="w-full max-w-md">
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
          <Suspense fallback={
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
            </div>
          }>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
