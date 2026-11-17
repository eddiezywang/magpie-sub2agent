// openRowMenu: a small menu of acts under anchor, the one an agent row's
// right-click opens, and a model chip's
function openRowMenu(anchor, acts, at, onClose, followScroll = false) {
  const box = el("div", "pop row-menu");
  box.setAttribute("role", "menu");
  const items = [];
  for (const o of acts) {
    if (o.sep) box.append(el("div", "rm-sep"));
    const b = el("button", "rm-item");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.disabled = !!o.off;
    // a plugin's item (magpie.actions) is named in its own words
    b.append(svg(o.icon, 13, 1.5), el("span", "rm-name", o.literal ? o.name : t(o.name)));
    if (o.key) b.append(el("span", "rm-key", o.key));
    if (o.tip) b.title = o.tip;
    // an item that is off can say why, under its name and as its title
    if (o.why) { b.classList.add("has-why"); b.title = o.why; b.querySelector(".rm-name").append(el("span", "rm-why", o.why)); }
    // the click goes along, so an item that opens something below can
    // bring it into view (scrollOnPurpose)
    b.onclick = (e) => { e.stopPropagation(); closeAgentMenu(); o.run(e); };
    hoverFocus(b);
    box.append(b);
    if (!o.off) items.push(b);
  }
  document.body.append(box);
  placeMenu(box, anchor, "left", -4, at);
  anchor.classList.add("open");
  if (anchor.hasAttribute("aria-expanded")) anchor.setAttribute("aria-expanded", "true");
  const outside = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) closeAgentMenu(); };
  // a long menu scrolls inside itself; only a scroll outside it closes it
  const scroll = (e) => {
    if (!scrollCloses(box, e)) return;
    if (!followScroll || !anchor.isConnected) return closeAgentMenu();
    const r = anchor.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight) return closeAgentMenu();
    box.style.maxHeight = ""; box.classList.remove("up");
    placeMenu(box, anchor, "left", -4);
  };
  const keys = (e) => {
    const k = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAgentMenu(); anchor.focus(NO_SCROLL); }
    else if (e.key === "Tab") closeAgentMenu();
    else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && items.length) {
      stepFocus(e, items, k);
    }
  };
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("keydown", keys, true);
  document.addEventListener("scroll", scroll, true);
  addEventListener("resize", closeAgentMenu);
  agentMenu = { box, anchor, outside, keys, scroll, onClose };
  items[0]?.focus(NO_SCROLL);
}

