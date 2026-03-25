import { neon } from "@neondatabase/serverless";
import { hashSync } from "bcryptjs";

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return neon(process.env.DATABASE_URL);
}

// ── Ensure tables exist (idempotent) ──────────────────────────────────────
let initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit();
  }
  return initPromise;
}

async function doInit(): Promise<void> {
  const sql = getSql();

  // ── Users ──
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

  // ── Password reset tokens ──
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

  // ── Chantier projects ──
  await sql`
    CREATE TABLE IF NOT EXISTS chantier_projects (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data       JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // ── Measure projects (métré manuel) ──
  await sql`
    CREATE TABLE IF NOT EXISTS measure_projects (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            TEXT NOT NULL DEFAULT 'Sans titre',
      surface_types   JSONB NOT NULL DEFAULT '[]',
      zones           JSONB NOT NULL DEFAULT '[]',
      ppm             DOUBLE PRECISION,
      tva_rate        DOUBLE PRECISION NOT NULL DEFAULT 10,
      project_name    TEXT NOT NULL DEFAULT '',
      client_name     TEXT NOT NULL DEFAULT '',
      client_address  TEXT NOT NULL DEFAULT '',
      quote_number    TEXT NOT NULL DEFAULT '',
      quote_date      TEXT NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

// ── Query helpers — Users ──────────────────────────────────────────────────
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

// ── Query helpers — Chantier ───────────────────────────────────────────────

export async function getChantierProject(userId: string): Promise<Record<string, unknown> | null> {
  await ensureInit();
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM chantier_projects
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0].data as Record<string, unknown>;
}

export async function upsertChantierProject(
  userId: string,
  data: Record<string, unknown>
): Promise<void> {
  await ensureInit();
  const sql = getSql();
  const existing = await sql`
    SELECT id FROM chantier_projects WHERE user_id = ${userId} LIMIT 1
  `;
  if (existing.length === 0) {
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO chantier_projects (id, user_id, data)
      VALUES (${id}, ${userId}, ${JSON.stringify(data)})
    `;
  } else {
    await sql`
      UPDATE chantier_projects
      SET data = ${JSON.stringify(data)}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;
  }
}

export async function deleteChantierProject(userId: string): Promise<void> {
  await ensureInit();
  const sql = getSql();
  await sql`DELETE FROM chantier_projects WHERE user_id = ${userId}`;
}

// ── Query helpers — Measure projects ──────────────────────────────────────

export interface DbMeasureProject {
  id: string;
  user_id: string;
  name: string;
  surface_types: unknown[];
  zones: unknown[];
  ppm: number | null;
  tva_rate: number;
  project_name: string;
  client_name: string;
  client_address: string;
  quote_number: string;
  quote_date: string;
  created_at: string;
  updated_at: string;
}

export async function getMeasureProjects(userId: string): Promise<DbMeasureProject[]> {
  await ensureInit();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM measure_projects
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;
  return rows as DbMeasureProject[];
}

export async function getMeasureProject(
  id: string,
  userId: string
): Promise<DbMeasureProject | null> {
  await ensureInit();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM measure_projects
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return (rows[0] as DbMeasureProject) ?? null;
}

export async function upsertMeasureProject(
  userId: string,
  projectId: string,
  payload: {
    name?: string;
    surface_types: unknown[];
    zones: unknown[];
    ppm?: number | null;
    tva_rate?: number;
    project_name?: string;
    client_name?: string;
    client_address?: string;
    quote_number?: string;
    quote_date?: string;
  }
): Promise<DbMeasureProject> {
  await ensureInit();
  const sql = getSql();
  const existing = await sql`
    SELECT id FROM measure_projects WHERE id = ${projectId} AND user_id = ${userId}
  `;
  if (existing.length === 0) {
    await sql`
      INSERT INTO measure_projects (
        id, user_id, name, surface_types, zones, ppm, tva_rate,
        project_name, client_name, client_address, quote_number, quote_date
      ) VALUES (
        ${projectId},
        ${userId},
        ${payload.name ?? "Sans titre"},
        ${JSON.stringify(payload.surface_types)},
        ${JSON.stringify(payload.zones)},
        ${payload.ppm ?? null},
        ${payload.tva_rate ?? 10},
        ${payload.project_name ?? ""},
        ${payload.client_name ?? ""},
        ${payload.client_address ?? ""},
        ${payload.quote_number ?? ""},
        ${payload.quote_date ?? ""}
      )
    `;
  } else {
    await sql`
      UPDATE measure_projects SET
        name           = ${payload.name ?? "Sans titre"},
        surface_types  = ${JSON.stringify(payload.surface_types)},
        zones          = ${JSON.stringify(payload.zones)},
        ppm            = ${payload.ppm ?? null},
        tva_rate       = ${payload.tva_rate ?? 10},
        project_name   = ${payload.project_name ?? ""},
        client_name    = ${payload.client_name ?? ""},
        client_address = ${payload.client_address ?? ""},
        quote_number   = ${payload.quote_number ?? ""},
        quote_date     = ${payload.quote_date ?? ""},
        updated_at     = NOW()
      WHERE id = ${projectId} AND user_id = ${userId}
    `;
  }
  return (await getMeasureProject(projectId, userId))!;
}

export async function deleteMeasureProject(id: string, userId: string): Promise<void> {
  await ensureInit();
  const sql = getSql();
  await sql`DELETE FROM measure_projects WHERE id = ${id} AND user_id = ${userId}`;
}
