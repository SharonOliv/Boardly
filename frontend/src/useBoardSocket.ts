import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "./api";

export type Presence = { id: number; name: string };

/** Live connection to one board: presence, typing indicators and change events. */
export function useBoardSocket(boardId: number, onEvent: (msg: any) => void) {
  const [online, setOnline] = useState<Presence[]>([]);
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const timers = useRef<Record<string, number>>({});
  const lastTyping = useRef(0);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let everOpened = false;
    let retryTimer = 0;

    const connect = () => {
      const token = encodeURIComponent(localStorage.getItem("token") ?? "");
      const ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws/boards/${boardId}?token=${token}`);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        if (everOpened) handler.current({ type: "reconnected" }); // catch up on missed changes
        everOpened = true;
        retry = 0;
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "presence") return setOnline(msg.users);
        if (msg.type === "typing") {
          const key = `${msg.card_id}:${msg.user.id}`;
          setTyping((t) => ({ ...t, [key]: msg.user.name }));
          window.clearTimeout(timers.current[key]);
          timers.current[key] = window.setTimeout(
            () => setTyping((t) => { const { [key]: _gone, ...rest } = t; return rest; }),
            3000
          );
          return;
        }
        handler.current(msg);
      };
      ws.onclose = () => {
        setConnected(false);
        setOnline([]);
        if (!closed) retryTimer = window.setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [boardId]);

  const sendTyping = useCallback((cardId: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || Date.now() - lastTyping.current < 1500) return;
    lastTyping.current = Date.now();
    ws.send(JSON.stringify({ type: "typing", card_id: cardId }));
  }, []);

  const typingNames = (cardId: number) =>
    Object.entries(typing).filter(([k]) => k.startsWith(`${cardId}:`)).map(([, n]) => n);

  return { online, connected, typingNames, sendTyping };
}