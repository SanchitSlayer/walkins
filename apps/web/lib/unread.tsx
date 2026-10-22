"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { apiClient } from "./api-client";

type UnreadContext = { unread: number; refresh: () => void };

const Context = createContext<UnreadContext>({ unread: 0, refresh: () => {} });

export function useUnread(): UnreadContext {
  return useContext(Context);
}

const POLL_MS = 30_000;

// The company's unread messages, one count for the whole desk: whoever reads
// a thread reads it for everyone, as whoever is at the desk works the drive.
export function UnreadProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  // Before the session is restored, or for someone outside a company, the
  // request is refused; the count just stays as it was.
  const refresh = useCallback(() => {
    apiClient.companyThreads().then((list) => setUnread(list.unread), () => {});
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  return <Context.Provider value={{ unread, refresh }}>{children}</Context.Provider>;
}
