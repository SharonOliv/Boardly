import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMsg, Member, Workspace } from "../api";
import { useAuth } from "../auth";
import { Avatar, Logo, Modal, NameModal, ThemeToggle } from "../components/ui";

const TONES = ["#2a4bff", "#1f9d6b", "#e8a100", "#d6409f", "#7c4dff"];

function MembersModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: members = [] } = useQuery({ queryKey: ["members", ws.id], queryFn: async () => (await api.get<Member[]>(`/workspaces/${ws.id}/members`)).data });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState("");
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const { data } = await api.post(`/workspaces/${ws.id}/members`, { email, role });
      qc.setQueryData(["members", ws.id], data);
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setEmail("");
    } catch (err) { setError(errMsg(err)); }
  };
  return (
    <Modal title={`People in ${ws.name}`} onClose={onClose}>
      <ul className="mb-4 divide-y divide-line">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={m.name} size={32} />
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{m.name}</p><p className="truncate text-xs text-muted">{m.email}</p></div>
            <span className="rounded-md bg-sunken px-2 py-0.5 text-xs font-semibold text-muted">{m.role}</span>
          </li>
        ))}
      </ul>
      {ws.role === "owner" ? (
        <form onSubmit={invite} className="space-y-2">
          <p className="text-sm font-semibold">Add someone who already has a Boardly account</p>
          <div className="flex gap-2">
            <input className="input" type="email" aria-label="Teammate email" placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <select className="input !w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
              <option value="member">Member</option><option value="viewer">Viewer</option>
            </select>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn w-full">Add to workspace</button>
        </form>
      ) : <p className="text-sm text-muted">Only owners can add people.</p>}
    </Modal>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: workspaces, isLoading, error } = useQuery({ queryKey: ["workspaces"], queryFn: async () => (await api.get<Workspace[]>("/workspaces")).data });
  const [newWs, setNewWs] = useState(false);
  const [newBoardFor, setNewBoardFor] = useState<Workspace | null>(null);
  const [membersFor, setMembersFor] = useState<Workspace | null>(null);
  useEffect(() => { document.title = "Your workspaces · Boardly"; }, []);

  const createWorkspace = async (name: string) => {
    try { await api.post("/workspaces", { name }); qc.invalidateQueries({ queryKey: ["workspaces"] }); }
    catch (e) { throw new Error(errMsg(e)); }
  };
  const createBoard = async (name: string) => {
    try { const { data } = await api.post(`/workspaces/${newBoardFor!.id}/boards`, { name }); nav(`/boards/${data.id}`); }
    catch (e) { throw new Error(errMsg(e)); }
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5"><Logo /><span className="font-display text-xl font-bold">Boardly</span></Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="hidden items-center gap-2 sm:flex"><Avatar name={user!.name} size={30} /><span className="text-sm font-medium">{user!.name}</span></span>
            <button className="btn btn-ghost" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">Your workspaces</h1>
            <p className="text-muted">Pick a board, or start a new one.</p>
          </div>
          <button className="btn" onClick={() => setNewWs(true)}>New workspace</button>
        </div>

        {isLoading && <p className="text-muted">Loading…</p>}
        {error && <p className="text-danger">{errMsg(error)}</p>}

        {workspaces?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line p-10 text-center">
            <h2 className="mb-1 font-display text-xl font-semibold">Start with a workspace</h2>
            <p className="mx-auto mb-4 max-w-sm text-muted">A workspace holds your team's boards. Create one, then add a board inside it.</p>
            <button className="btn" onClick={() => setNewWs(true)}>Create a workspace</button>
          </div>
        )}

        <div className="space-y-10">
          {workspaces?.map((ws) => (
            <section key={ws.id} aria-labelledby={`ws-${ws.id}`}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 id={`ws-${ws.id}`} className="font-display text-xl font-semibold">{ws.name}</h2>
                <button aria-label={`View people in ${ws.name}`} className="rounded-md bg-sunken px-2 py-1 text-xs font-semibold text-muted hover:text-ink" onClick={() => setMembersFor(ws)}>
                  {ws.member_count} {ws.member_count === 1 ? "person" : "people"} · {ws.role}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {ws.boards.map((b, i) => (
                  <Link key={b.id} to={`/boards/${b.id}`} className="group rounded-xl bg-surface p-4 shadow-sm ring-1 ring-line transition hover:ring-accent" style={{ borderTop: `4px solid ${TONES[i % TONES.length]}` }}>
                    <p className="font-display text-lg font-semibold leading-snug group-hover:text-accent">{b.name}</p>
                  </Link>
                ))}
                {ws.role !== "viewer" && (
                  <button aria-label={`New board in ${ws.name}`} onClick={() => setNewBoardFor(ws)} className="min-h-[76px] rounded-xl border border-dashed border-line p-4 text-left font-semibold text-muted transition hover:border-accent hover:text-accent">
                    + New board
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      </main>

      {newWs && <NameModal title="New workspace" placeholder="e.g. Marketing team" submit="Create workspace" onClose={() => setNewWs(false)} onSubmit={createWorkspace} />}
      {newBoardFor && <NameModal title={`New board in ${newBoardFor.name}`} placeholder="e.g. Website launch" submit="Create board" onClose={() => setNewBoardFor(null)} onSubmit={createBoard} />}
      {membersFor && <MembersModal ws={membersFor} onClose={() => setMembersFor(null)} />}
    </div>
  );
}