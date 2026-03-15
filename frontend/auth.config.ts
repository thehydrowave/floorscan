import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config (no bcryptjs / better-sqlite3).
 * Used by middleware.ts for JWT verification only.
 * Full provider config with credentials is in auth.ts.
 */
export const authConfig: NextAuthConfig = {
  providers: [], // providers are added in auth.ts (not Edge-safe)
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role as string;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAdmin = (auth?.user as any)?.role === "admin";
      const pathname = nextUrl.pathname;

      const protectedPaths = ["/demo", "/measure"];
      const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
      const isAdminRoute = pathname.startsWith("/admin");

      if (isProtected && !isLoggedIn) return false;
      if (isAdminRoute && !isLoggedIn) return false;
      if (isAdminRoute && !isAdmin) {
        return Response.redirect(new URL("/", nextUrl.origin));
      }

      return true;
    },
  },
};
