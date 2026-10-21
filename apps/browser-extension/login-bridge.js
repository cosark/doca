(() => {
  if (!location.hash.startsWith("#/browser-connect?")) return;
  const expected = new URLSearchParams(location.hash.split("?")[1]).get(
    "state",
  );
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      data?.source !== "doca-browser-auth" ||
      data.state !== expected ||
      !["authorized", "login-required", "failed"].includes(data.status)
    )
      return;
    if (data.status === "authorized" && !/^[a-f0-9]{64}$/.test(data.code))
      return;
    void chrome.runtime
      .sendMessage({
        type: "loginResult",
        state: expected,
        status: data.status,
        code: data.code,
        error: data.error,
      })
      .catch(() => {});
  });
})();
