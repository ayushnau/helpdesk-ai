"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { type AuthState, getAuthState, setAuthState, clearAuthState } from "@/lib/session";

type AuthContextValue = {
  auth: AuthState | null;
  isLoggedIn: boolean;
  login: (tenantId: string, tenantName: string, displayName: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  auth: null,
  isLoggedIn: false,
  login: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setAuth(getAuthState());
    setHydrated(true);
  }, []);

  const login = useCallback((tenantId: string, tenantName: string, displayName: string) => {
    const state: AuthState = { loggedIn: true, tenantId, tenantName, displayName };
    setAuthState(state);
    setAuth(state);
    router.push("/dashboard");
  }, [router]);

  const logout = useCallback(() => {
    clearAuthState();
    setAuth(null);
    router.push("/");
  }, [router]);

  // Don't render children until we've read localStorage to avoid hydration mismatch
  if (!hydrated) {
    return null;
  }

  return (
    <AuthContext.Provider value={{ auth, isLoggedIn: !!auth?.loggedIn, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, router, pathname]);

  if (!isLoggedIn) return null;

  return <>{children}</>;
}
