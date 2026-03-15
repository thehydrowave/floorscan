import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateUser, deleteUser, getUserById } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const { name, role } = await request.json();
  await updateUser(id, { name, role });
  const updated = await getUserById(id);
  return NextResponse.json({
    id: updated?.id,
    email: updated?.email,
    name: updated?.name,
    role: updated?.role,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  // Prevent admin from deleting themselves
  if (id === session.user.id) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }
  await deleteUser(id);
  return NextResponse.json({ ok: true });
}
