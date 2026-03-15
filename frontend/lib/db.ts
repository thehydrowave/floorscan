import { neon } from "@neondatabase/serverless";
import { hashSync } from "bcryptjs";

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return neon(process.env.DATABASE_URL);
}

// ── Ensure table exists (idempotent) ──────────────────────────────────────
let initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit();
  }
  return initPromise;
}

async function doInit(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      password   TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Seed default admin if not exists
  const adminEmail = process.env.ADMIN_EMAIL || "admin@floorscan.local";
  const adminPassword = process.env.ADMIN_PASSWORD || "AdminFloorscan2024!";
  const existing = await sql`SELECT id FROM users WHERE email = ${adminEmail}`;
  if (existing.length === 0) {
    const id = crypto.randomUUID();
    const hashed = hashSync(adminPassword, 12);
    await sql`
      INSERT INTO users (id, email, name, password, role)
      VALUES (${id}, ${adminEmail}, ${"Admin"}, ${hashed}, ${"admin"})
    `;
  }
}

// ── User types ─────────────────────────────────────────────────────────────
export interface DbUser {
  id: string;
  email: string;
  name: string;
  password: string;
  role: "admin" | "user";
  created_at: string;
  updated_at: string;
}

// ── Query helpers ──────────────────────────────────────────────────────────
export async function getUserByEmail(email: string): Promise<DbUser | undefined> {
  await ensureInit();
  const sql = getSql();
  const rows = await sql`SELECT * FROM users WHERE email = ${email}`;
  return rows[0] as DbUser | undefined;
}

export async function getUserById(id: string): Promise<DbUser | undefined> {
  await ensureInit();
  const sql = getSql();
  const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] as DbUser | undefined;
}

export async function getAllUsers(): Promise<Omit<DbUser, "password">[]> {
  await ensureInit();
  const sql = getSql();
  const rows = await sql`
    SELECT id, email, name, role, created_at, updated_at
    FROM users
    ORDER BY created_at DESC
  `;
  return rows as Omit<DbUser, "password">[];
}

export async function createUser(
  email: string,
  name: string,
  password: string,
  role: "admin" | "user" = "user"
): Promise<DbUser> {
  await ensureInit();
  const sql = getSql();
  const id = crypto.randomUUID();
  const hashed = hashSync(password, 12);
  await sql`
    INSERT INTO users (id, email, name, password, role)
    VALUES (${id}, ${email}, ${name}, ${hashed}, ${role})
  `;
  return (await getUserById(id))!;
}

export async function updateUser(
  id: string,
  data: { name?: string; role?: "admin" | "user" }
): Promise<void> {
  await ensureInit();
  const sql = getSql();
  if (data.name !== undefined && data.role !== undefined) {
    await sql`UPDATE users SET name = ${data.name}, role = ${data.role}, updated_at = NOW() WHERE id = ${id}`;
  } else if (data.name !== undefined) {
    await sql`UPDATE users SET name = ${data.name}, updated_at = NOW() WHERE id = ${id}`;
  } else if (data.role !== undefined) {
    await sql`UPDATE users SET role = ${data.role}, updated_at = NOW() WHERE id = ${id}`;
  }
}

export async function deleteUser(id: string): Promise<void> {
  await ensureInit();
  const sql = getSql();
  await sql`DELETE FROM users WHERE id = ${id}`;
}
