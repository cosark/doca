import { useI18n } from "@web/shared/i18n.js";
import { writeClipboardText } from "@web/shared/clipboard.js";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Link2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type FileFolder } from "@web/shared/api.js";
import { Feedback } from "@web/shared/components/feedback.js";
import { UserBadge } from "@web/shared/components/user-badge.js";
import { Select } from "@web/shared/components/select.js";
import { PersonPicker } from "@web/features/documents/person-picker.js";
import "@web/features/documents/permissions.css";

type ShareRole = "admin" | "reader";
type Member = {
  user_id: string;
  role: ShareRole;
  version: number;
  display_name: string;
  public_id?: string | null;
};
type Person = { id: string; display_name: string; public_id?: string | null };
type Overview = {
  owner: Person | null;
  currentUser: Person | null;
  members: Member[];
  role: "owner" | ShareRole;
  isOwner: boolean;
  canManage: boolean;
};
type ShareLink = {
  enabled: boolean;
  role: ShareRole;
  token: string | null;
  url: string | null;
  isOwner: boolean;
  maxMembers: number | null;
  memberCount: number;
  expiresAt: string | null;
  revision: number | null;
};
type Page = "main" | "invite" | "members";

export function FolderPermissionPanel({
  folder,
  close,
}: {
  folder: FileFolder;
  close: () => void;
}) {
  const { t } = useI18n();
  const labels = {
    owner: t("search.owner"),
    admin: t("admin.badge"),
    reader: t("fileManager.reader"),
  } as const;

  const [publication, setPublication] = useState<{
    enabled: boolean;
    revision: number;
  } | null>(null);
  const [page, setPage] = useState<Page>("main");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [person, setPerson] = useState<{
    id: string;
    display_name: string;
  } | null>(null);
  const [role, setRole] = useState<ShareRole>("reader");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [limitOpen, setLimitOpen] = useState(false);
  const [draftLimit, setDraftLimit] = useState("1");
  const [limitPosition, setLimitPosition] = useState({ top: 0, left: 0 });
  const limitTrigger = useRef<HTMLButtonElement>(null);
  const limitMenu = useRef<HTMLDivElement>(null);
  const [invitationMessage, setInvitationMessage] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (
        limitOpen &&
        !limitMenu.current?.contains(target) &&
        !limitTrigger.current?.contains(target)
      )
        setLimitOpen(false);
      if (target.closest("[data-permissions-popup]")) return;
      const popup = target.closest("[role=listbox]");
      if (
        popup &&
        Array.from(
          panel.current?.querySelectorAll("[aria-controls]") ?? [],
        ).some((trigger) => trigger.getAttribute("aria-controls") === popup.id)
      )
        return;
      if (
        !panel.current?.contains(target) &&
        !target.closest("[data-permissions-trigger]")
      )
        close();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [close, limitOpen]);

  async function load() {
    setError("");
    const nextOverview = await api<Overview>(
      `/files/folders/${folder.id}/shares`,
    );
    setOverview(nextOverview);
    if (!nextOverview.canManage) {
      setLink(null);
      setPublication(null);
      return;
    }
    const [nextLink, nextPublication] = await Promise.all([
      api<ShareLink>(`/files/folders/${folder.id}/share-link`),
      api<{ enabled: boolean; revision: number }>(
        `/files/folders/${folder.id}/publication`,
      ),
    ]);
    setLink(nextLink);
    setPublication(nextPublication);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [folder.id]);

  async function addMember() {
    if (!person) return;
    setBusy(true);
    setError("");
    try {
      await api(`/files/folders/${folder.id}/shares`, "PUT", {
        userId: person.id,
        role,
        message: invitationMessage.trim(),
      });
      setPerson(null);
      setInvitationMessage("");
      setNotice(t("permissionsUi.invited"));
      setPage("main");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sharingUi.addFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function updateMember(member: Member, nextRole: ShareRole | null) {
    setBusy(true);
    setError("");
    try {
      if (nextRole)
        await api(`/files/folders/${folder.id}/shares`, "PUT", {
          userId: member.user_id,
          role: nextRole,
        });
      else
        await api(
          `/files/folders/${folder.id}/shares/${member.user_id}`,
          "DELETE",
        );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sharingUi.updateFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function updateLink(
    change: Partial<
      Pick<ShareLink, "enabled" | "role" | "maxMembers" | "expiresAt">
    > & { rotate?: boolean },
  ) {
    if (!link) return;
    setBusy(true);
    setError("");
    try {
      setLink(
        await api<ShareLink>(`/files/folders/${folder.id}/share-link`, "PUT", {
          enabled: link.enabled,
          role: link.role,
          revision: link.revision,
          ...change,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sharingUi.settingsFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function copyLink() {
    if (!link?.url) return;
    try {
      await writeClipboardText(
        `${window.location.origin}${window.location.pathname}${link.url}`,
      );
      setError("");
      setNotice(t("sharingUi.linkCopied"));
    } catch {
      setError(t("fileManager.copyFailed"));
    }
  }
  const title =
    page === "main"
      ? t("share.title")
      : page === "invite"
        ? t("share.invite")
        : t("share.members");
  return (
    <div
      ref={panel}
      className="permissions-panel permissions-floating folder-permissions-panel"
      role="dialog"
      aria-label={t("share.title")}
      onKeyDown={(event) => {
        if (event.key === "Escape") page === "main" ? close() : setPage("main");
      }}
    >
      {limitOpen &&
        link &&
        createPortal(
          <div
            ref={limitMenu}
            className="permissions-link-limit-menu"
            data-permissions-popup="true"
            role="dialog"
            aria-label={t("sharingUi.setLimit")}
            style={limitPosition}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setLimitOpen(false);
                limitTrigger.current?.focus();
              }
            }}
          >
            <div className="permissions-link-limit-heading">
              <span>{t("sharingUi.allowedMembers")}</span>
              <small>{t("sharingUi.perLink")}</small>
            </div>
            <div className="permissions-link-limit-presets">
              {[1, 5, 10, 20].map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  className={link.maxMembers === value ? "is-selected" : ""}
                  onClick={() => {
                    setLimitOpen(false);
                    void updateLink({ maxMembers: value });
                  }}
                >
                  {t("sharingUi.members", { count: value })}
                </button>
              ))}
            </div>
            <label className="permissions-link-limit-custom">
              <span>{t("sharingUi.custom")}</span>
              <input
                type="number"
                min={1}
                step={1}
                aria-label={t("sharingUi.customLimit")}
                value={draftLimit}
                onChange={(event) => setDraftLimit(event.target.value)}
              />
              <span>{t("sharingUi.memberUnit")}</span>
              <button
                type="button"
                className="permissions-link-limit-apply"
                disabled={
                  busy ||
                  !Number.isInteger(Number(draftLimit)) ||
                  Number(draftLimit) < 1
                }
                onClick={() => {
                  setLimitOpen(false);
                  void updateLink({ maxMembers: Number(draftLimit) });
                }}
              >
                {t("common.confirm")}
              </button>
            </label>
            <button
              type="button"
              disabled={busy}
              className={`permissions-link-limit-unlimited${link.maxMembers === null ? " is-selected" : ""}`}
              onClick={() => {
                setLimitOpen(false);
                void updateLink({ maxMembers: null });
              }}
            >
              {t("sharingUi.unlimited")}
            </button>
          </div>,
          document.body,
        )}
      <header className="permissions-header">
        <div className="permissions-heading">
          {page !== "main" && (
            <button
              className="icon"
              aria-label={t("sharingUi.back")}
              onClick={() => setPage("main")}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h2>{title}</h2>
        </div>
        <div className="permissions-header-actions">
          <button
            className="icon"
            aria-label={t("sharingUi.close")}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="permissions-body" aria-busy={busy}>
        {error && <Feedback tone="error" message={error} />}
        {notice && <Feedback tone="success" message={notice} />}
        {!overview && !error && (
          <p className="permissions-empty">{t("common.loading")}</p>
        )}
        {overview && page === "main" && (
          <>
            <a
              className="permissions-text-button"
              href={`#/tickets?resourceKind=folder&resourceId=${folder.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {t("permissionsUi.tickets")}
            </a>
            <section className="permissions-self">
              <span className="permissions-self-title">
                {t("permissionsUi.currentUser")}
              </span>
              {overview.currentUser && (
                <UserBadge
                  id={overview.currentUser.id}
                  name={overview.currentUser.display_name}
                  passive
                />
              )}
              <span className="permissions-self-role">
                {labels[overview.role]}
              </span>
            </section>
            <section className="permissions-collaboration">
              <button
                type="button"
                className="permissions-collaborators"
                disabled={!overview.canManage}
                aria-label={t("permissionsUi.collaboratorCount", {
                  count: overview.members.length,
                })}
                onClick={() => setPage("members")}
              >
                <span>{t("share.invite")}</span>
                <span className="permissions-avatars">
                  {overview.members.slice(0, 5).map((member) => (
                    <UserBadge
                      key={member.user_id}
                      id={member.user_id}
                      name={member.display_name}
                      passive
                      avatarOnly
                    />
                  ))}
                  {overview.members.length > 5 && (
                    <span className="permissions-more">
                      +{overview.members.length - 5}
                    </span>
                  )}
                  {overview.canManage && <ChevronRight size={17} />}
                </span>
              </button>
              {overview.canManage && (
                <button
                  type="button"
                  className="permissions-invite-entry"
                  onClick={() => setPage("invite")}
                >
                  <Search size={16} />
                  <span>{t("permissionsUi.search")}</span>
                </button>
              )}
            </section>
            {overview.canManage && publication && (
              <section className="permissions-section">
                <label className="permissions-switch">
                  <span>{t("discovery.publishFolder")}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    disabled={busy}
                    checked={publication.enabled}
                    onChange={async (e) => {
                      setBusy(true);
                      try {
                        setPublication(
                          await api(
                            `/files/folders/${folder.id}/publication`,
                            "PUT",
                            {
                              enabled: e.target.checked,
                              revision: publication.revision,
                            },
                          ),
                        );
                      } catch (error) {
                        setError((error as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </label>
                <p className="subtle">{t("discovery.publishHelp")}</p>
              </section>
            )}
            {overview.canManage && link && (
              <section className="permissions-section share-settings folder-share-link-settings">
                <div className="permissions-section-heading">
                  <h3>{t("sharingUi.linkSharing")}</h3>
                  <label className="permissions-switch">
                    <input
                      role="switch"
                      type="checkbox"
                      checked={link.enabled}
                      disabled={busy}
                      onChange={(event) =>
                        void updateLink({ enabled: event.target.checked })
                      }
                    />
                  </label>
                </div>
                {link.enabled && (
                  <>
                    <div className="permissions-link-row">
                      <span className="permissions-link-icon">
                        <Link2 size={21} />
                      </span>
                      <span className="permissions-link-label">
                        <strong>{t("sharingUi.linkAudience")}</strong>
                        <small>{t("sharingUi.joinAfterLogin")}</small>
                      </span>
                      <button
                        type="button"
                        ref={limitTrigger}
                        className="permissions-link-limit"
                        aria-label={t("sharingUi.memberLimit")}
                        aria-haspopup="dialog"
                        aria-expanded={limitOpen}
                        disabled={busy}
                        onClick={() => {
                          if (limitOpen) {
                            setLimitOpen(false);
                            return;
                          }
                          const rect =
                            limitTrigger.current!.getBoundingClientRect();
                          setLimitPosition({
                            top: Math.min(
                              rect.bottom + 6,
                              window.innerHeight - 230,
                            ),
                            left: Math.min(rect.left, window.innerWidth - 250),
                          });
                          setDraftLimit(
                            link.maxMembers === null
                              ? "1"
                              : String(link.maxMembers),
                          );
                          setLimitOpen(true);
                        }}
                      >
                        {link.maxMembers === null
                          ? t("sharingUi.unlimited")
                          : t("sharingUi.members", { count: link.maxMembers })}
                      </button>
                      <Select
                        aria-label={t("sharingUi.permission")}
                        value={link.role}
                        disabled={busy}
                        onChange={(event) =>
                          void updateLink({
                            role: event.target.value as ShareRole,
                          })
                        }
                      >
                        <option value="reader">{t("role.reader")}</option>
                        {link.isOwner && (
                          <option value="admin">{t("role.manager")}</option>
                        )}
                      </Select>
                      <button
                        className="primary"
                        onClick={() => void copyLink()}
                      >
                        <Copy size={16} />
                        {t("sharingUi.copyLink")}
                      </button>
                    </div>
                    <label>
                      {t("sharingUi.expiry")}
                      <input
                        type="datetime-local"
                        disabled={busy}
                        key={link.expiresAt ?? "none"}
                        defaultValue={
                          link.expiresAt
                            ? new Date(
                                new Date(link.expiresAt).getTime() -
                                  new Date(link.expiresAt).getTimezoneOffset() *
                                    60000,
                              )
                                .toISOString()
                                .slice(0, 16)
                            : ""
                        }
                        onBlur={(event) => {
                          const next = event.target.value
                            ? new Date(event.target.value).toISOString()
                            : null;
                          if (next !== link.expiresAt)
                            void updateLink({ expiresAt: next });
                        }}
                      />
                    </label>
                    <small>
                      {t("sharingUi.acceptedCount", {
                        count: link.memberCount,
                      })}
                    </small>
                    <button
                      className="permissions-text-button"
                      disabled={busy}
                      onClick={() => void updateLink({ rotate: true })}
                    >
                      {t("sharingUi.changeLink")}
                    </button>
                  </>
                )}
              </section>
            )}
          </>
        )}
        {overview?.canManage && page === "invite" && (
          <form
            className="permissions-invite-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addMember();
            }}
          >
            <fieldset className="permissions-form" disabled={busy}>
              <div className="permissions-invite-recipient">
                <h3>{t("dialog.chooseCollaborator")}</h3>
                <PersonPicker
                  autoFocus
                  selected={person}
                  clear={() => setPerson(null)}
                  select={setPerson}
                />
              </div>
              <label>
                {t("permissionsUi.grant")}
                <Select
                  aria-label={t("permissionsUi.inviteAccess")}
                  value={role}
                  onChange={(event) => setRole(event.target.value as ShareRole)}
                >
                  <option value="reader">{t("fileManager.reader")}</option>
                  {overview.isOwner && (
                    <option value="admin">{t("admin.badge")}</option>
                  )}
                </Select>
              </label>
              <label>
                {t("ticket.inviteNote")}
                <textarea
                  aria-label={t("ticket.inviteNote")}
                  placeholder={t("permissionsUi.noteHint")}
                  maxLength={1000}
                  rows={3}
                  value={invitationMessage}
                  onChange={(event) => setInvitationMessage(event.target.value)}
                />
              </label>
              <footer>
                <button type="button" onClick={() => setPage("main")}>
                  {t("common.cancel")}
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={!person || busy}
                >
                  {busy
                    ? t("sharingUi.adding")
                    : t("sharingUi.addCollaborator")}
                </button>
              </footer>
            </fieldset>
          </form>
        )}
        {overview?.canManage && page === "members" && (
          <>
            {overview.members.map((member) => {
              const canAdjust = overview.isOwner || member.role === "reader";
              return (
                <div className="permissions-member" key={member.user_id}>
                  <div className="permissions-person">
                    <UserBadge id={member.user_id} name={member.display_name} />
                    <small>@{member.public_id || member.user_id}</small>
                  </div>
                  {canAdjust ? (
                    <div className="permissions-member-controls">
                      <Select
                        aria-label={t("permissionsUi.accessFor", {
                          name: member.display_name,
                        })}
                        value={member.role}
                        disabled={busy}
                        onChange={(event) =>
                          void updateMember(
                            member,
                            event.target.value as ShareRole,
                          )
                        }
                      >
                        <option value="reader">
                          {t("fileManager.reader")}
                        </option>
                        {overview.isOwner && (
                          <option value="admin">{t("admin.badge")}</option>
                        )}
                      </Select>
                      <button
                        className="icon"
                        disabled={busy}
                        onClick={() => void updateMember(member, null)}
                        aria-label={t("permissionsUi.removePerson", {
                          name: member.display_name,
                        })}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ) : (
                    <span className="permissions-member-role">
                      {labels[member.role]}
                    </span>
                  )}
                </div>
              );
            })}
            {!overview.members.length && (
              <p className="permissions-empty">
                {t("permissionsUi.noCollaborators")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
