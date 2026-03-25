import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { hashSync } from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ error: "Token et mot de passe requis" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Le mot de passe doit contenir au moins 8 caractères" }, { status: 400 });
    }

    const sql = getSql();

    // Récupérer le token
    const rows = await sql`
      SELECT * FROM password_reset_tokens
      WHERE token = ${token}
        AND used = false
        AND expires_at > NOW()
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 400 });
    }

    const resetToken = rows[0];

    // Mettre à jour le mot de passe
    const hashed = hashSync(password, 12);
    await sql`
      UPDATE users SET password = ${hashed}, updated_at = NOW()
      WHERE id = ${resetToken.user_id}
    `;

    // Marquer le token comme utilisé
    await sql`
      UPDATE password_reset_tokens SET used = true WHERE id = ${resetToken.id}
    `;

    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[reset-password] error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
