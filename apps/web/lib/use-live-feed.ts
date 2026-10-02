"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { apiClient } from "./api-client";

const POLL_MS = 30_000;
const REJOIN_AFTER_MS = 2_000;

// The board and the desk each watch one drive. The socket pushes a whole
// snapshot after every arrival; the poll catches what the socket never
// carries (alerts are counted in the worker, which can't reach the socket).
export function useLiveFeed<T>(driveId: string, view: "board" | "desk", load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    setData(await loadRef.current());
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);

    const socket = io("/live", {
      // Same origin; Next proxies /socket.io/ to the API (next.config.ts).
      path: "/socket.io",
      // Asked for afresh on every (re)connect, so a reconnect after the
      // token's 15 minutes presents a valid one.
      auth: (send) => {
        apiClient.socketToken().then((token) => send({ token }));
      },
    });
    socket.on("connect", () => {
      socket.emit("join", { driveId, view }, (payload: T | { error: string }) => {
        if (payload && typeof payload === "object" && "error" in payload) return;
        setData(payload as T);
        setConnected(true);
      });
    });
    socket.on(view === "board" ? "display" : "desk", (payload: T) => setData(payload));
    // The server disconnects a socket whose token it refused; socket.io
    // doesn't retry those by itself, so this does, with a fresh token.
    let rejoin: ReturnType<typeof setTimeout> | undefined;
    socket.on("disconnect", (reason) => {
      setConnected(false);
      if (reason === "io server disconnect") rejoin = setTimeout(() => socket.connect(), REJOIN_AFTER_MS);
    });
    socket.on("connect_error", () => setConnected(false));

    return () => {
      clearInterval(poll);
      clearTimeout(rejoin);
      socket.disconnect();
    };
  }, [driveId, view, refresh]);

  return { data, connected, refresh };
}
