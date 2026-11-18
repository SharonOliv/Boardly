import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, MouseSensor, TouchSensor,
  closestCorners, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, Board, Card, errMsg, ListT, Member } from "../api";
import { useAuth } from "../auth";
import { useBoardSocket } from "../useBoardSocket";
import { Avatar, Label, Logo, ThemeToggle } from "../components/ui";
import CardModal from "../components/CardModal";
import ActivityDrawer from "../components/ActivityDrawer";

const TONES = ["#2a4bff", "#1f9d6b", "#e8a100", "#d6409f", "#7c4dff", "#0ea5b7"];
const PRIORITY_COLOR = { low: "#8ea0b8", medium: "#e8a100", high: "#d92d3a" };

/** Position between two neighbours, so a drop only changes one row in the database. */
const newPosition = (prev?: number, next?: number) => {
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return next! / 2;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
};

function applyMove(b: Board, cardId: number, toListId: number, position: number): Board {
  let found = null as Card | null;
  const stripped = b.lists.map((l) => ({
    ...l,
    cards: l.cards.filter((c) => (c.id === cardId ? ((found = c), false) : true)),
  }));
  if (!found) return b;
  const moved: Card = { ...(found as Card), list_id: toListId, position };
  return {
    ...b,
    lists: stripped.map((l) =>
      l.id === toListId ? { ...l, cards: [...l.cards, moved].sort((a, c) => a.position - c.position) } : l
    ),
  };
}

