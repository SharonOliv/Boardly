import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Board, CardDetail, errMsg, timeAgo } from "../api";
import { useAuth } from "../auth";
import { Avatar, Label, Modal } from "./ui";

function useDraft(server: string) {
  const [value, setValue] = useState(server);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setValue(server); }, [server]);
  return {
    value,
    onChange: (e: { target: { value: string } }) => setValue(e.target.value),
    onFocus: () => { focused.current = true; },
    onBlurDone: () => { focused.current = false; },
  };
}

type Draft = { text: string; on: boolean };
type Props = {
  cardId: number; board: Board; onClose: () => void;
  typingNames: (cardId: number) => string[]; sendTyping: (cardId: number) => void;
  onError: (msg: string) => void;
};

export default function CardModal({ cardId, board, onClose, typingNames, sendTyping, onError }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = board.role !== "viewer";
  const { data: card, error } = useQuery({
    queryKey: ["card", cardId],
    queryFn: async () => (await api.get<CardDetail>(`/cards/${cardId}`)).data,
  });
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: async () => (await api.get<{ ai_enabled: boolean }>("/config")).data,
    staleTime: Infinity,
  });
  const title = useDraft(card?.title ?? "");
  const desc = useDraft(card?.description ?? "");
  const [newLabel, setNewLabel] = useState("");
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");

  useEffect(() => { if (error) onClose(); }, [error, onClose]);
  if (!card) return <Modal label="Card details" onClose={onClose} wide><p className="p-6 text-muted" role="status">Loading card…</p></Modal>;

  const listName = board.lists.find((l) => l.id === card.list_id)?.title;

  const save = async (patch: Record<string, unknown>) => {
    try {
      const { data } = await api.patch(`/cards/${cardId}`, patch);
      qc.setQueryData<CardDetail>(["card", cardId], (old) => (old ? { ...old, ...data } : old));
      qc.invalidateQueries({ queryKey: ["board", board.id] });
    } catch (e) { onError(errMsg(e)); }
  };

  // Keyboard- and screen-reader-friendly alternative to dragging a card between lists.
  const moveToList = async (listId: number) => {
    const target = board.lists.find((l) => l.id === listId);
    const last = target?.cards.reduce((max, c) => Math.max(max, c.position), 0) ?? 0;
    try {
      await api.patch(`/cards/${cardId}/move`, { list_id: listId, position: last + 1000 });
      qc.setQueryData<CardDetail>(["card", cardId], (old) => (old ? { ...old, list_id: listId } : old));
      qc.invalidateQueries({ queryKey: ["board", board.id] });
    } catch (e) { onError(errMsg(e)); }
  };

  const addLabel = () => {
    const t = newLabel.trim().replace(/,/g, "");
    setNewLabel("");
    if (t && !card.labels.includes(t)) save({ labels: [...card.labels, t] });
  };
  const labelKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addLabel(); }
  };

  const postComment = async () => {
    if (!comment.trim() || posting) return;
    setPosting(true);
    try {
      await api.post(`/cards/${cardId}/comments`, { body: comment });
      setComment("");
      await qc.invalidateQueries({ queryKey: ["card", cardId] });
      qc.invalidateQueries({ queryKey: ["board", board.id] });
    } catch (e) { onError(errMsg(e)); }
    setPosting(false);
  };

  const deleteComment = async (id: number) => {
    try {
      await api.delete(`/comments/${id}`);
      qc.invalidateQueries({ queryKey: ["card", cardId] });
      qc.invalidateQueries({ queryKey: ["board", board.id] });
    } catch (e) { onError(errMsg(e)); }
  };

  const deleteCard = async () => {
    if (!confirm(`Delete "${card.title}"? This can't be undone.`)) return;
    try {
      await api.delete(`/cards/${cardId}`);
      qc.invalidateQueries({ queryKey: ["board", board.id] });
      onClose();
    } catch (e) { onError(errMsg(e)); }
  };

  // AI suggestions are drafts. Nothing becomes a card until the person approves them.
  const suggest = async () => {
    setAiBusy(true); setAiMsg(""); setDrafts(null);
    try {
      const { data } = await api.post<{ suggestions: string[] }>(`/cards/${cardId}/suggest-subtasks`);
      if (data.suggestions.length === 0) setAiMsg("No suggestions for this card. Try adding more detail to the description.");
      else setDrafts(data.suggestions.map((text) => ({ text, on: true })));
    } catch (e) { setAiMsg(errMsg(e)); }
    setAiBusy(false);
  };
  const approve = async () => {
    const titles = (drafts ?? []).filter((d) => d.on && d.text.trim()).map((d) => d.text.trim());
    if (!titles.length) return;
    try {
      await api.post(`/cards/${cardId}/subtasks`, { titles, source: "ai" });
      setDrafts(null);
      setAiMsg(`Added ${titles.length} card${titles.length > 1 ? "s" : ""} right after this one.`);
      qc.invalidateQueries({ queryKey: ["board", board.id] });
    } catch (e) { onError(errMsg(e)); }
  };
  const selected = (drafts ?? []).filter((d) => d.on && d.text.trim()).length;

  const typers = typingNames(cardId);

  return (
    <Modal label={`Card: ${card.title}`} onClose={onClose} wide>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-sm text-muted">in {listName}</p>
          <input
            className="-mx-2 w-[calc(100%+1rem)] rounded-lg bg-transparent px-2 py-1 font-display text-2xl font-semibold hover:bg-sunken focus:bg-sunken"
            disabled={!canEdit} aria-label="Card title" maxLength={200}
            value={title.value} onChange={title.onChange} onFocus={title.onFocus}
            onBlur={() => { title.onBlurDone(); if (title.value.trim() && title.value !== card.title) save({ title: title.value }); else title.onChange({ target: { value: card.title } }); }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
        <button className="btn btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Close card"><span aria-hidden>✕</span></button>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_220px]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="desc-h">
            <h3 id="desc-h" className="mb-1.5 text-sm font-semibold">Description</h3>
            <textarea
              className="input min-h-[110px] resize-y" aria-labelledby="desc-h" placeholder={canEdit ? "Add more detail about this task…" : "No description"}
              disabled={!canEdit} value={desc.value} onChange={desc.onChange} onFocus={desc.onFocus}
              onBlur={() => { desc.onBlurDone(); if (desc.value !== card.description) save({ description: desc.value }); }}
            />
          </section>

          {canEdit && config?.ai_enabled && (
            <section aria-labelledby="ai-h" aria-busy={aiBusy} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="ai-h" className="text-sm font-semibold">Break this down with AI</h3>
                <button className="btn btn-ghost !py-1.5" onClick={suggest} disabled={aiBusy}>{aiBusy ? "Thinking…" : drafts ? "Suggest again" : "Suggest subtasks"}</button>
              </div>
              <p className="mt-1 text-xs text-muted">Suggestions are drafts. Nothing is added to the board until you approve it.</p>
              <div role="status" aria-live="polite">
                {aiMsg && <p className="mt-2 text-sm">{aiMsg}</p>}
              </div>
              {drafts && (
                <div className="mt-3">
                  <ul className="space-y-2">
                    {drafts.map((d, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent)]" checked={d.on} aria-label={`Include suggestion ${i + 1}`}
                          onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                        <input className="input !py-1.5" value={d.text} maxLength={200} aria-label={`Suggestion ${i + 1} text`}
                          onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <button className="btn !py-1.5" onClick={approve} disabled={selected === 0}>Add {selected} as cards</button>
                    <button className="btn btn-ghost !py-1.5" onClick={() => setDrafts(null)}>Dismiss</button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section aria-labelledby="comments-h">
            <h3 id="comments-h" className="mb-2 text-sm font-semibold">Comments {card.comments.length > 0 && <span className="text-muted">({card.comments.length})</span>}</h3>
            <ul className="mb-3 space-y-3">
              {card.comments.length === 0 && <li className="text-sm text-muted">No comments yet. Start the conversation.</li>}
              {card.comments.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  <Avatar name={c.user.name} size={30} />
                  <div className="min-w-0 flex-1 rounded-xl bg-sunken px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span className="font-semibold text-ink">{c.user.name}</span>
                      <span>{timeAgo(c.created_at)}</span>
                      {c.user.id === user?.id && canEdit && (
                        <button className="ml-auto hover:text-danger" onClick={() => deleteComment(c.id)} aria-label={`Delete your comment from ${timeAgo(c.created_at)}`}>Delete</button>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            {canEdit && (
              <div>
                <textarea
                  className="input min-h-[72px] resize-y" placeholder="Write a comment…  (Ctrl+Enter to send)"
                  value={comment} aria-label="New comment"
                  onChange={(e) => { setComment(e.target.value); if (e.target.value) sendTyping(cardId); }}
                  onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && postComment()}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="h-5 text-sm text-muted" role="status" aria-live="polite">
                    {typers.length > 0 && `${typers.join(", ")} ${typers.length > 1 ? "are" : "is"} typing…`}
                  </p>
                  <button className="btn" disabled={!comment.trim() || posting} onClick={postComment}>Comment</button>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4" aria-label="Card properties">
          <label className="block text-sm font-semibold">List
            <select className="input mt-1.5 font-normal" disabled={!canEdit} value={card.list_id} onChange={(e) => moveToList(Number(e.target.value))}>
              {board.lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold">Assignee
            <select className="input mt-1.5 font-normal" disabled={!canEdit} value={card.assignee_id ?? ""}
              onChange={(e) => save({ assignee_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Unassigned</option>
              {board.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold">Due date
            <input type="date" className="input mt-1.5 font-normal" disabled={!canEdit} value={card.due_date ?? ""}
              onChange={(e) => save({ due_date: e.target.value || null })} />
          </label>
          <label className="block text-sm font-semibold">Priority
            <select className="input mt-1.5 font-normal" disabled={!canEdit} value={card.priority} onChange={(e) => save({ priority: e.target.value })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
          <div>
            <p className="mb-1.5 text-sm font-semibold" id="labels-h">Labels</p>
            <ul className="mb-2 flex flex-wrap gap-1.5" aria-labelledby="labels-h">
              {card.labels.map((l) => (
                <li key={l} className="inline-flex items-center gap-1"><Label text={l} />
                  {canEdit && <button className="text-xs text-muted hover:text-danger" aria-label={`Remove label ${l}`} onClick={() => save({ labels: card.labels.filter((x) => x !== l) })}><span aria-hidden>✕</span></button>}
                </li>
              ))}
            </ul>
            {canEdit && <input className="input" aria-label="Add a label" placeholder="Add label, press Enter" value={newLabel} maxLength={20}
              onChange={(e) => setNewLabel(e.target.value)} onKeyDown={labelKey} onBlur={addLabel} />}
          </div>
          {canEdit && <button className="btn btn-danger w-full" onClick={deleteCard}>Delete card</button>}
        </aside>
      </div>
    </Modal>
  );
}