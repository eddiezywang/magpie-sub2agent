// Loaded only for custom API access. A successful response, not a URL guess,
// decides which protocols are saved. Credentials stay on the local API path.
export function setup(editor, wrap, url, draft, provider, use, typed) {
  const note = document.createElement("div");
  note.className = "hint auto-gateway-status";
  note.textContent = t("Available protocols are detected when adding; no manual selection is needed.");
  wrap.append(note);
  let confirmed = "", pending = null;
  const fingerprint = () => JSON.stringify([url.value.trim(), typed(), draft.extra]);
  return async () => {
    if (pending) return false;
    const before = fingerprint();
    if (confirmed === before) return true;
    const base = url.value.trim();
    if (!base) { note.textContent = t("Type the base URL first"); url.focus(); return false; }
    const body = { ...typed(), id: provider?.id, base, model: "", picked: (draft.extra || []).slice(0, 30) };
    // Probe each protocol at the entered base, not at stale form endpoints.
    for (const key of ["chat", "responses", "anthropic", "gemini"]) body[key] = "";
    if (!provider && draft.copyOf) Object.assign(body, { new: true, copyOf: draft.copyOf });
    note.textContent = t("Asking each API…");
    pending = api("provider/detect", body);
    try {
      const result = await pending;
      if (!editor.isConnected || fingerprint() !== before) return false;
      const answers = (result?.results || []).filter((x) => x.ok && x.base);
      if (!answers.length) {
        note.textContent = t("No protocol answered. Check the gateway URL and API key; if there is no model list, enter a model and try again.");
        return false;
      }
      for (const key of ["chat", "responses", "anthropic", "gemini"]) draft[key] = "";
      use(answers);
      confirmed = fingerprint();
      note.textContent = answers.map((x) => ({chat: "OpenAI", responses: "OpenAI Responses", anthropic: "Anthropic", gemini: "Gemini"})[x.protocol]).filter(Boolean).join(" · ");
      return true;
    } catch (err) {
      note.textContent = err.message;
      return false;
    } finally { pending = null; }
  };
}
