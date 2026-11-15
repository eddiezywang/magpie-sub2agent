// One read-only configuration snapshot per visit. No polling or vendor calls.
let active = false, generation = 0, snapshot = null;
const visible = () => !document.getElementById("view-agents")?.hidden;
export function leave() { active = false; snapshot = null; generation++; }
export async function refresh() { leave(); await enter(); return t("Agents looked for again"); }
function draw() {
  if (!snapshot || !visible()) return;
  for (const row of document.querySelectorAll("#agents .agent[data-id]")) {
    row.querySelector(".connection-check")?.remove();
    const check = snapshot[row.dataset.id];
    if (!check) continue;
    const box = document.createElement("div");
    box.className = "sub connection-check";
    box.title = check.path;
    box.textContent = t(check.status === "configured" ? "Configured for sub2agent" : check.status === "unknown" ? "Could not read connection configuration" : "Not configured for sub2agent");
    if (check.status !== "unknown" && !check.managed) {
      const button = document.createElement("button");
      button.className = "text action";
      button.textContent = t(check.status === "configured" ? "Adapt existing connection" : "Connect to sub2agent");
      button.onclick = async (event) => {
        event.stopPropagation(); button.disabled = true;
        try {
          state = await api("agents/connect/" + encodeURIComponent(row.dataset.id), {});
          leave(); renderAgents();
        } catch (err) { statusErr(err); button.disabled = false; }
      };
      box.append(" · ", button);
    }
    row.querySelector(".who")?.append(box);
  }
}
export async function enter() {
  if (!visible()) return;
  if (active) { draw(); return; }
  active = true;
  const visit = generation;
  try {
    const next = await api("agents/connections");
    if (visit !== generation || !visible()) return;
    snapshot = next.checks;
    const previous = new Map((state.agents || []).map(a => [a.id, a]));
    state.agents = next.agents.map(a => ({ ...previous.get(a.id), ...a }));
    renderAgents(); draw();
  } catch (err) { if (visit === generation && visible()) statusErr(err); }
}
