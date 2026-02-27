"use client";

import { ReactNode } from "react";

/**
 * Auth state is provided by Better Auth's `useSession` hook directly.
 * This component exists only as a layout slot — no custom context needed.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
