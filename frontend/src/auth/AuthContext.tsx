import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import { apiLogin, apiAdminLogin, apiMe, PublicUser, TOKEN_KEY, registerUnauthorizedHandler } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

type AuthState = {
  user: PublicUser | null;
  initializing: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  adminSignIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (patch: Partial<PublicUser>) => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string>(TOKEN_KEY, null as any);
      if (token) {
        try {
          const me = await apiMe();
          setUser(me);
        } catch {
          await storage.secureRemove(TOKEN_KEY);
        }
      }
      setInitializing(false);
    })();
  }, []);

  // When any protected request gets a 401 (expired/invalid token), the API
  // client clears the token and calls this handler -> user becomes null ->
  // the (app)/admin route guards redirect to /login. No more stuck screens
  // showing "Invalid or missing authentication token".
  useEffect(() => registerUnauthorizedHandler(() => setUser(null)), []);

  const signIn = useCallback(async (username: string, password: string) => {
    const res = await apiLogin(username, password);
    await storage.secureSet(TOKEN_KEY, res.access_token);
    setUser(res.user);
  }, []);

  const adminSignIn = useCallback(async (username: string, password: string) => {
    const res = await apiAdminLogin(username, password);
    await storage.secureSet(TOKEN_KEY, res.access_token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  }, []);

  const updateUser = useCallback((patch: Partial<PublicUser>) => {
    setUser((u) => (u ? { ...u, ...patch } : u));
  }, []);

  return (
    <AuthContext.Provider value={{ user, initializing, signIn, adminSignIn, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
