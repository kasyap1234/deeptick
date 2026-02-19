"use client";

import { createAuthClient } from "better-auth/react";
import { ReactNode, createContext, useContext, useEffect, useState } from "react";

const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
});

interface Session {
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
  };
  session: {
    id: string;
    expiresAt: Date;
  };
}

interface AuthContextType {
  session: Session | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data } = await authClient.useSession();
        setSession(data as Session | null);
      } catch {
        setSession(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useSession() {
  const { session, loading } = useContext(AuthContext);
  return {
    data: session,
    isPending: loading,
  };
}

export function useSignOut() {
  return async () => {
    await authClient.signOut();
  };
}
