// Internal-only legacy supplier confirmation. Never fetch or render secrets.
(() => {
  if (!intranet || mode !== "window") return;
  let dialog, pending = false;
  const words = {
    zh: ["发现旧版供应商配置", "检测到此设备上有旧版 Sub2Agent 配置。是否导入供应商及其凭据？", "旧版配置会保留。无法读取的凭据会在导入结果中提示。", "暂不导入", "导入供应商", "供应商导入结果", "已处理", "待处理：请启用供应商插件或重新登录", "完成", "未发现旧版供应商配置", "正在导入…", "已导入", "已存在，保留现有配置"],
    en: ["Previous supplier configuration found", "Import suppliers and credentials from the previous Sub2Agent installation?", "The previous configuration is kept. Unreadable credentials are reported in the result.", "Not now", "Import suppliers", "Supplier import result", "Processed", "Needs attention: enable the provider plugin or sign in again", "Done", "No previous supplier configuration found", "Importing…", "Imported", "Already exists; kept current settings"],
    "zh-TW": ["發現舊版供應商設定", "偵測到此裝置有舊版 Sub2Agent 設定。是否匯入供應商及其憑據？", "舊版設定會保留。無法讀取的憑據會在匯入結果中提示。", "暫不匯入", "匯入供應商", "供應商匯入結果", "已處理", "待處理：請啟用供應商外掛或重新登入", "完成", "未發現舊版供應商設定", "正在匯入…", "已匯入", "已存在，保留目前設定"],
    ja: ["旧バージョンの提供元設定が見つかりました", "旧 Sub2Agent の提供元と認証情報を取り込みますか？", "旧設定は保持されます。読み取れない認証情報は結果に表示します。", "後で", "提供元を取り込む", "取り込み結果", "処理済み", "要確認：提供元プラグインを有効にするか、再ログインしてください", "完了", "旧設定は見つかりませんでした", "取り込み中…", "取り込み済み", "既存の設定を保持しました"],
    de: ["Frühere Anbieter gefunden", "Anbieter und Zugangsdaten aus der früheren Sub2Agent-Version importieren?", "Die bisherigen Einstellungen bleiben erhalten. Nicht lesbare Zugangsdaten erscheinen im Ergebnis.", "Später", "Anbieter importieren", "Importergebnis", "Verarbeitet", "Prüfen: Anbieter-Plugin aktivieren oder erneut anmelden", "Fertig", "Keine früheren Anbieter gefunden", "Import läuft…", "Importiert", "Bereits vorhanden; Einstellungen behalten"]
  };
  function labels() { return words[locale] || words.en; }
  function close() { if (!dialog || pending) return; dialog.close(); dialog.remove(); dialog = null; }
  function show(preview) {
    if (dialog || confirmationPending) return;
    const w = labels();
    dialog = el("dialog", "action-confirm legacy-supplier-dialog");
    dialog.setAttribute("aria-labelledby", "legacy-supplier-title");
    const title = el("h2", "", w[0]); title.id = "legacy-supplier-title";
    const description = el("p", "", w[1]);
    const list = el("div", "legacy-supplier-list");
    const note = el("p", "legacy-supplier-note", w[2]);
    const bar = el("div", "bar"), later = el("button", "text", w[3]), accept = el("button", "text primary", w[4]);
    later.type = accept.type = "button";
    function rows(data, result) {
      list.replaceChildren();
      for (const source of data.sources || []) {
        const row = el("div", "legacy-supplier-row"), name = el("span", "legacy-supplier-name", source.name);
        const state = source.imported ? (source.outcome === "imported" ? w[11] : source.outcome === "existing" ? w[12] : w[6]) : w[7];
        row.append(icon(source.icon), name, el("span", "legacy-supplier-state", result ? state : source.kind === "endpoint" ? "API" : "●"));
        list.append(row);
      }
    }
    rows(preview, false);
    bar.append(el("span", "grow"), later, accept); dialog.append(title, description, list, note, bar); document.body.append(dialog);
    later.onclick = async () => { if (pending) return; try { await api("legacy-suppliers/dismiss", {}); close(); } catch (e) { statusErr(e); } };
    accept.onclick = async () => {
      if (pending) { return; }
      if (accept.dataset.done) { close(); return; }
      pending = true; later.disabled = accept.disabled = true; accept.textContent = w[10];
      try {
        const result = await api("legacy-suppliers/import", {});
        title.textContent = w[5]; description.textContent = result.error || "";
        rows(result.preview || preview, true); note.textContent = w[2];
        accept.dataset.done = "1"; accept.textContent = w[8]; later.hidden = true;
        loadProviders().catch(statusErr);
      } catch (e) { statusErr(e); accept.textContent = w[4]; }
      finally { pending = false; later.disabled = accept.disabled = false; }
    };
    dialog.addEventListener("cancel", e => { e.preventDefault(); later.click(); });
    dialog.showModal(); later.focus(NO_SCROLL);
  }
  async function open() {
    try { const data = await api("legacy-suppliers"); if (!data.found || !data.sources.length) { status(labels()[9]); return; } show(data); }
    catch (e) { statusErr(e); }
  }
  window.legacySuppliers = {open};
  const style = document.createElement("style");
  style.textContent = ".legacy-supplier-list{border-top:1px solid var(--line-2);border-bottom:1px solid var(--line-2);margin:0 0 14px}.legacy-supplier-row{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--line-2)}.legacy-supplier-row:last-child{border-bottom:0}.legacy-supplier-row .ic{width:22px;height:22px;flex:none}.legacy-supplier-name{font-weight:600;min-width:0;overflow-wrap:anywhere}.legacy-supplier-state{margin-left:auto;text-align:right;color:var(--muted);font-size:12px}.legacy-supplier-dialog .legacy-supplier-note{font-size:12px;color:var(--muted)}";
  document.head.append(style);
  window.addEventListener("load", () => api("legacy-suppliers").then(data => {
    if (data.found && !data.complete && !data.dismissed && data.sources.length) show(data);
  }).catch(statusErr), {once:true});
})();
