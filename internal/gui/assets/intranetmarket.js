export function intranetMarket({status: s, loading: marketLoading, listings, query, retryConnection, manual, section, summary}) {
    const box = el("section", "pm-connection");
    box.setAttribute("aria-live", "polite");
    const heading = el("div", "pm-connection-head");
    const title = !s ? "Connecting to the plugin server…" : s.state === "online" ? "Intranet plugin marketplace" : s.state === "cached" ? "Server unavailable · showing saved plugins" : "Cannot connect to the plugin server";
    heading.append(el("h2", "", t(title)));
    const retry = el("button", "text", t(marketLoading ? "Connecting…" : "Retry connection"));
    retry.type = "button";
    retry.disabled = marketLoading;
    retry.onclick = retryConnection;
    heading.append(retry);
    box.append(heading);
    if (s && s.state !== "online") {
      const reasons = {
        timeout: "Connection timed out. The server did not respond within 6 seconds. Check your intranet or VPN connection, then retry.",
        refused: "The server refused the connection. Ask the administrator to check the plugin service and port 18989.",
        dns: "The server address could not be resolved. Check your network configuration, then retry.",
        http: s.httpStatus === 404 ? "The server is reachable, but the plugin directory is missing (HTTP 404). Ask the administrator to deploy the marketplace." : "The server returned HTTP {code}. Retry later or ask the administrator to check the plugin service.",
        invalid: "The server returned an invalid plugin directory. Ask the administrator to check registry.json.",
        client: "The app service did not answer. Check whether Sub2Agent is running, then retry.",
      };
      box.append(el("p", "", t(reasons[s.reason] || "The plugin server could not be reached. Check your intranet or VPN connection, then retry.", { code: s.httpStatus })));
      box.append(el("p", "pm-note", t("Installed plugins remain available. You can also import a complete plugin folder offline.")));
    } else if (s && !listings?.length) {
      box.append(el("p", "", t("Connected. No plugins have been published yet.")));
    }
    if (s?.updatedAt) box.append(el("p", "pm-note", t("Directory saved: {time}", { time: new Date(s.updatedAt).toLocaleString(intlLang()) })));
    const out = [box];
    const f = query.trim().toLowerCase();
    const found = (listings || []).filter((l) => !f || [l.name, l.package, summary(l)].join(" ").toLowerCase().includes(f));
    if (found.length) out.push(section(t("Plugins"), "", found));
    else if (f && listings?.length) out.push(el("p", "pm-empty", t("No plugin matches")));
    out.push(manual());
    return out;
  }

