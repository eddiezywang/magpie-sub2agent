// clitick ticks the seconds an agent's CLI update has been running in the
// busy pill ("Updating… 12s"), so a long install reads as under way, not
// stuck; past a minute it adds that installs can take a few minutes.
// paintCLIButton (app.js) starts it when a pill goes busy and stops it when
// none is; a busy pill painted elsewhere (the Update all bar's) ticks too,
// from when this first saw it.
let cliTickTimer = null;
const cliTickPaint = () => {
  let any = false;
  for (const b of document.querySelectorAll(".ag-up.busy")) {
    any = true;
    if (!b.dataset.tickAt) b.dataset.tickAt = Date.now();
    const s = Math.round((Date.now() - +b.dataset.tickAt) / 1000);
    if (s < 1) continue; // the plain "Updating…" stands for the first second
    b.lastChild.textContent = t("Updating… {n}s", { n: s })
      + (s >= 60 ? " · " + t("installs can take a few minutes") : "");
  }
  if (!any) { clearInterval(cliTickTimer); cliTickTimer = null; }
};
window.cliTickStart = (b) => {
  b.dataset.tickAt = Date.now();
  if (!cliTickTimer) cliTickTimer = setInterval(cliTickPaint, 1000);
};
window.cliTickStop = () => {
  if (cliTickTimer && !document.querySelector(".ag-up.busy")) { clearInterval(cliTickTimer); cliTickTimer = null; }
};
