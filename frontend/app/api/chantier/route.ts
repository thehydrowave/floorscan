import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getChantierProject, upsertChantierProject, deleteChantierProject } from "@/lib/db";

// GET /api/chantier — charger le projet chantier de l'utilisateur connecté
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const data = await getChantierProject(session.user.id);
  return NextResponse.json({ data });
}

// POST /api/chantier — sauvegarder (upsert) le projet chantier
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json();
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  // Exclure l'image du plan avant de persister (trop volumineuse pour la DB)
  const { planImageB64: _img, ...safeData } = body as Record<string, unknown>;
  await upsertChantierProject(session.user.id, safeData);
  return NextResponse.json({ ok: true });
}

// DELETE /api/chantier — supprimer le projet chantier
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  await deleteChantierProject(session.user.id);
  return NextResponse.json({ ok: true });
}
