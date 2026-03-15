import Database from "better-sqlite3";
import path from "path";
import { hashSync } from "bcryptjs";

// Store DB file at project root (outside /app to avoid HMR issues)
const DB_PATH = path.join(process.cwd(), "floorscan-auth.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Create users table
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      password   TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Seed default admin if not exists
  const adminEmail = process.env.ADMIN_EMAIL || "admin@floorscan.local";
  const adminPassword = process.env.ADMIN_PASSWORD || "AdminFloorscan2024!";
  const existing = _db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
  if (!existing) {
    const id = crypto.randomUUID();
    const hashed = hashSync(adminPassword, 12);
    _db.prepare(
      "INSERT INTO users (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)"
    ).run(id, adminEmail, "Admin", hashed, "admin");
  }

  return _db;
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
export function getUserByEmail(email: string): DbUser | undefined {
  return getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as DbUser | undefined;
}

export function getUserById(id: string): DbUser | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as DbUser | undefined;
}

export function getAllUsers(): Omit<DbUser, "password">[] {
  return getDb()
    .prepare("SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY created_at DESC")
    .all() as Omit<DbUser, "password">[];
}

export function createUser(email: string, name: string, password: string, role: "admin" | "user" = "user"): DbUser {
  const id = crypto.randomUUID();
  const hashed = hashSync(password, 12);
  getDb().prepare(
    "INSERT INTO users (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)"
  ).run(id, email, name, hashed, role);
  return getUserById(id)!;
}

export function updateUser(id: string, data: { name?: string; role?: "admin" | "user" }): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { sets.push("name = ?"); values.push(data.name); }
  if (data.role !== undefined) { sets.push("role = ?"); values.push(data.role); }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteUser(id: string): void {
  getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
}
