import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { name, email, company, subject, message } = await request.json();

    if (!name || !email || !subject || !message) {
      return NextResponse.json({ error: "Champs obligatoires manquants" }, { status: 400 });
    }

    // Validation email basique
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      return NextResponse.json({ error: "Email invalide" }, { status: 400 });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const TO_EMAIL       = process.env.CONTACT_TO_EMAIL || "contact@floorscan.ai";

    if (!RESEND_API_KEY) {
      // Fallback dev : log et retourne succès
      console.log("[contact] RESEND_API_KEY non configurée — message non envoyé:", { name, email, subject });
      return NextResponse.json({ ok: true, dev: true });
    }

    const subjectLabels: Record<string, string> = {
      demo:        "Demande de démo",
      question:    "Question produit",
      technique:   "Problème technique",
      partenariat: "Partenariat / intégration",
      tarifs:      "Tarifs et abonnement",
      autre:       "Autre",
    };

    const subjectLabel = subjectLabels[subject] ?? subject;

    // ── Email à l'équipe FloorScan ──────────────────────────────────────────
    const teamHtml = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
    <div style="width:32px;height:32px;background:linear-gradient(135deg,#38bdf8,#0ea5e9);border-radius:8px;display:flex;align-items:center;justify-content:center">
      <span style="color:white;font-size:14px">FS</span>
    </div>
    <span style="font-weight:700;font-size:18px;color:white">FloorScan</span>
  </div>
  <h2 style="margin:0 0 20px;color:white;font-size:20px">📬 Nouveau message de contact</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px 0;color:#94a3b8;width:120px">Nom</td><td style="padding:8px 0;color:white;font-weight:600">${name}</td></tr>
    <tr><td style="padding:8px 0;color:#94a3b8">Email</td><td style="padding:8px 0"><a href="mailto:${email}" style="color:#38bdf8">${email}</a></td></tr>
    <tr><td style="padding:8px 0;color:#94a3b8">Entreprise</td><td style="padding:8px 0;color:white">${company || "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#94a3b8">Sujet</td><td style="padding:8px 0;color:white">${subjectLabel}</td></tr>
  </table>
  <div style="margin-top:20px;padding:16px;background:#1e293b;border-radius:8px;border-left:3px solid #38bdf8">
    <p style="margin:0;color:#cbd5e1;white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
  </div>
  <p style="margin-top:20px;font-size:12px;color:#475569">Répondre directement à : <a href="mailto:${email}" style="color:#38bdf8">${email}</a></p>
</div>
    `.trim();

    // ── Email de confirmation à l'expéditeur ────────────────────────────────
    const confirmHtml = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
    <div style="width:32px;height:32px;background:linear-gradient(135deg,#38bdf8,#0ea5e9);border-radius:8px;display:flex;align-items:center;justify-content:center">
      <span style="color:white;font-size:14px">FS</span>
    </div>
    <span style="font-weight:700;font-size:18px;color:white">FloorScan</span>
  </div>
  <h2 style="margin:0 0 12px;color:white;font-size:20px">Merci pour votre message, ${name.split(" ")[0]} !</h2>
  <p style="color:#94a3b8;line-height:1.6">Nous avons bien reçu votre message concernant <strong style="color:#e2e8f0">${subjectLabel}</strong>.</p>
  <p style="color:#94a3b8;line-height:1.6">Notre équipe vous répondra sous <strong style="color:#38bdf8">24–48h ouvrées</strong>.</p>
  <div style="margin:24px 0;padding:16px;background:#1e293b;border-radius:8px;border-left:3px solid #334155">
    <p style="margin:0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Votre message</p>
    <p style="margin:0;color:#cbd5e1;font-size:14px;white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 300)}${message.length > 300 ? "..." : ""}</p>
  </div>
  <p style="color:#475569;font-size:14px">En attendant, vous pouvez <a href="https://floorscan.ai/demo" style="color:#38bdf8">essayer gratuitement FloorScan</a> ou consulter notre <a href="https://floorscan.ai/#faq" style="color:#38bdf8">FAQ</a>.</p>
  <hr style="border:none;border-top:1px solid #1e293b;margin:24px 0"/>
  <p style="margin:0;font-size:12px;color:#334155">FloorScan — Analyse IA de plans architecturaux · contact@floorscan.ai</p>
</div>
    `.trim();

    // ── Envoi via Resend ────────────────────────────────────────────────────
    const [teamRes, confirmRes] = await Promise.all([
      // Email équipe
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "FloorScan Contact <noreply@floorscan.ai>",
          to:   [TO_EMAIL],
          reply_to: email,
          subject:  `[Contact] ${subjectLabel} — ${name}`,
          html:     teamHtml,
        }),
      }),
      // Email confirmation
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from:    "FloorScan <noreply@floorscan.ai>",
          to:      [email],
          subject: "Votre message a bien été reçu — FloorScan",
          html:    confirmHtml,
        }),
      }),
    ]);

    if (!teamRes.ok) {
      const err = await teamRes.json().catch(() => ({}));
      console.error("[contact] Resend error (team):", err);
      return NextResponse.json({ error: "Erreur d'envoi — réessayez plus tard" }, { status: 502 });
    }

    // Ignorer l'erreur de confirmation (non bloquant)
    if (!confirmRes.ok) {
      console.warn("[contact] Resend warning (confirm):", await confirmRes.json().catch(() => ({})));
    }

    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[contact] Unexpected error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
