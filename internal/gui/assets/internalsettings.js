// The internal distribution's complete settings surface. No upstream tab
// renderers run here: omitted controls cannot reappear through search/deep links.
const remoteBox = document.getElementById("remoteList");
let portValue = null, portError = "";
function action(label, run, disabled = false) {
  const b = el("button", "text", t(label));
  b.disabled = disabled;
  b.onclick = () => Promise.resolve(run(b)).catch(statusErr);
  return b;
}
function row(root, id, name, sub = "") {
  const r = el("section", "row pref"); r.dataset.setting = id;
  const who = el("div", "who");
  who.append(el("div", "name", t(name)), el("div", "sub say", sub));
  const val = el("div", "val"); r.append(who, val); root.append(r);
  return {r, val};
}
function pathTools(val, path, endpoint) {
  if (path) val.append(el("code", "settings-path", path), copyBtn(path, t("Path")));
  val.append(action("Open", () => api(endpoint, {}), web || !path));
}
function gateway(root, s) {
  const {val} = row(root, "gateway", "Gateway", s.gateway || "");
  const field = input(portValue ?? String(s.port || 8989), "8989");
  field.className = "words gateway-port"; field.inputMode = "numeric";
  field.setAttribute("aria-label", t("Gateway address"));
  field.disabled = !!s.addrEnv;
  const save = action("Apply", async b => {
    const port = Number(field.value.trim());
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      portError = t("A port is a number from 1024 to 65535"); return render(prefs);
    }
    b.disabled = true;
    try {
      const result = await writingPrefs(api("settings/port", {port}));
      if (result.settings) prefs = state.settings = result.settings;
      portValue = null; portError = result.port?.error || "";
      if (prefs.gateway) renderSideGw({...sideGwAt, url:prefs.gateway, running:!prefs.gatewayPaused});
      renderSettings();
      if (portError) status(portError, "err");
    } catch(e) { b.disabled = false; statusTErr(e); }
  }, !!s.addrEnv);
  field.oninput = () => { portValue = field.value; };
  field.onkeydown = e => { if(e.key === "Enter") { e.preventDefault(); save.click(); } };
  val.append(field, save, segs([["on",t("On")],["paused",t("Paused")]], s.gatewayPaused ? "paused" : "on", v => setGatewayPaused(v === "paused")));
  if (portError) val.append(el("div", "sub err", portError));
}
export function render(s) {
  if (!s) return;
  let root = document.getElementById("internalSettings");
  if (!root) {
    root = el("div", "list prefs internal-settings"); root.id = "internalSettings";
    document.getElementById("view-settings").append(root);
    const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "internalsettings.css";
    document.head.append(style);
  }
  for (const n of document.querySelectorAll("#view-settings > :not(#internalSettings)")) n.hidden = true;
  document.getElementById("view-settings").classList.remove("set-searching");
  root.replaceChildren(); prefsBase = prefsKeep(s);
  gateway(root, s);
  row(root,"login","Open at login").val.append(segs([[false,t("Off")],[true,t("On")]],!!s.login,on => prefWrite(api("settings/login",{on}))));
  row(root,"lightweight","Lightweight mode",t("A closed window frees about 100 MB after a minute; the gateway and tasks keep running, only the page reloads")).val.append(
    segs([[false,t("Off")],[true,t("On")]],s.lightweight === true,on => savePrefs({...prefsKeep(prefs),lightweight:on})));
  pathTools(row(root,"data","Data folder").val,s.dir,"settings/reveal");
  pathTools(row(root,"log","Log").val,s.log,"settings/log/reveal");
  renderCLI(row(root,"cli","Command line",t("Checking your shells…")).r);
  const remote = row(root,"remote","Connect to another sub2agent",web ? t("Available in the desktop app") : "");
  if (!web) { remote.r.append(remoteBox); renderRemote(false); }
  const uninstall = row(root,"uninstall","Uninstall magpie",web ? t("Available in the desktop app") : t("Disconnects every agent, putting back what each had, then removes magpie's service and files"));
  const remove = action("Uninstall…",b => uninstallMagpie(b),web); remove.classList.add("danger"); uninstall.val.append(remove);
  navSubs();
}
