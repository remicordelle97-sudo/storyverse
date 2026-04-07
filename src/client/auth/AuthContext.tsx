import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
  plan: string;
}

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  accessToken: string | null;
  loading: boolean;
  login: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
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
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const updateToken = (token: string | null) => {
    currentAccessToken = token;
    setAccessToken(token);
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

  // Try to refresh token on mount (from httpOnly cookie)
  useEffect(() => {
    (async () => {
      try {
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
    updateToken(data.accessToken);
    setUser(data.user);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    updateToken(null);
    setUser(null);
    localStorage.removeItem("universeId");
  };

  const isAdmin = user?.role === "admin";

  return (
    <AuthContext.Provider
      value={{ user, isAdmin, accessToken, loading, login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
