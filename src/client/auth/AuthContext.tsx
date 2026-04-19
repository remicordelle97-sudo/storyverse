import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
  plan: string;
  onboardedAt: string | null;
}

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  accessToken: string | null;
  loading: boolean;
  isImpersonating: boolean;
  impersonatedUser: User | null;
  login: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  startImpersonation: (token: string, targetUser: User) => void;
  stopImpersonation: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

// Module-level token so the API client can access it without React
let currentAccessToken: string | null = null;
export function getAccessToken() {
  return currentAccessToken;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Impersonation state
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const isImpersonating = adminToken !== null;
  const impersonatedUser = isImpersonating ? user : null;

  const updateToken = (token: string | null) => {
    currentAccessToken = token;
    setAccessToken(token);
  };

  const startImpersonation = (token: string, targetUser: User) => {
    // Save current admin session
    setAdminToken(accessToken);
    setAdminUser(user);
    // Switch to impersonated user
    updateToken(token);
    setUser(targetUser);
    // Drop every react-query entry so the impersonated session doesn't
    // render the admin's cached stories/universes while the new ones load.
    queryClient.clear();
    // Persist impersonation so it survives page navigation
    sessionStorage.setItem("impersonation", JSON.stringify({
      adminToken: accessToken,
      adminUser: user,
      token,
      user: targetUser,
    }));
  };

  const stopImpersonation = () => {
    if (adminToken && adminUser) {
      updateToken(adminToken);
      setUser(adminUser);
    }
    setAdminToken(null);
    setAdminUser(null);
    sessionStorage.removeItem("impersonation");
    queryClient.clear();
  };

  const refreshUser = useCallback(async () => {
    try {
      // Refresh the JWT to pick up any changes (e.g. new familyId)
      const tokenRes = await fetch("/api/auth/refresh", { method: "POST" });
      if (tokenRes.ok) {
        const { accessToken: newToken } = await tokenRes.json();
        updateToken(newToken);

        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${newToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Try to restore session on mount
  useEffect(() => {
    (async () => {
      try {
        // Check for active impersonation first
        const saved = sessionStorage.getItem("impersonation");
        if (saved) {
          const imp = JSON.parse(saved);
          setAdminToken(imp.adminToken);
          setAdminUser(imp.adminUser);
          updateToken(imp.token);
          setUser(imp.user);
          setLoading(false);
          return;
        }

        // Normal session refresh
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (res.ok) {
          const { accessToken: token } = await res.json();
          updateToken(token);

          const meRes = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (meRes.ok) {
            setUser(await meRes.json());
          }
        }
      } catch {
        // No valid session
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (credential: string) => {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });

    if (!res.ok) {
      throw new Error("Login failed");
    }

    const data = await res.json();
    // Clear any cache from a previous session before we swap in the new user,
    // so we never briefly render the prior user's library/quotas.
    queryClient.clear();
    updateToken(data.accessToken);
    setUser(data.user);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    updateToken(null);
    setUser(null);
    localStorage.removeItem("universeId");
    queryClient.clear();
  };

  // Admin retains full powers during impersonation
  const isAdmin = user?.role === "admin" || (isImpersonating && adminUser?.role === "admin");

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        accessToken,
        loading,
        isImpersonating,
        impersonatedUser,
        login,
        logout,
        refreshUser,
        startImpersonation,
        stopImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
