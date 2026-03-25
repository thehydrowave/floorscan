import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMeasureProjects, upsertMeasureProject } from "@/lib/db";

// GET /api/measure — liste des projets métrés de l'utilisateur
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const projects = await getMeasureProjects(session.user.id);
  return NextResponse.json({ projects });
}

// POST /api/measure — créer ou mettre à jour un projet métré
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json();
  const { id, ...payload } = body;

  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const project = await upsertMeasureProject(session.user.id, id, payload);
  return NextResponse.json({ project });
}
