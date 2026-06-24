import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiBasePath } from "../../infrastructure/apiBase";
import { clearToken, getStoredToken, setToken } from "../../lib/authedFetch";

export interface AppUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface AppSession {
  access_token: string;
  user: AppUser;
}

interface AuthContextValue {
  session: AppSession | null;
  loading: boolean;
  signIn: (token: string, user: AppUser) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(token: string): Promise<AppUser | null> {
  try {
    const res = await fetch(`${apiBasePath()}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json() as Promise<AppUser>;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    fetchMe(token).then((user) => {
      if (user) setSession({ access_token: token, user });
      else clearToken();
      setLoading(false);
    });
  }, []);

  function signIn(token: string, user: AppUser) {
    setToken(token);
    setSession({ access_token: token, user });
  }

  function signOut() {
    clearToken();
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be called inside AuthProvider");
  return ctx;
}
