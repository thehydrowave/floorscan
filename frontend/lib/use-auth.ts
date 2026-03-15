"use client";

import { useSession } from "next-auth/react";

export function useAuth() {
  const { data: session, status } = useSession();
  return {
    session,
    status,
    isLoggedIn: status === "authenticated",
    isLoading: status === "loading",
    isAdmin: (session?.user as any)?.role === "admin",
    user: session?.user ?? null,
  };
}
