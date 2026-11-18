import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, User } from "./api";

type Ctx = {
  user: User | null; loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};
const AuthCtx = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!localStorage.getItem("token"));

  useEffect(() => {
    if (!localStorage.getItem("token")) return;
    api.get("/auth/me").then((r) => setUser(r.data)).catch(() => localStorage.removeItem("token")).finally(() => setLoading(false));
  }, []);

  const accept = (data: { access_token: string; user: User }) => {
    localStorage.setItem("token", data.access_token);
    setUser(data.user);
  };
  const login = async (email: string, password: string) => {
    const body = new URLSearchParams({ username: email, password });
    accept((await api.post("/auth/login", body)).data);
  };
  const signup = async (name: string, email: string, password: string) => {
    accept((await api.post("/auth/signup", { name, email, password })).data);
  };
  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };
  return <AuthCtx.Provider value={{ user, loading, login, signup, logout }}>{children}</AuthCtx.Provider>;
}