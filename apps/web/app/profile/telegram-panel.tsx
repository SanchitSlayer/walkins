"use client";

import { useEffect, useState } from "react";
import type { TelegramLink } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, boardButtonClass } from "@/components/board/field";
import { Slab } from "@/components/board/slab";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";

const POLL_MS = 4000;

// connected is null until the profile has been saved: the link token is
// tied to the candidate row, which doesn't exist before the first save.
export function TelegramPanel({ connected: initiallyConnected }: { connected: boolean | null }) {
  const t = useTranslations("telegram");
  const errorText = useErrorText();
  const [connected, setConnected] = useState(initiallyConnected);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => setConnected(initiallyConnected), [initiallyConnected]);

  // The link is used in Telegram, not here, so the page asks until the bot
  // has recorded the chat or the token has expired.
  useEffect(() => {
    if (!link) return;
    const expiresAt = Date.now() + link.expiresInSeconds * 1000;
    const poll = setInterval(async () => {
      if (Date.now() > expiresAt) {
        clearInterval(poll);
        setLink(null);
        return;
      }
      const profile = await apiClient.getMyProfile();
      if (profile?.telegramConnected) {
        clearInterval(poll);
        setLink(null);
        setConnected(true);
      }
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [link]);

  async function createLink() {
    setError(null);
    setCreating(true);
    try {
      setLink(await apiClient.createTelegramLink());
    } catch (err) {
      setError(errorText(err, "telegram.linkFailed"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Slab depth="md" className="grid w-full gap-4 p-5">
      <div>
        <h2 className="type-h3">{t("heading")}</h2>
        <p role="status" className="type-board-md mt-1">
          {connected ? t("connected") : t("notConnected")}
        </p>
      </div>

      {connected === null ? (
        <p className="type-meta text-ink-muted">{t("saveFirst")}</p>
      ) : link ? (
        <div className="grid gap-3">
          <a href={link.deepLink} target="_blank" rel="noreferrer" className={boardButtonClass("stock")}>
            {t("open")}
          </a>
          <p className="type-meta text-ink-muted">{t("orSend")}</p>
          {/* A bot command, typed as is in any language. */}
          <p data-i18n-ignore className="type-board-md select-all break-all border border-ink-muted px-3 py-2">
            /start {link.token}
          </p>
          <p className="type-meta text-ink-muted">{t("linkExpiry", { minutes: Math.round(link.expiresInSeconds / 60) })}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="type-meta text-ink-muted">
            {connected ? t("connectedHelp") : t("pitch")}
          </p>
          <BoardButton surface="stock" variant={connected ? "quiet" : "primary"} onClick={createLink} disabled={creating}>
            {creating ? t("creating") : connected ? t("reconnect") : t("connect")}
          </BoardButton>
        </div>
      )}

      {error && (
        <p role="alert" className="type-meta text-closing-ink">
          {error}
        </p>
      )}
    </Slab>
  );
}
