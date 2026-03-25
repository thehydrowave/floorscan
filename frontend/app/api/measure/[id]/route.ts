import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMeasureProject, deleteMeasureProject } from "@/lib/db";

// GET /api/measure/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const project = await getMeasureProject(params.id, session.user.id);
  if (!project) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ project });
}

// DELETE /api/measure/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  await deleteMeasureProject(params.id, session.user.id);
  return NextResponse.json({ ok: true });
}
