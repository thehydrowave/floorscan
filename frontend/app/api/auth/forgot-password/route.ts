import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, getSql } from "@/lib/db";

// ── Génère un token sécurisé et l'enregistre en base ──────────────────────
async function createResetToken(userId: string): Promise<string> {
  const sql = getSql();

  // Créer la table si elle n'existe pas (idempotent)
  await sql`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used       BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Supprimer les anciens tokens de cet utilisateur
  await sql`DELETE FROM password_reset_tokens WHERE user_id = ${userId}`;

  const token = crypto.randomUUID() + "-" + crypto.randomUUID();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

  await sql`
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at)
    VALUES (${id}, ${userId}, ${token}, ${expiresAt.toISOString()})
  `;

  return token;
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email requis" }, { status: 400 });
    }

    // Toujours répondre OK pour éviter l'énumération d'emails
    const user = await getUserByEmail(email).catch(() => null);

    if (user) {
      const token = await createResetToken(user.id);
      const resetUrl = `${process.env.NEXTAUTH_URL || "https://floorscan.ai"}/reset-password?token=${token}`;

      const RESEND_API_KEY = process.env.RESEND_API_KEY;

      if (RESEND_API_KEY) {
        const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
    <div style="width:32px;height:32px;background:linear-gradient(135deg,#38bdf8,#0ea5e9);border-radius:8px;display:flex;align-items:center;justify-content:center">
      <span style="color:white;font-size:14px">FS</span>
    </div>
    <span style="font-weight:700;font-size:18px;color:white">FloorScan</span>
  </div>
  <h2 style="margin:0 0 12px;color:white;font-size:20px">Réinitialisation de votre mot de passe</h2>
  <p style="color:#94a3b8;line-height:1.6;margin-bottom:24px">
    Vous avez demandé la réinitialisation du mot de passe associé à <strong style="color:#e2e8f0">${email}</strong>.
    Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
  </p>
  <div style="text-align:center;margin:32px 0">
    <a href="${resetUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:white;font-weight:600;font-size:15px;text-decoration:none;border-radius:10px">
      Réinitialiser mon mot de passe
    </a>
  </div>
  <p style="color:#64748b;font-size:13px;line-height:1.6">
    Ce lien est valable <strong style="color:#94a3b8">1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email — votre mot de passe ne sera pas modifié.
  </p>
  <hr style="border:none;border-top:1px solid #1e293b;margin:24px 0"/>
  <p style="margin:0;font-size:11px;color:#334155">
    FloorScan · contact@floorscan.ai · <a href="${resetUrl}" style="color:#475569">${resetUrl.slice(0, 60)}...</a>
  </p>
</div>
        `.trim();

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from:    "FloorScan <noreply@floorscan.ai>",
            to:      [email],
            subject: "Réinitialisation de votre mot de passe FloorScan",
            html,
          }),
        });
      } else {
        // Dev fallback — log le lien
        console.log(`[forgot-password] Reset URL: ${resetUrl}`);
      }
    }

    // Répondre OK dans tous les cas (sécurité anti-énumération)
    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[forgot-password] error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
