"""Create the Sub2Agent Metabase questions and dashboard using its local API."""
import json
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:18897"


def provision(config):
    login = json.loads((config / "admin-login.json").read_text())
    path = config / "dashboard.json"
    state = json.loads(path.read_text()) if path.exists() else {}
    headers = {"Content-Type": "application/json"}

    def api(route, payload=None, method=None):
        args = None if payload is None else json.dumps(payload).encode()
        request = Request(BASE + "/api/" + route, data=args, headers=headers, method=method)
        try:
            with urlopen(request, timeout=55) as reply:
                raw = reply.read()
                return json.loads(raw) if raw else None
        except HTTPError as error:
            raise RuntimeError(f"{route}: HTTP {error.code}") from None

    headers["X-Metabase-Session"] = api("session", {"username": login["email"], "password": login["password"]})["id"]
    database = next(item for item in api("database")["data"] if item["name"] == "Sub2Agent 埋点")
    db_id = database["id"]
    tables = {}
    for _ in range(20):
        metadata = api(f"database/{db_id}/metadata")
        tables = {item["name"]: item for item in metadata["tables"]}
        required = {"user_daily_usage", "user_daily_activity", "user_growth", "installation_versions", "user_version_cohort"}
        if all(tables.get(name, {}).get("fields") for name in required):
            break
        time.sleep(2)
    usage = tables["user_daily_usage"]
    activity = tables["user_daily_activity"]
    growth = tables["user_growth"]
    installs = tables["installation_versions"]
    cohorts = tables["user_version_cohort"]

    def field(table, name, options=None):
        column = next(item for item in table["fields"] if item["name"] == name)
        return ["field", column["id"], options]

    def save(key, route, body):
        if key not in state:
            state[key] = api(route, body)["id"]
            path.write_text(json.dumps(state) + "\n")
        return state[key]

    collection = save("collection", "collection", {"name": "Sub2Agent 埋点分析", "color": "#168480"})

    def card(key, name, table, display, query, settings=None, description=None):
        return save(key, "card", {
            "name": name, "description": description, "collection_id": collection,
            "dataset_query": {"type": "query", "database": db_id, "query": {
                "source-table": table["id"], **query
            }},
            "display": display, "visualization_settings": settings or {},
        })

    usage_field = lambda name, options=None: field(usage, name, options)
    sums = [["sum", usage_field(name)] for name in
            ("requests", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens")]
    pivot = card("pivot", "用户 × 客户端版本 · 用量透视", usage, "pivot", {
        "aggregation": sums,
        "breakout": [usage_field("username"), usage_field("last_reported_version")],
    }, settings={"pivot_table.column_split": {
        "rows": ["username"], "columns": ["last_reported_version"],
        "values": ["sum", "sum_2", "sum_3", "sum_4", "sum_5", "sum_6"],
    }}, description="版本为安装在当天或之前最后一次上报的版本。")
    token_format = {
        "graph.label_value_formatting": "compact",
        "graph.y_axis.title_text": "Token",
    }
    trend = card("trend", "每日 Token 趋势", usage, "line", {
        "aggregation": [sums[-1]],
        "breakout": [usage_field("day", {"temporal-unit": "day"})],
    }, settings=token_format)
    detail = card("detail", "用户名 · 每日模型用量", usage, "table", {
        "order-by": [["desc", usage_field("day")], ["desc", usage_field("total_tokens")]],
    })
    versions = card("versions", "用户名 · 安装与版本记录", activity, "table", {
        "order-by": [["desc", field(activity, "last_seen")]],
    })
    activity_field = lambda name, options=None: field(activity, name, options)
    daily_users = card("daily_users", "应用日活 · 去重用户名", activity, "line", {
        "aggregation": [["distinct", activity_field("username")]],
        "breakout": [activity_field("day", {"temporal-unit": "day"})],
        "filter": ["and", [">", activity_field("app_events"), 0],
                   ["not-null", activity_field("username")]],
    }, description="每天有桌面事件上报的去重用户名。同一用户名的多台安装计一次。")
    online = card("online", "每日网关在线时长 · 设备小时", activity, "line", {
        "aggregation": [["sum", activity_field("online_hours")]],
        "breakout": [activity_field("day", {"temporal-unit": "day"})],
    }, description="来自网关时长增量上报。跨午夜按北京时间拆分，多台设备的时长相加。")
    user_online = card("user_online", "用户在线时长 · 按日和安装", activity, "table", {
        "filter": [">", activity_field("online_ms"), 0],
        "order-by": [["desc", activity_field("day")], ["desc", activity_field("online_ms")]],
    })
    user_totals = card("user_totals", "用户用量汇总", usage, "table", {
        "aggregation": sums,
        "breakout": [usage_field("username")],
        "order-by": [["desc", ["aggregation", 5]]],
    })
    breakdowns = []
    for key, title in (("model", "按模型统计"), ("provider", "按供应商统计"), ("agent", "按 Agent 统计")):
        breakdowns.append(card(key + "_totals", title, usage, "table", {
            "aggregation": sums,
            "breakout": [usage_field(key)],
            "order-by": [["desc", ["aggregation", 5]]],
        }))
    growth_day = field(growth, "day", {"temporal-unit": "day"})
    total_users = card("total_users", "累计用户总量", growth, "scalar", {
        "aggregation": [["max", field(growth, "total_users")]],
    }, description="从已导入的首批历史记录开始，累计出现过的去重用户名。")
    user_growth = card("user_growth", "累计用户量增长", growth, "line", {
        "aggregation": [["max", field(growth, "total_users")]], "breakout": [growth_day],
    }, description="从已导入记录的首日开始累计，早期首次出现记录持续保留。")
    new_users = card("new_users", "每日首次出现的用户", growth, "bar", {
        "aggregation": [["sum", field(growth, "new_users")]], "breakout": [growth_day],
    }, description="按已导入历史中首次观测到的日期统计。")
    version_cohort = card("version_cohort", "用户量 · 1.0.0 前后", cohorts, "table", {
        "aggregation": [["count"]], "breakout": [field(cohorts, "version_group")],
    }, description="每个用户名只计一次，按最近上报的版本分类。1.0.0 系列包含 beta。")
    upgrades = card("upgrades", "待升级名单 · 仍装有 1.0.0 以前版本", installs, "table", {
        "fields": [field(installs, name) for name in ("username", "client_version", "day", "installation")],
        "filter": ["=", field(installs, "version_group"), "1.0.0 系列以前"],
        "order-by": [["desc", field(installs, "day")], ["asc", field(installs, "username")]],
    }, description="按安装列出旧版。用户另一台设备即使已升级，旧版安装仍会列出。")
    filters = [
        ("date", "日期", "date/all-options", "day", "day"),
        ("username", "用户名", "string/=", "username", "username"),
        ("version", "版本", "string/=", "last_reported_version", "client_version"),
        ("provider", "供应商", "string/=", "provider", None),
        ("model", "模型", "string/=", "model", None),
        ("agent", "Agent", "string/=", "agent", None),
    ]
    params = [{"id": key, "name": label, "type": kind, "slug": key} for key, label, kind, _, _ in filters]
    dashboard = save("dashboard", "dashboard", {
        "name": "Sub2Agent 用户用量分析", "collection_id": collection, "parameters": params,
        "description": "按北京时间统计最近 90 天。用户名来自客户端操作系统，安装编号可区分重名或未上报的安装。",
    })
    if state.get("layout_version") != 4:
        for table in (usage, activity, growth, installs, cohorts):
            for column in table["fields"]:
                if column["name"] in {"day", "last_seen", "version_seen"}:
                    settings = column.get("settings") or {}
                    api(f'field/{column["id"]}', {"settings": {
                        **settings, "date_style": "YYYY/M/D",
                        "date_separator": "-", "time_enabled": None,
                    }}, "PUT")
        trend_settings = api(f"card/{trend}")["visualization_settings"]
        api(f"card/{trend}", {"visualization_settings": {**trend_settings, **token_format}}, "PUT")
        api(f"dashboard/{dashboard}", {"parameters": params}, "PUT")
        cards = []
        current = api(f"dashboard/{dashboard}")
        existing = {dashcard["card_id"]: dashcard["id"] for dashcard in current["dashcards"]}
        for i, (card_id, table, col, row, width, height) in enumerate([
            (total_users, growth, 0, 0, 6, 6), (user_growth, growth, 6, 0, 18, 6),
            (new_users, growth, 0, 6, 12, 6), (daily_users, activity, 12, 6, 12, 6),
            (online, activity, 0, 12, 12, 6), (trend, usage, 12, 12, 12, 6),
            (version_cohort, cohorts, 0, 18, 8, 7), (upgrades, installs, 8, 18, 16, 7),
            (user_totals, usage, 0, 25, 24, 6),
            (pivot, usage, 0, 31, 24, 8), (detail, usage, 0, 39, 24, 8),
            (user_online, activity, 0, 47, 24, 7), (versions, activity, 0, 54, 24, 7),
            (breakdowns[0], usage, 0, 61, 24, 7), (breakdowns[1], usage, 0, 68, 24, 7),
            (breakdowns[2], usage, 0, 75, 24, 7),
        ]):
            mappings = []
            for key, _, _, usage_col, activity_col in filters:
                if table is usage:
                    column = usage_col
                elif table is activity:
                    column = activity_col
                elif table is growth:
                    column = "day" if key == "date" else None
                elif table is installs:
                    column = {"date": "day", "username": "username"}.get(key)
                else:
                    column = "username" if key == "username" else None
                if column:
                    mappings.append({"parameter_id": key, "card_id": card_id,
                                     "target": ["dimension", field(table, column)]})
            cards.append({"id": existing.get(card_id, -i-1), "card_id": card_id, "col": col, "row": row,
                          "size_x": width, "size_y": height, "parameter_mappings": mappings})
        api(f"dashboard/{dashboard}/cards", {"cards": cards}, "PUT")
        state["layout_version"] = 4
        path.write_text(json.dumps(state) + "\n")
    result = api(f"dashboard/{dashboard}")
    assert len(result["dashcards"]) == 16
    print(f"dashboard /dashboard/{dashboard}")


if __name__ == "__main__":
    provision(Path(sys.argv[1]))