function dueInfo(due: string | null) {
  if (!due) return null;
  const today = new Date().toLocaleDateString("en-CA");
  const text = new Date(due + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (due < today) return { text: `Overdue ${text}`, cls: "bg-danger/12 text-danger" };
  if (due === today) return { text: "Due today", cls: "bg-highlight text-[#3a2d00]" };
  return { text, cls: "bg-sunken text-muted" };
}

function CardTile({ card, members, onClick, overlay }: { card: Card; members: Member[]; onClick?: () => void; overlay?: boolean }) {
  const assignee = members.find((m) => m.id === card.assignee_id);
  const due = dueInfo(card.due_date);
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-xl bg-surface p-3 text-left shadow-sm ring-1 ring-line hover:ring-accent ${overlay ? "rotate-2 shadow-2xl ring-accent" : ""}`}
      style={{ borderLeft: `4px solid ${PRIORITY_COLOR[card.priority]}` }}
    >
      {card.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">{card.labels.map((l) => <Label key={l} text={l} />)}</div>
      )}
      <p className="break-words text-[15px] font-medium leading-snug">{card.title}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        {card.priority === "high" && <span className="font-semibold text-danger">High</span>}
        {due && <span className={`rounded-md px-1.5 py-0.5 font-semibold ${due.cls}`}>{due.text}</span>}
        {card.comment_count > 0 && <span title="Comments">💬 {card.comment_count}</span>}
        <span className="flex-1" />
        {assignee && <Avatar name={assignee.name} size={24} />}
      </div>
    </div>
  );
}

function SortableCard({ card, members, canEdit, onOpen }: { card: Card; members: Member[]; canEdit: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `card-${card.id}`, disabled: !canEdit });
  return (
    <div
      ref={setNodeRef} {...attributes} {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      aria-label={`Card: ${card.title}`}
    >
      <CardTile card={card} members={members} onClick={onOpen} />
    </div>
  );
}

function AddCard({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await onAdd(t);
  };
  if (!open) return <button className="m-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-muted hover:bg-surface hover:text-ink" onClick={() => setOpen(true)}>+ Add card</button>;
  return (
    <form onSubmit={submit} className="space-y-2 p-2">
      <textarea
        autoFocus className="input min-h-[64px] resize-none" placeholder="What needs to be done?" value={title} maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e as any); } if (e.key === "Escape") setOpen(false); }}
      />
      <div className="flex gap-2">
        <button className="btn !py-1.5" disabled={!title.trim()}>Add card</button>
        <button type="button" className="btn btn-ghost !py-1.5" onClick={() => { setOpen(false); setTitle(""); }}>Cancel</button>
      </div>
    </form>
  );
}

function Column({ list, cards, tone, members, canEdit, onOpen, onRename, onDelete, onAddCard }: {
  list: ListT; cards: Card[]; tone: string; members: Member[]; canEdit: boolean;
  onOpen: (id: number) => void; onRename: (t: string) => void; onDelete: () => void; onAddCard: (t: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `list-${list.id}` });
  const [title, setTitle] = useState(list.title);
  const editing = useRef(false);
  if (!editing.current && title !== list.title) setTitle(list.title);
  return (
    <section className="flex max-h-full w-[290px] shrink-0 flex-col rounded-2xl bg-sunken ring-1 ring-line" style={{ borderTop: `3px solid ${tone}` }}>
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <input
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 font-display text-[17px] font-semibold hover:bg-surface focus:bg-surface"
          value={title} disabled={!canEdit} aria-label="List title" maxLength={100}
          onFocus={() => (editing.current = true)} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { editing.current = false; const t = title.trim(); if (t && t !== list.title) onRename(t); else setTitle(list.title); }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <span className="text-sm font-semibold text-muted">{cards.length}</span>
        {canEdit && <button className="rounded-md px-1.5 text-muted hover:bg-surface hover:text-danger" title="Delete list" aria-label={`Delete list ${list.title}`} onClick={onDelete}>🗑</button>}
      </div>
      <div ref={setNodeRef} className={`min-h-[44px] flex-1 space-y-2 overflow-y-auto px-2 pb-2 pt-1 ${isOver ? "bg-accent/5" : ""}`}>
        <SortableContext items={cards.map((c) => `card-${c.id}`)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => <SortableCard key={c.id} card={c} members={members} canEdit={canEdit} onOpen={() => onOpen(c.id)} />)}
        </SortableContext>
      </div>
      {canEdit && <AddCard onAdd={onAddCard} />}
    </section>
  );
}

function AddList({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await onAdd(title.trim());
    setTitle("");
    setOpen(false);
  };
  if (!open) return <button className="h-12 w-[290px] shrink-0 rounded-2xl border border-dashed border-line px-4 text-left font-semibold text-muted hover:border-accent hover:text-accent" onClick={() => setOpen(true)}>+ Add another list</button>;
  return (
    <form onSubmit={submit} className="w-[290px] shrink-0 space-y-2 rounded-2xl bg-sunken p-3 ring-1 ring-line">
      <input autoFocus className="input" placeholder="List name" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
      <div className="flex gap-2"><button className="btn !py-1.5" disabled={!title.trim()}>Add list</button><button type="button" className="btn btn-ghost !py-1.5" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

export default function BoardPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [openCard, setOpenCard] = useState<number | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");
  const [label, setLabel] = useState("");
  const movingRef = useRef(0);
  const pendingRef = useRef(false);

  const showError = useCallback((msg: string) => { setToast(msg); window.setTimeout(() => setToast(""), 4000); }, []);
  const refetchBoard = () => qc.invalidateQueries({ queryKey: ["board", id] });

  const { data: board, error } = useQuery({
    queryKey: ["board", id],
    queryFn: async () => (await api.get<Board>(`/boards/${id}`)).data,
  });

  const onEvent = useCallback((msg: any) => {
    if (msg.type === "board_deleted") { nav("/"); return; }
    if (msg.card_id) qc.invalidateQueries({ queryKey: ["card", msg.card_id] });
    qc.invalidateQueries({ queryKey: ["activity", id] });
    if (movingRef.current > 0) { pendingRef.current = true; return; } // don't fight our own drag
    qc.invalidateQueries({ queryKey: ["board", id] });
  }, [id, nav, qc]);

  const { online, connected, typingNames, sendTyping } = useBoardSocket(id, onEvent);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  const labels = useMemo(() => [...new Set(board?.lists.flatMap((l) => l.cards.flatMap((c) => c.labels)) ?? [])].sort(), [board]);
  const filtering = !!(q || who || label);
  const visible = (c: Card) =>
    (!q || (c.title + " " + c.description).toLowerCase().includes(q.toLowerCase())) &&
    (!who || (who === "none" ? c.assignee_id === null : c.assignee_id === Number(who))) &&
    (!label || c.labels.includes(label));

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div><p className="mb-3 text-danger">{errMsg(error)}</p><Link className="btn" to="/">Back to your boards</Link></div>
      </div>
    );
  }
  if (!board) return <div className="grid h-full place-items-center text-muted">Loading board…</div>;

  const canEdit = board.role !== "viewer";
  const activeCard = board.lists.flatMap((l) => l.cards).find((c) => c.id === activeId);

  const moveCard = async (cardId: number, toListId: number, position: number) => {
    movingRef.current++;
    qc.setQueryData<Board>(["board", id], (b) => (b ? applyMove(b, cardId, toListId, position) : b));
    try {
      await api.patch(`/cards/${cardId}/move`, { list_id: toListId, position });
    } catch (e) {
      showError(errMsg(e));
      pendingRef.current = true;
    } finally {
      movingRef.current--;
      if (movingRef.current === 0 && pendingRef.current) { pendingRef.current = false; refetchBoard(); }
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const cardId = Number(String(active.id).replace("card-", ""));
    const overId = String(over.id);
    const from = board.lists.find((l) => l.cards.some((c) => c.id === cardId));
    if (!from) return;
    let to: ListT | undefined;
    let index: number;
    if (overId.startsWith("list-")) {
      to = board.lists.find((l) => `list-${l.id}` === overId);
      index = to ? to.cards.filter((c) => c.id !== cardId).length : 0;
    } else {
      const overCardId = Number(overId.replace("card-", ""));
      to = board.lists.find((l) => l.cards.some((c) => c.id === overCardId));
      if (!to) return;
      const others = to.cards.filter((c) => c.id !== cardId);
      const overIdx = others.findIndex((c) => c.id === overCardId);
      const movingDown = from.id === to.id && from.cards.findIndex((c) => c.id === cardId) < to.cards.findIndex((c) => c.id === overCardId);
      index = movingDown ? overIdx + 1 : overIdx;
    }
    if (!to) return;
    const others = to.cards.filter((c) => c.id !== cardId);
    moveCard(cardId, to.id, newPosition(others[index - 1]?.position, others[index]?.position));
  };

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); refetchBoard(); } catch (e) { showError(errMsg(e)); }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-bg/90 px-3 py-2.5 backdrop-blur sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link to="/" className="flex items-center gap-2" aria-label="Back to boards"><Logo size={26} /></Link>
          <div className="min-w-0">
            <p className="truncate text-xs text-muted">{board.workspace.name}</p>
            <h1 className="truncate font-display text-xl font-bold leading-tight">{board.name}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`flex items-center gap-1.5 text-xs font-medium ${connected ? "text-[#1f9d6b]" : "text-muted"}`} title={connected ? "Live updates on" : "Reconnecting…"}>
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-[#1f9d6b]" : "bg-muted"}`} />{connected ? "Live" : "Offline"}
            </span>
            <div className="flex -space-x-2" aria-label="People viewing this board">
              {online.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} size={30} title={p.id === user?.id ? `${p.name} (you)` : p.name} />)}
              {online.length > 5 && <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-sunken text-xs font-semibold ring-2 ring-surface">+{online.length - 5}</span>}
            </div>
            <button className="btn btn-ghost" onClick={() => setShowActivity(true)}>Activity</button>
            {board.role === "owner" && (
              <button className="btn btn-danger" onClick={async () => { if (confirm(`Delete board "${board.name}" and everything in it?`)) run(async () => { await api.delete(`/boards/${id}`); nav("/"); }); }}>Delete</button>
            )}
            <ThemeToggle />
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input className="input !w-full sm:!w-56" placeholder="Search cards" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cards" />
          <select className="input !w-auto" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by assignee">
            <option value="">Everyone</option><option value="none">Unassigned</option>
            {board.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select className="input !w-auto" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Filter by label">
            <option value="">All labels</option>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {filtering && <button className="btn btn-ghost" onClick={() => { setQ(""); setWho(""); setLabel(""); }}>Clear filters</button>}
          {!canEdit && <span className="rounded-md bg-sunken px-2 py-1 text-xs font-semibold text-muted">View only</span>}
        </div>
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setActiveId(Number(String(e.active.id).replace("card-", "")))}
        onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <main className="scroll-x min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full items-start gap-3 p-3 sm:p-4">
            {board.lists.map((l, i) => (
              <Column
                key={l.id} list={l} cards={l.cards.filter(visible)} tone={TONES[i % TONES.length]}
                members={board.members} canEdit={canEdit} onOpen={setOpenCard}
                onRename={(t) => run(() => api.patch(`/lists/${l.id}`, { title: t }))}
                onDelete={() => { if (confirm(`Delete list "${l.title}" and its ${l.cards.length} cards?`)) run(() => api.delete(`/lists/${l.id}`)); }}
                onAddCard={async (t) => { await run(() => api.post(`/lists/${l.id}/cards`, { title: t })); }}
              />
            ))}
            {canEdit && <AddList onAdd={(t) => run(() => api.post(`/boards/${id}/lists`, { title: t }))} />}
          </div>
        </main>
        <DragOverlay>{activeCard && <CardTile card={activeCard} members={board.members} overlay />}</DragOverlay>
      </DndContext>

      {openCard !== null && (
        <CardModal cardId={openCard} board={board} onClose={() => setOpenCard(null)} typingNames={typingNames} sendTyping={sendTyping} onError={showError} />
      )}
      {showActivity && <ActivityDrawer boardId={id} onClose={() => setShowActivity(false)} />}
      {toast && <div role="alert" className="pop fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-bg shadow-xl">{toast}</div>}
    </div>
  );
}