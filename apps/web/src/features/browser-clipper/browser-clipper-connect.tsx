import { useEffect, useRef, useState } from "react";
import { api } from "@web/shared/api.js";
import { useI18n } from "@web/shared/i18n.js";

export function BrowserClipperConnect() {
  const { t } = useI18n(),
    started = useRef(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
    const state = query.get("state"),
      challenge = query.get("challenge"),
      installationId = query.get("installationId");
    if (
      !state ||
      !/^[a-f0-9-]{36}$/.test(state) ||
      !challenge ||
      !/^[a-f0-9]{64}$/.test(challenge) ||
      !installationId ||
      !/^[a-f0-9-]{36}$/.test(installationId)
    ) {
      setError("clipper_invalid_config");
      return;
    }
    void api<{ code: string; expiresAt: string }>(
      "/me/browser-clipper/authorize",
      "POST",
      { version: 2, installationId, challenge },
    )
      .then((result) => {
        sessionStorage.removeItem("doca.browser-login.pending");
        window.postMessage(
          {
            source: "doca-browser-auth",
            state,
            status: "authorized",
            code: result.code,
          },
          location.origin,
        );
      })
      .catch((error) => {
        setError(error.message);
        window.postMessage(
          {
            source: "doca-browser-auth",
            state,
            status: "failed",
            error: error.message,
          },
          location.origin,
        );
      });
  }, []);
  return (
    <main className="auth">
      <section className="auth-card">
        <h1>{t("clipper.connecting")}</h1>
        <p role="status">
          {error
            ? error === "clipper_connection_revoked"
              ? t("clipper.restoreHelp")
              : t("clipper.loginFailed")
            : t("clipper.connectingHelp")}
        </p>
        <a href="#/browser-assistant">{t("clipper.title")}</a>
      </section>
    </main>
  );
}
