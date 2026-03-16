import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compareSync } from "bcryptjs";
import { authConfig } from "./auth.config";
import { getUserByEmail } from "@/lib/db";

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

        // 1) Try Neon DB
        try {
          console.log("[auth] Trying DB login for:", email);
          console.log("[auth] DATABASE_URL set:", !!process.env.DATABASE_URL);
          const user = await getUserByEmail(email);
          console.log("[auth] DB user found:", !!user);
          if (user && compareSync(password, user.password)) {
            console.log("[auth] DB login success for:", email);
            return { id: user.id, email: user.email, name: user.name, role: user.role };
          }
          console.log("[auth] DB password mismatch for:", email);
        } catch (err) {
          console.error("[auth] DB error:", (err as Error).message);
        }

        // 2) Fallback: check admin credentials from env vars
        const adminEmail = process.env.ADMIN_EMAIL || "admin@floorscan.local";
        const adminPassword = process.env.ADMIN_PASSWORD || "AdminFloorscan2024!";
        console.log("[auth] Env fallback — ADMIN_EMAIL set:", !!process.env.ADMIN_EMAIL, "match:", email === adminEmail);
        if (email === adminEmail && password === adminPassword) {
          console.log("[auth] Env fallback login success");
          return { id: "admin-env", email: adminEmail, name: "Admin", role: "admin" };
        }
        console.log("[auth] All login methods failed for:", email);

        return null;
      },
    }),
  ],
});
