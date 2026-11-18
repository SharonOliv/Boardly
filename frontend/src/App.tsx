import { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import BoardPage from "./pages/BoardPage";

function Private({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid h-full place-items-center text-muted">Loading…</div>;
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route path="/" element={<Private><Dashboard /></Private>} />
      <Route path="/boards/:id" element={<Private><BoardPage /></Private>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}