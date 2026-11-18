import { CSSProperties, FormEvent, ReactNode, useEffect, useState } from "react";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <rect x="7" y="7" width="8" height="18" rx="2" fill="var(--accent-ink)" />
      <rect x="17" y="7" width="8" height="11" rx="2" fill="#FFD84D" />
    </svg>
  );
}

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function Avatar({ name, size = 28, title }: { name: string; size?: number; title?: string }) {
  const hue = hash(name) % 360;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return (
    <span
      title={title ?? name}
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-surface"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 55% 42%)` }}
    >
      {initials}
    </span>
  );
}

export function labelStyle(label: string): CSSProperties {
  const hue = hash(label.toLowerCase()) % 360;
  return {
    background: `hsl(${hue} 80% 50% / 0.16)`,
    color: `color-mix(in oklab, hsl(${hue} 70% 42%) 65%, var(--ink))`,
  };
}

export function Label({ text }: { text: string }) {
  return (
    <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4" style={labelStyle(text)}>
      {text}
    </span>
  );
}

export function useTheme() {
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  };
  return { dark, toggle };
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button className="btn btn-ghost !px-2.5" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title="Toggle theme">
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </button>
  );
}

export function Modal({ title, onClose, children, wide }: { title?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={`pop my-auto w-full ${wide ? "max-w-3xl" : "max-w-md"} rounded-2xl bg-surface p-5 shadow-2xl sm:p-6`}>
        {title && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <button className="btn btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Close">✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function NameModal({ title, placeholder, submit, onClose, onSubmit }: {
  title: string; placeholder: string; submit: string; onClose: () => void; onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try { await onSubmit(name.trim()); onClose(); }
    catch (err: any) { setError(err?.message ?? "Failed"); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={go} className="space-y-3">
        <input autoFocus className="input" placeholder={placeholder} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !name.trim()}>{submit}</button>
        </div>
      </form>
    </Modal>
  );
}