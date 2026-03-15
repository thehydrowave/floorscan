import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Use Edge-safe config (no bcryptjs / better-sqlite3)
// The authorized() callback in auth.config.ts handles route protection
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/demo/:path*", "/measure/:path*", "/admin/:path*"],
};
