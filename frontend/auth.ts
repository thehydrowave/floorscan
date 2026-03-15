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
          const user = await getUserByEmail(email);
          if (user && compareSync(password, user.password)) {
            return { id: user.id, email: user.email, name: user.name, role: user.role };
          }
        } catch {
          // DB error — fallthrough to env check
        }

        // 2) Fallback: check admin credentials from env vars
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
