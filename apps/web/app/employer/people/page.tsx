"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { type CompanyRole, companyRoleSchema, type Handover, inviteSchema, type Member, type People } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput, BoardSelect } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useMembership } from "@/lib/membership";
import { useErrorText, useIssueText } from "@/lib/use-error-text";

const ROLES = companyRoleSchema.options;

function InviteForm({ onSent }: { onSent: (note: string) => Promise<void> }) {
  const t = useTranslations("people.invite");
  const role = useTranslations("people.role");
  const errorText = useErrorText();
  const issueText = useIssueText();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [chosen, setChosen] = useState<CompanyRole>("RECRUITER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    const parsed = inviteSchema.safeParse({ name, phone, role: chosen });
    if (!parsed.success) {
      setError(issueText(parsed.error.errors[0]));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sent = await apiClient.invite(parsed.data);
      setName("");
      setPhone("");
      // Nothing is sent to their phone: there is no SMS provider, so the
      // owner tells them, and this is what to tell them.
      await onSent(t("sent", { name: sent.name, address: `${window.location.host}/login`, phone: sent.phone }));
    } catch (err) {
      setError(errorText(err, "people.invite.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} noValidate className="grid gap-3 border border-housing-rule p-4">
      <h2 className="type-h3">{t("heading")}</h2>
      <p className="type-meta text-housing-muted">{t("explain")}</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_10rem]">
        <BoardField label={t("name")}>
          <BoardInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </BoardField>
        <BoardField label={t("phone")}>
          <BoardInput board value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={10} />
        </BoardField>
        <BoardField label={t("role")}>
          <BoardSelect value={chosen} onChange={(e) => setChosen(e.target.value as CompanyRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {role(r)}
              </option>
            ))}
          </BoardSelect>
        </BoardField>
      </div>
      <p className="type-meta text-housing-muted">{t("roleHint", { role: role(chosen), what: t(`can.${chosen}`) })}</p>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      <div>
        <BoardButton type="submit" disabled={busy}>
          {busy ? t("sending") : t("send")}
        </BoardButton>
      </div>
    </form>
  );
}

// Removing someone, with who takes over their open drives chosen first.
function RemovePanel({
  member,
  successors,
  leaving,
  onDone,
  onCancel,
}: {
  member: Member;
  successors: Member[];
  leaving: boolean;
  onDone: (handover: Handover) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("people.remove");
  const errorText = useErrorText();
  const [successorId, setSuccessorId] = useState(successors[0]?.userId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onDone(await apiClient.removeMember(member.userId, member.openDrives > 0 ? successorId : undefined));
    } catch (err) {
      setError(errorText(err, "people.remove.failed"));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 border-l-4 border-closing-lamp bg-housing-raised p-3">
      <p className="type-body">{leaving ? t("leaveQuestion") : t("question", { name: member.name })}</p>
      <p className="type-meta text-housing-muted">{leaving ? t("leaveKeeps") : t("keeps", { name: member.name })}</p>
      {member.openDrives > 0 && (
        <BoardField label={t("successor", { count: member.openDrives })}>
          <BoardSelect value={successorId} onChange={(e) => setSuccessorId(e.target.value)}>
            {successors.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </BoardSelect>
        </BoardField>
      )}
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <BoardButton onClick={remove} disabled={busy}>
          {busy ? t("removing") : leaving ? t("leave") : t("confirm")}
        </BoardButton>
        <BoardButton variant="quiet" onClick={onCancel} disabled={busy}>
          {t("keep")}
        </BoardButton>
      </div>
    </div>
  );
}

export default function PeoplePage() {
  const t = useTranslations("people");
  const role = useTranslations("people.role");
  const errorText = useErrorText();
  const router = useRouter();
  const { formatDate } = useFormat();
  const { can, membership } = useMembership();
  const manages = can("managePeople");
  const [people, setPeople] = useState<People | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const load = useCallback(async () => setPeople(await apiClient.getPeople()), []);
  useEffect(() => {
    load().catch((err) => setError(errorText(err, "people.loadFailed")));
  }, [load]);

  async function run(key: string, action: () => Promise<string | null>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (err) {
      setError(errorText(err, "errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  function handedOver(handover: Handover, name: string) {
    return handover.successor ? t("handedOver", { count: handover.drivesReassigned, name, to: handover.successor.name }) : null;
  }

  function changeRole(member: Member, next: CompanyRole) {
    if (next === "VIEWER" && member.openDrives > 0 && !confirm(t("viewerConfirm", { name: member.name, count: member.openDrives }))) return;
    run(member.userId, async () => handedOver(await apiClient.changeRole(member.userId, next), member.name) ?? t("roleChanged", { name: member.name, role: role(next) }));
  }

  async function removed(member: Member, handover: Handover) {
    setRemoving(null);
    if (member.userId === membership.userId) {
      // They are a candidate again; the new session says so.
      await apiClient.restoreSession();
      router.replace("/");
      return;
    }
    setNotice([t("removed", { name: member.name }), handedOver(handover, member.name)].filter(Boolean).join(" "));
    await load();
  }

  if (!people) {
    return (
      <div className="grid gap-3">
        <h1 className="type-h2">{t("heading")}</h1>
        {error ? (
          <p role="alert" className="type-meta text-closing-lamp">
            {error}
          </p>
        ) : (
          <p role="status" className="type-meta text-housing-muted">
            {t("loading")}
          </p>
        )}
      </div>
    );
  }

  const successorsFor = (member: Member) => people.members.filter((m) => m.userId !== member.userId && m.role !== "VIEWER");

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 text-housing-muted">{t("youAre", { role: role(membership.role), company: membership.company.name })}</p>
      </div>

      {notice && (
        <p role="status" className="type-meta border-l-4 border-live-lamp bg-housing-raised p-3">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}

      {manages && (
        <InviteForm
          onSent={async (note) => {
            await load();
            setNotice(note);
          }}
        />
      )}

      <section aria-labelledby="members-heading" className="grid gap-2">
        <h2 id="members-heading" className="type-h3">
          {t("members", { count: people.members.length })}
        </h2>
        <ul className="border-t border-housing-line">
          {people.members.map((m) => {
            const self = m.userId === membership.userId;
            return (
              <li key={m.userId} className="grid gap-3 border-b border-housing-line py-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <p className="type-body">{self ? t("you", { name: m.name }) : m.name}</p>
                    <p className="type-meta text-housing-muted">
                      {[m.phone, m.openDrives > 0 ? t("openDrives", { count: m.openDrives }) : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {manages ? (
                      <BoardSelect
                        aria-label={t("roleOf", { name: m.name })}
                        value={m.role}
                        disabled={busy !== null}
                        onChange={(e) => changeRole(m, e.target.value as CompanyRole)}
                        className="w-auto min-w-36"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {role(r)}
                          </option>
                        ))}
                      </BoardSelect>
                    ) : (
                      <span className="type-board-sm">{role(m.role)}</span>
                    )}
                    {(manages || self) && removing !== m.userId && (
                      <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy !== null} onClick={() => setRemoving(m.userId)}>
                        {self ? t("leave") : t("removePerson")}
                      </BoardButton>
                    )}
                  </div>
                </div>
                {removing === m.userId && (
                  <RemovePanel
                    member={m}
                    successors={successorsFor(m)}
                    leaving={self}
                    onDone={(handover) => removed(m, handover)}
                    onCancel={() => setRemoving(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="invitations-heading" className="grid gap-2">
        <h2 id="invitations-heading" className="type-h3">
          {t("invitations", { count: people.invitations.length })}
        </h2>
        {people.invitations.length === 0 ? (
          <p className="type-meta text-housing-muted">{t("noInvitations")}</p>
        ) : (
          <ul className="border-t border-housing-line">
            {people.invitations.map((i) => {
              const expired = new Date(i.expiresAt) <= now;
              return (
                <li key={i.id} className="grid gap-2 border-b border-housing-line py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <p className="type-body">
                      {i.name} <span className="type-board-sm text-housing-muted">{role(i.role)}</span>
                    </p>
                    <p className="type-meta text-housing-muted">
                      {[
                        i.phone,
                        t("invitedBy", { name: i.invitedBy }),
                        expired ? t("expired") : t("expires", { day: formatDate(new Date(i.expiresAt)) }),
                      ].join(" · ")}
                    </p>
                  </div>
                  {manages && (
                    <BoardButton
                      variant="quiet"
                      className="min-h-9 px-3"
                      disabled={busy !== null}
                      onClick={() =>
                        run(i.id, async () => {
                          await apiClient.revokeInvitation(i.id);
                          return t("revoked", { name: i.name });
                        })
                      }
                    >
                      {expired ? t("clear") : t("revoke")}
                    </BoardButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
