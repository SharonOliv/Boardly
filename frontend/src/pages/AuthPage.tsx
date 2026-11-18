import { FormEvent, useState } from "react";
import { useAuth } from "../auth";
import { errMsg } from "../api";
import { Logo, ThemeToggle } from "../components/ui";

const COLS = [
  { t: "To do", tone: "#2a4bff", cards: ["Write launch post", "Collect quotes"] },
  { t: "In progress", tone: "#e8a100", cards: ["Pricing page", "Fix mobile menu", "Set up alerts"] },
  { t: "Done", tone: "#1f9d6b", cards: ["Pick a domain"] },
];

function Preview() {
  return (
    <div className="mx-auto w-full max-w-xl -rotate-2 rounded-2xl bg-sunken/70 p-4 shadow-xl ring-1 ring-line">
      <div className="grid grid-cols-3 gap-3">
        {COLS.map((c) => (
          <div key={c.t} className="rounded-xl bg-bg p-2.5" style={{ borderTop: `3px solid ${c.tone}` }}>
            <p className="mb-2 px-1 text-xs font-semibold text-muted">{c.t}</p>
            <div className="space-y-2">
              {c.cards.map((x, i) => (
                <div key={x} className="rounded-lg bg-surface p-2.5 text-[13px] font-medium shadow-sm ring-1 ring-line"
                  style={c.t === "In progress" && i === 1 ? { transform: "rotate(2.5deg) translateX(8px)", boxShadow: "0 10px 24px rgba(16,24,40,.18)" } : undefined}>
                  {x}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AuthPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await login(email, password);
      else await signup(name, email, password);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden flex-col justify-between overflow-hidden bg-sunken p-10 lg:flex">
        <div className="flex items-center gap-2.5"><Logo /><span className="font-display text-xl font-bold">Boardly</span></div>
        <div>
          <h1 className="mb-3 max-w-md font-display text-5xl font-bold leading-[1.05] tracking-tight">Plan together and watch the board move.</h1>
          <p className="mb-10 max-w-sm text-muted">Every card you drag shows up instantly for everyone on your team.</p>
          <Preview />
        </div>
        <span className="text-sm text-muted">Workspaces, boards, comments and live updates in one place.</span>
      </aside>

      <main className="relative flex items-center justify-center p-6">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden"><Logo /><span className="font-display text-xl font-bold">Boardly</span></div>
          <h2 className="mb-1 font-display text-3xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="mb-6 text-muted">{mode === "login" ? "Sign in to open your boards." : "It takes less than a minute."}</p>
          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            )}
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            <input className="input" type="password" placeholder="Password (6+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} />
            {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <button className="btn w-full !py-2.5" disabled={busy}>{busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}</button>
          </form>
          <p className="mt-5 text-sm text-muted">
            {mode === "login" ? "New to Boardly?" : "Already have an account?"}{" "}
            <button className="font-semibold text-accent underline-offset-2 hover:underline" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}