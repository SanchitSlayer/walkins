"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { apiClient } from "./api-client";

type DeskCounts = { unread: number; outcomesDue: number; refresh: () => void };

const Context = createContext<DeskCounts>({ unread: 0, outcomesDue: 0, refresh: () => {} });

export function useUnread(): DeskCounts {
  return useContext(Context);
}

const POLL_MS = 30_000;

// The counts the desk's nav shows, each one for the whole company: unread
// messages (whoever reads a thread reads it for everyone, as whoever is at
// the desk works the drive) and outcomes waiting to be recorded.
export function UnreadProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  const [outcomesDue, setOutcomesDue] = useState(0);
  // Before the session is restored, or for someone outside a company, the
  // requests are refused; the counts just stay as they were.
  const refresh = useCallback(() => {
    apiClient.companyThreads().then((list) => setUnread(list.unread), () => {});
    apiClient.companyOutcomes().then((o) => setOutcomesDue(o.due), () => {});
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  return <Context.Provider value={{ unread, outcomesDue, refresh }}>{children}</Context.Provider>;
}
