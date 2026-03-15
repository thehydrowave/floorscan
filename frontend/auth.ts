import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compareSync } from "bcryptjs";
import { authConfig } from "./auth.config";

// Try to load SQLite DB — fails gracefully on Vercel (no native modules)
let getUserByEmail: ((email: string) => { id: string; email: string; name: string; password: string; role: string } | undefined) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require("@/lib/db");
  getUserByEmail = db.getUserByEmail;
} catch {
  // SQLite not available (Vercel serverless) — will fallback to env admin
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email as string;
        const password = credentials.password as string;

        // 1) Try SQLite DB first (local dev)
        if (getUserByEmail) {
          try {
            const user = getUserByEmail(email);
            if (user && compareSync(password, user.password)) {
              return { id: user.id, email: user.email, name: user.name, role: user.role };
            }
          } catch {
            // DB error — fallthrough to env check
          }
        }

        // 2) Fallback: check admin credentials from env vars (Vercel)
        const adminEmail = process.env.ADMIN_EMAIL || "admin@floorscan.local";
        const adminPassword = process.env.ADMIN_PASSWORD || "AdminFloorscan2024!";
        if (email === adminEmail && password === adminPassword) {
          return { id: "admin-env", email: adminEmail, name: "Admin", role: "admin" };
        }

        return null;
      },
    }),
  ],
});
