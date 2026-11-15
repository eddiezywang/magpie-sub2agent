// Shared native Agent surface. Functions run after app.js initializes state.
function renderAgentsLoading() {
  const page = $("#view-agents");
  page.classList.add("loading");
  page.setAttribute("aria-busy", "true");
  const list = $("#agents");
  list.replaceChildren();
  homeAgentPrefRows();
  for (let i = 0; i < 5; i++) {
    const row = el("div", "row agent ag-sk-row");
    const who = el("div", "who");
    who.append(el("span", "skeleton ag-sk-name"));
    // the panel says what is set in words at the right; the window has two
    // setting columns
    const rest = el("div", mode === "panel" ? "ag-sk-sum" : "fields");
    if (mode === "panel") rest.append(el("span", "skeleton ag-sk-value"), el("span", "skeleton ag-sk-bars"));
    else rest.append(el("span", "skeleton ag-sk-field"), el("span", "skeleton ag-sk-field"));
    row.append(el("span", "skeleton ag-sk-icon"), who, rest);
    list.append(row);
  }
  fit(); // the panel as tall as the rows, not as it was
}

function renderAgents() {
  if (intranet) import("../../agentconnections.js").then((m) => m.enter(), statusErr);
  renderCodexMemories(); // the Codex sheet's row is the same field
  renderCodexSubagentModel(); // and this one
  if (agentArranging) { agentRenderPending = true; return; }
  if (unhideCleared()) return; // it renders again with the hiding dropped
  const page = $("#view-agents");
  page.classList.remove("loading");
  page.removeAttribute("aria-busy");
  const list = $("#agents");
  list.replaceChildren();
  homeAgentPrefRows(); // an opened row's, back in the page (ysm119)
  agentsLead(list);
  self.gatewaySkewLine?.(list);
  if (!state.agents.length) {
    const e = el("div", "empty-state");
    e.append(el("b", "", t("No agents found")), el("span", "", t("Install Claude Code, Codex, Gemini CLI, OpenCode… and magpie will list them here.")));
    list.append(e);
  }
  const { shown: used, folded } = arrangeAgents();
  if (mode === "panel") $("#ptabN").textContent = state.agents.length || "";
  const agentRow = (a, inFold) => {
    const row = el("div", "row agent");
    row.dataset.id = a.id;
    row.title = a.path;
    row.oncontextmenu = (ev) => { ev.preventDefault(); openAgentMenu(row.querySelector(".ag-handle"), a, inFold, { x: ev.clientX, y: ev.clientY }); };
    const who = el("div", "who");
    who.append(el("div", "name", a.name));
    // the model picker takes the wide column, everything else the narrow one,
    // so the controls line up down the list
    const fields = el("div", "fields");
    const wide = (f) => f.label === "model" || f.label === "large" || f.label === "executor" || f.label === "planner";
    // a field with nothing to pick and nothing set isn't drawn (#1499)
    const none = (f) => (f.key === "effort" || toggled(f) || f.label === "subagents" || f.label === "gateway" || f.label === SUB_EFFORT || f.label === SUB_MODEL || f.label === AUTO_MODE || f.label === MEMORIES || f.label === COMPACT_MODEL || f.label === "sign-in" || f.key === "small" || asideAccount(a, f)) && !f.options.length && !f.value;
    const shownFields = a.fields.filter((f) => !grouped(a, f) && !none(f) && !codexOwnSub(a, f) && !codexRowed(a, f) && !hermesBot(f));
    const tiers = tierMenu(a);
    if (tiers) shownFields.push(tiers);
    const sorted = shownFields.sort((x, y) => wide(y) - wide(x) || extra(x) - extra(y));
    const plain = sorted.filter((f) => !extra(f)).length;
    // the squares share one cell, side by side
    const extras = el("span", "extras-cell");
    const fieldBtn = (f, cls) => {
      const b = el("button", "field " + cls);
      const opt = optionFor(f, f.value);
      b.title = claudePicks(a, f) && !f.value ? t("{label}: {value}", { label: t(f.label), value: t(AUTO_MODE_UNSET) }) + "\n" + t(CLAUDE_PICKS)
        : t("{label}: {value}", { label: t(f.label), value: f.value || t("agent default") }) + (opt?.note ? ` · ${opt.note}` : "");
      if (f.value && opt?.direct) b.title += "\n" + directSaid(a, opt);
      const effort = f.key === "effort" || f.label === "effort" || f.label === "thinking" || TIER_EFFORTS.includes(f.label) || f.label === SUB_EFFORT;
      if (opt?.icon || opt?.icons?.length) b.append(optionIcon(opt));
      // no logo of its own: effort's icon, or the agent's for its default
      else if (effort) b.append(effortIcon(f));
      else if (!f.value && !f.menu && a.icon) b.append(icon(a.icon));
      else if (!wide(f) || !f.value) b.append(el("span", "k", t(f.label)));
      if ((f.label === "executor" || f.label === "planner") && !b.querySelector(".k")) b.append(el("span", "k", t(f.label)));
      const shown = f.menu ? f.summary : effort ? effortName(opt || { value: f.value }) : (opt?.label || f.value || t(claudePicks(a, f) ? AUTO_MODE_UNSET : FOLLOWS_MODEL.includes(f.label) ? "same as model" : "default"));
      if (f.menu) b.title = f.options.map((o) => `${o.label}: ${o.note}`).join("\n");
      b.append(el("span", "v" + (f.value || f.custom ? "" : " empty"), shown));
      if (f.value && opt?.fast) b.append(fastTag(opt.ultra));
      if (f.value && opt?.ref) { b.dataset.ref = opt.ref; const g = loadTag(loadOf(opt.ref)); if (g) b.append(g); }
      const c = el("span", "chev");
      c.append(svg(CHEV, 11, 1.7));
      b.append(c);
      b.dataset.key = f.key;
      const fieldState = a.native?.fields?.[f.key];
      if (fieldState?.detail) b.title += "\n" + t(fieldState.detail);
      if (fieldState?.status === "unavailable") b.classList.add("drifted");
      b.onclick = (ev) => openPicker(a, f, b, ev);
      return b;
    };
    for (const f of sorted) {
      if (extra(f)) { extras.append(extraField(a, f)); continue; }
      fields.append(fieldBtn(f, plain === 1 ? "solo" : wide(f) ? "main" : "side"));
    }
    // an agent that takes the gateway only from its environment (agy): a
    // square that copies the command starting it on magpie
    // one with nothing else to set (Cursor Private Inference) has the
    // command as its one control, in words
    const launchOnly = !!a.launch && !a.fields.length && !a.import;
    if (a.launch && !launchOnly) extras.append(launchButton(a));
    // the panel's settings open in a sheet (connectPanel)
    if (mode === "panel" && agentPrefsOf(a)) fields.append(agentPrefsButton(a));
    if (extras.childNodes.length) fields.append(extras);
    // an app taking magpie by a link (Cindy): its row opens it
    if (a.import && mode !== "panel") fields.append(importButton(a));
    if (launchOnly && mode !== "panel") fields.append(launchSolo(a));
    // the panel shows what's set as words, and a row's controls only
    // once it's opened: one row at a time, in place
    let sum = null, openBox = null;
    const effortOf = (f) => f.key === "effort" || f.label === "effort" || f.label === "thinking";
    if (mode === "panel" && (a.import || launchOnly)) {
      // in words like the rest, the row itself the link (or the command)
      const act = a.import ? importButton(a) : launchSolo(a);
      sum = el("span", "ag-sum");
      sum.append(a.import ? el("span", "v" + (a.added ? "" : " empty"), a.added ? "magpie" : t("Add magpie")) : el("span", "v empty", t("Copy launch command")), el("span"));
      const c = el("span", "chev");
      c.append(a.import ? svg(OUT, 10, 1.6) : svg(LAUNCH_GLYPH, 10, 1.5));
      sum.append(c);
      row.title = act.title;
      row.onclick = (ev) => {
        if (ev.target.closest(".ag-handle, .ag-fix, .ag-show")) return;
        act.click();
      };
    } else if (mode === "panel") {
      sum = el("span", "ag-sum");
      const main = sorted.find((f) => !extra(f) && !f.menu && !effortOf(f));
      const opt = main && optionFor(main, main.value);
      // the model in words, its logo coming in beside them on hover
      const v = el("span", "v" + (main?.value ? "" : " empty"));
      if (main?.value && (opt?.icon || opt?.icons?.length)) {
        const mi = el("span", "mi");
        mi.setAttribute("aria-hidden", "true");
        mi.append(el("span", "mi-in"));
        mi.firstChild.append(optionIcon(opt));
        // its width to open to, read as the pointer comes onto the row:
        // before :hover is styled, so the box eases open from nothing
        row.addEventListener("pointerenter", () => {
          if (!mi.style.getPropertyValue("--w")) mi.style.setProperty("--w", mi.firstChild.offsetWidth + "px");
        });
        v.append(mi);
      }
      v.append(el("span", "vt", menuFromList(a) ? menuSaid(a.models) : main ? (opt?.label || main.value || t("default")) : ""));
      sum.append(v);
      // how much effort as three bars, in a column of its own down the list:
      // none lit for the default, off, none or auto, or for an agent that has
      // no such setting
      const ef = a.fields.find(effortOf);
      sum.append(effortBars(ef));
      const c = el("span", "chev");
      c.append(svg(CHEV, 10, 1.6));
      sum.append(c);
      // opened: each setting on a line of its own, named, and the effort as
      // its levels side by side
      // .ag-in clips while the row opens or closes, .ag-body holds the lines
      openBox = el("div", "ag-open");
      const body = el("div", "ag-body");
      openBox.append(el("div", "ag-in"));
      openBox.firstChild.append(body);
      for (const b of [...fields.querySelectorAll(":scope > .field")]) {
        const f = sorted.find((x) => x.key === b.dataset.key) || (b.dataset.key === "tiers" ? tiers : null);
        if (f && effortOf(f)) { body.append(effortSeg(a, f)); continue; }
        if (f && !b.querySelector(":scope > .k")) b.prepend(el("span", "k", t(f.label)));
        body.append(b);
      }
      // Claude Desktop's: which models its own menu lists, under its
      // provider
      if (menuFromList(a)) {
        const m = menuButton(a, "main");
        m.prepend(el("span", "k", t("Models")));
        body.append(m);
      }
      if (extras.childNodes.length) body.append(extras);
      row.classList.toggle("open", panelOpenAgent === a.id);
      row.setAttribute("aria-expanded", String(panelOpenAgent === a.id));
      row.onclick = (ev) => {
        if (ev.target.closest(".ag-open, .ag-handle, .ag-fix, .ag-show")) return;
        const open = panelOpenAgent !== a.id;
        panelOpenAgent = open ? a.id : null;
        // the panel's edge moves with the rows, on their curve
        let grow = open ? openBox.querySelector(".ag-body").offsetHeight : 0;
        for (const r of $("#agents").querySelectorAll(".row.agent.open")) {
          grow -= r.querySelector(".ag-in")?.offsetHeight || 0;
          r.classList.remove("open");
          r.setAttribute("aria-expanded", "false");
        }
        row.classList.toggle("open", open);
        row.setAttribute("aria-expanded", String(open));
        fit(grow, open ? ROW_OPEN : ROW_CLOSE);
        const settle = (ev) => {
          if (ev.target !== openBox || ev.propertyName !== "grid-template-rows") return;
          openBox.removeEventListener("transitionend", settle);
          fit();
        };
        openBox.addEventListener("transitionend", settle);
      };
    }
    // one hidden by hand says its way back in words
    if (inFold && isHidden(a)) {
      row.classList.add("put-away");
      const back = el("button", "ag-show");
      back.type = "button";
      back.title = t("Hidden by you · show it in the list again");
      back.append(svg(EYE, 12, 1.5), el("span", "", t("Show")));
      back.onclick = (e) => { e.stopPropagation(); setAgentHidden(a, false); };
      who.append(back);
    }
    // its CLI uninstalled (#2177, #2173): only that it is gone, and the
    // switch of one still connected
    if (a.cliMissing) {
      row.classList.add("gone");
      row.classList.remove("open");
      row.removeAttribute("aria-expanded");
      row.onclick = null;
      row.append(agentHandle(a, row, inFold), who);
      if (mode === "panel") {
        const gone = el("span", "ag-sum");
        gone.append(el("span", "v empty", t("CLI not found")), el("span"), el("span"));
        gone.onmouseenter = () => { gone.title = goneSaid(a); };
        row.append(gone);
        return row;
      }
      who.append(cliTag(a));
      if (a.wired && connectable(a)) row.append(connectSwitch(a));
      return row;
    }
    // on the name's line; a row with 「接入」 says it under the name
    const kind = mode !== "panel" ? connectKind(a) : "";
    if (a.drift) {
      row.classList.add("drifted");
      if (!kind) who.append(driftFix(a));
    }
    // an app started before magpie's last change (the panel's row)
    else if (!kind && a.appRestart) who.append(appRestart(a));
    // the CLI's version and its update (#202)
    if (mode !== "panel") who.append(cliTag(a));
    if (mode !== "panel" && isHere(a)) who.append(Object.assign(el("span", "ag-missing ag-here", t(HERE_TAG)), { title: t(HERE_TIP, { agent: a.name }) }));
    // which of magpie's models its lists show, on a line under the name
    if (mode !== "panel" && a.models && !kind) {
      const line = el("div", "ag-models-line");
      line.append(modelsEntry(a));
      who.append(line);
      who.classList.add("with-models");
    }
    // connected to magpie or not, said under the name, with where the agent
    // picks among magpie's models itself
    const sw = connectable(a) ? connectSwitch(a) : null;
    if (kind) {
      // Claude Code's tiers, subagents and auto mode have rows of their own
      // when opened
      if (kindOf(a) === "claude") {
        for (const f of a.fields.filter((f) => TIERS.includes(f.label) || f.label === "subagents" || f.label === SUB_EFFORT || f.label === AUTO_MODE)) extras.querySelector(`[data-key="${CSS.escape(f.key)}"]`)?.remove();
        extras.querySelector('[data-key="tiers"]')?.remove();
      }
      row.append(agentHandle(a, row, inFold), who);
      connectRow(a, row, who, { fields, extras, fieldBtn, sw, kind });
      return row;
    }
    const acct = openBox && switchEntry(a);
    if (acct) openBox.querySelector(".ag-body").prepend(acct.button);
    if (sw && openBox) {
      const line = el("div", "ag-conn-row");
      line.append(el("span", "k", t("magpie")), el("span", "ag-conn-said", connectSaid(a)), sw);
      openBox.querySelector(".ag-body").prepend(line);
    }
    row.append(agentHandle(a, row, inFold), who);
    if (sum) row.append(sum, ...(openBox ? [openBox] : []));
    else row.append(fields, ...(sw ? [sw] : []));
    return row;
  };
  // the extras column is there for every row once any agent has one, so the
  // pickers keep lining up down the list
  // (a row whose CLI is gone has none)
  const setUp = state.agents.filter((a) => !a.cliMissing);
  const sq = (a) => a.fields.filter((f) => extra(f) && !codexRowed(a, f));
  list.classList.toggle("extras", setUp.some((a) => sq(a).length || tierMenu(a) || a.launch));
  // as wide as the row with the most squares
  list.style.setProperty("--extras", Math.max(1, ...setUp.map((a) => sq(a).filter((f) => !grouped(a, f)).length + (tierMenu(a) ? 1 : 0) + (a.launch ? 1 : 0))));
  if (!folded.length) {
    for (const a of used) list.append(agentRow(a));
  } else {
    // the ones in use stay put; the rest unroll beneath them like a scroll
    for (const a of used) list.append(agentRow(a));
    const fold = el("div", "agent-fold" + (showAllAgents ? " open" : ""));
    const inner = el("div", "agent-fold-inner");
    inner.inert = !showAllAgents;
    fold.style.setProperty("--n", folded.length);
    // the ones nothing is set on, then, last and least, the ones hidden by
    // hand (0xZaTe on Discord: listed first, right under the agents in use,
    // hidden read as pinned, 反而更显眼了). Under the others the hidden ones
    // are a disclosure of their own, shut until it is opened, as a Finder
    // sidebar section is; with nothing else folded, the fold is theirs.
    const byHand = folded.filter(isHidden), unset = folded.filter((a) => !isHidden(a));
    if (!byHand.length) showHiddenAgents = false;
    let i = 0;
    const rows = (group, into) => {
      for (const a of group) {
        const row = agentRow(a, true);
        row.style.setProperty("--i", i++);
        into.append(row);
      }
    };
    const cap = (text) => {
      const c = el("div", "agent-fold-cap", text);
      c.style.setProperty("--i", i);
      inner.append(c);
    };
    if (unset.length) {
      cap(t("Not set up"));
      rows(unset, inner);
    }
    if (byHand.length && !unset.length) {
      cap(t("Hidden"));
      rows(byHand, inner);
    } else if (byHand.length) {
      const line = el("button", "agent-fold-cap agent-hid-line");
      line.type = "button";
      line.style.setProperty("--i", i);
      line.title = t("Hidden by you · click to see them");
      const hc = el("span", "chev");
      hc.append(svg(CHEV, 9, 1.8));
      line.append(el("span", "", t("Hidden ({n})", { n: byHand.length })), hc);
      const hf = el("div", "agent-hid-fold" + (showHiddenAgents ? " open" : ""));
      const hi = el("div", "agent-hid-inner");
      hi.inert = !showHiddenAgents;
      hf.id = "agentsHidden";
      line.setAttribute("aria-controls", hf.id);
      line.setAttribute("aria-expanded", String(showHiddenAgents));
      rows(byHand, hi);
      hf.append(hi);
      hf.addEventListener("transitionend", (e) => { if (e.target === hf) fit(); });
      line.onclick = (e) => {
        showHiddenAgents = !showHiddenAgents;
        const room = hi.scrollHeight;
        fit(showHiddenAgents ? room : -room, showHiddenAgents ? UNROLL : ROLLUP);
        hf.classList.toggle("open", showHiddenAgents);
        hi.inert = !showHiddenAgents;
        line.setAttribute("aria-expanded", String(showHiddenAgents));
        if (showHiddenAgents) unrollInView(hf, line, e);
      };
      inner.append(line, hf);
    }
    fold.append(inner);
    const more = el("button", "agent-more");
    more.dataset.unrolls = ""; // it goes down with the rows it opens
    const label = el("span", "", "");
    const chev = el("span", "chev");
    chev.append(svg(CHEV, 10, 1.8));
    more.append(label, chev);
    const labelFor = () => {
      // what is folded, and how many of them were hidden by hand
      label.textContent = showAllAgents ? t("Show less")
        : !unset.length ? t("{n} hidden agents", { n: byHand.length })
        : !used.length ? t("Show all {n} agents", { n: unset.length })
        : t("Show {n} more", { n: unset.length });
      more.setAttribute("aria-expanded", String(showAllAgents));
    };
    labelFor();
    // settled: the soft edge goes, and a folded scroll gives the panel its room
    // back. A hidden window never ends its transition, so a timer backs it up.
    let settle;
    const settled = () => {
      clearTimeout(settle);
      fold.classList.remove("moving");
      fit();
    };
    fold.addEventListener("transitionend", (e) => { if (e.target === fold) settled(); });
    more.onclick = (e) => {
      showAllAgents = !showAllAgents;
      // a fold of hidden ones only is the hidden ones' disclosure: Show on
      // one of them leaves the rest open under their own line
      if (!unset.length) showHiddenAgents = showAllAgents;
      // the panel's edge moves with the scroll, on the same beat and curve
      const room = inner.scrollHeight;
      fit(showAllAgents ? room : -room, showAllAgents ? UNROLL : ROLLUP);
      clearTimeout(settle);
      settle = setTimeout(settled, 900);
      fold.classList.add("moving");
      fold.classList.toggle("open", showAllAgents);
      inner.inert = !showAllAgents;
      labelFor();
      if (!calm()) {
        label.animate([{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(.22, 1, .36, 1)" });
      }
      if (showAllAgents) unrollInView(fold, more, e);
    };
    // the button, then what it unrolls: the rest come in under it, and the
    // rows above stay where they are (the scroll unrolling above the button
    // pushed it off the foot of a panel at its tallest, or, held there, drew
    // the whole list up past it)
    list.append(more, fold);
  }

  agentsManageButton(list);
  confirmAsk?.refreshAgents?.();
  paintUpdateAll();
  paintInstalls();
  renderProfiles();
  fit(0, agentsGlide);
  agentsGlide = null;
}

function connectSwitch(a) {
  const s = libSwitch("ag-conn", a.wired, t("Connect {agent} to magpie", { agent: a.name }));
  s.title = a.wired ? t("Connected · switch off to put back what {agent} had before magpie", { agent: a.name }) : t("Switch on and {agent}'s model list gets magpie's models", { agent: a.name });
  // the list opened from a failed connect, drawn again while it is open
  if (!a.wired) holdAgentModels(a, s);
  s.onclick = async (e) => {
    e.stopPropagation();
    if (window.agentConnectionBusy?.(a.id)) return;
    if (a.wired) { askDisconnect(a); return; }
    if (s.disabled) return;
    s.disabled = true;
    s.classList.add("on");
    try {
      state = await api("agents/connect/" + a.id, {});
      renderAgents();
      const msg = connectedSaid(a, state.connected);
      saidOk(msg, msg !== t("{agent} is connected to magpie", { agent: a.name }) ? 7000 : undefined);
    } catch (err) {
      s.disabled = false;
      s.classList.remove("on");
      // every model taken out of its list: the Pick that puts one back is
      // in a connected agent's row only, so its list opens here (塔哥 on
      // Discord: Grok Build, all hidden, then switched off, couldn't be
      // connected again)
      if (err.code === "all_hidden") {
        noneLeft(a);
        openAgentModels(a, s, e);
        return;
      }
      status(t(err.message), "err");
    }
  };
  return s;
}

function connectRow(a, row, who, { fields, extras, fieldBtn, sw, kind }) {
  // its list open, what was picked there until the state has it
  if (agentModels?.a.id === a.id && agentModels.count) a.models = agentModels.count;
  row.classList.add("conn");
  row.classList.toggle("unplugged", kind === "ok" && !a.wired);
  who.classList.add("with-models");
  who.append(connectLine(a, kind));
  // a hidden one's Show centred in the row, as its switch is (#842)
  const back = who.querySelector(":scope > .ag-show");
  if (back) row.append(back);
  // the model it starts on, beside the switch; picked, it connects (the owner)
  const start = kind === "ok" && !listsMenu(a) ? startField(a) : null;
  if (start) fields.querySelector(`:scope > [data-key="${CSS.escape(start.key)}"]`)?.remove();
  if (kind === "ok") {
    if (a.wired) {
      // a click on the row off its controls opens it, as on the Mac (NG_shiyu)
      const link = expandLink(a);
      row.append(link);
      row.onclick = (ev) => {
        if (ev.target.closest("button, a, input, label, [role], .ag-exp, .ag-handle")) return;
        if (!getSelection()?.isCollapsed) return; // words being selected
        link.click();
      };
    }
    // the square copying the command that starts it on magpie (agy), the
    // only way it takes magpie: on the row, before the model
    const launch = a.wired && fields.querySelector(".field.launch");
    if (launch) row.append(launch);
    if (start) row.append(startButton(a, start, fieldBtn));
    // Claude Desktop's: which models its own menu lists
    else if (menuFromList(a)) row.append(menuButton(a));
    row.append(sw);
  } else if (kind === "empty") {
    const add = el("button", "ag-add", t("Add a provider"));
    add.type = "button";
    add.onclick = (e) => { e.stopPropagation(); addProviderFromAgents(); };
    const off = libSwitch("ag-conn", false, t("Connect {agent} to magpie", { agent: a.name }));
    off.disabled = true;
    off.title = t("Add a key or a subscription first; then there are models to connect");
    row.append(add, off);
  } else if (kind === "link") {
    // its link where a model stands, the switch's room kept (the owner)
    const b = importButton(a);
    b.classList.add("ag-start");
    row.append(b, el("span", "ag-conn-gap"));
  } else row.append(el("span", "ag-cant", t("Can't connect")));
  if (kind === "ok" && a.wired && agentExpanded === a.id) {
    row.classList.add("expanded");
    row.append(connectPanel(a, { fields: fields.querySelector(".field") ? fields : null, extras, fieldBtn }));
  }
}
async function guideConnect(a, ev) {
  if (guideBusy) return;
  guideBusy = a.id;
  guideRedraw();
  try {
    state = await api("agents/connect/" + a.id, {});
    guideBusy = "";
    renderAgents();
    const msg = connectedSaid(a, state.connected);
    saidOk(msg, 7000);
  } catch (err) {
    guideBusy = "";
    guideRedraw();
    // every model taken out of its list: its list opens at its chip, as
    // at the row's switch (connectSwitch)
    const chip = err.code === "all_hidden" && document.querySelector(`.guide-agent[data-id="${CSS.escape(a.id)}"]`);
    if (chip) {
      noneLeft(a);
      openAgentModels(a, chip, ev);
      return;
    }
    status(t(err.message), "err");
  }
}

async function guideTemplate(tp, name) {
  if (guideBusy) return;
  guideBusy = "template";
  guideRedraw();
  try {
    guideGroups = await api("groups/template", { kind: tp.kind, name });
    guideBusy = "";
    status(t("Added {name}", { name }), "ok");
    // the agents' pickers list the new group
    state = await api("state");
    renderAgents();
  } catch (err) {
    guideBusy = "";
    guideRedraw();
    status(t(err.message), "err");
  }
}

async function hideGuide() {
  if (guideBusy) return;
  guideBusy = "hide";
  guideRedraw();
  try {
    prefs = await writingPrefs(api("settings/guide", { hidden: true }));
    state.settings = prefs;
    guideBusy = "";
    renderAgents();
  } catch (err) {
    guideBusy = "";
    guideRedraw();
    status(t(err.message), "err");
  }
}

async function addProviderFromAgents() {
  if (!await show("providers")) return;
  // the list not read yet (the page's first opening): clicked before it is
  // in, the button drew a list of nothing and threw; read, an empty list
  // opens the sheet itself
  if (!providers) { try { await loadProviders(); } catch { return; } }
  if (!adding) $("#addProvider")?.click();
}

function agentsLead(list) {
  let lead = $("#agentsLead");
  if (!lead) {
    lead = el("div", "ag-lead");
    lead.id = "agentsLead";
    list.before(lead);
  }
  lead.replaceChildren();
  // a new user's first view: the Get started card in the welcome's place,
  // in the panel as in the window
  const g = guideShown();
  lead.classList.toggle("guiding", !!g);
  if (g) {
    lead.hidden = false;
    lead.classList.remove("welcome");
    lead.append(guideCard(g));
    return;
  }
  const kinds = mode === "panel" ? [] : state.agents.map(connectKind);
  lead.hidden = !kinds.some((k) => k === "ok" || k === "empty");
  if (lead.hidden) return;
  const first = !state.agents.some((a) => a.wired);
  lead.classList.toggle("welcome", first);
  if (!first) {
    const [pre, post] = t("Switch an agent on and the models you set up in magpie show up as the {magpie} provider in its own model list; or pick its model right here.").split("{magpie}");
    lead.append(pre, el("b", "", intranet ? "Sub2Agent" : "magpie"), post || "");
    return;
  }
  lead.append(el("b", "ag-lead-h", t("Let your agents use the models you set up in magpie")));
  lead.append(el("p", "", t("Switch an agent on and your models show up as the magpie provider in its own model list, to change in the agent. Or pick a model right here: the agent is connected and starts on it. Switch it off and it goes back to how it was.")));
  if (!anyMagpieModels()) {
    const add = el("button", "text primary", t("Add a provider"));
    add.type = "button";
    add.onclick = () => addProviderFromAgents();
    lead.append(add);
  }
}
