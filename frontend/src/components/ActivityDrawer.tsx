import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActivityItem, api, timeAgo } from "../api";
import { Avatar, useFocusTrap } from "./ui";

export default function ActivityDrawer({ boardId, onClose }: { boardId: number; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref);
  const { data = [], isLoading } = useQuery({
    queryKey: ["activity", boardId],
    queryFn: async () => (await api.get<ActivityItem[]>(`/boards/${boardId}/activity`)).data,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} tabIndex={-1} className="slide absolute right-0 top-0 flex h-full w-full max-w-sm flex-col bg-surface shadow-2xl outline-none" role="dialog" aria-modal="true" aria-labelledby="activity-title">
        <div className="flex items-center justify-between border-b border-line p-4">
          <h2 id="activity-title" className="font-display text-xl font-semibold">Activity</h2>
          <button className="btn btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Close activity"><span aria-hidden>✕</span></button>
        </div>
        <ul className="flex-1 space-y-4 overflow-y-auto p-4">
          {isLoading && <li className="text-muted">Loading…</li>}
          {!isLoading && data.length === 0 && <li className="text-muted">Nothing has happened on this board yet.</li>}
          {data.map((a) => (
            <li key={a.id} className="flex gap-3">
              <Avatar name={a.user} size={28} />
              <div className="min-w-0">
                <p className="break-words text-sm"><span className="font-semibold">{a.user}</span> {a.text}</p>
                <p className="text-xs text-muted">{timeAgo(a.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}