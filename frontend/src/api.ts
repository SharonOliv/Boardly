import axios from "axios";

export const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
export const api = axios.create({ baseURL: API });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const isAuthCall = err.config?.url?.startsWith("/auth/login") || err.config?.url?.startsWith("/auth/signup");
    if (err.response?.status === 401 && !isAuthCall) {
      localStorage.removeItem("token");
      if (!location.pathname.startsWith("/login")) location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e: any): string => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  if (e?.code === "ERR_NETWORK") return "Can't reach the server. Is the backend running on " + API + "?";
  return "Something went wrong. Please try again.";
};

export type User = { id: number; name: string; email: string };
export type Member = User & { role: "owner" | "member" | "viewer" };
export type Card = {
  id: number; list_id: number; title: string; description: string; position: number;
  assignee_id: number | null; due_date: string | null; priority: "low" | "medium" | "high";
  labels: string[]; comment_count: number;
};
export type ListT = { id: number; title: string; position: number; cards: Card[] };
export type Board = {
  id: number; name: string; role: Member["role"]; workspace: { id: number; name: string };
  members: Member[]; lists: ListT[];
};
export type Workspace = {
  id: number; name: string; role: Member["role"]; member_count: number; boards: { id: number; name: string }[];
};
export type Comment = { id: number; body: string; created_at: string; user: User };
export type CardDetail = Card & { comments: Comment[] };
export type ActivityItem = { id: number; user: string; text: string; created_at: string };

export const timeAgo = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};