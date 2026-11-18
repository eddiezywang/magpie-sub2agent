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
        if {"user_daily_usage", "user_daily_activity"} <= tables.keys():
            break
        time.sleep(2)
    usage = tables["user_daily_usage"]
    activity = tables["user_daily_activity"]

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
    trend = card("trend", "每日 Token 趋势", usage, "line", {
        "aggregation": [sums[-1]],
        "breakout": [usage_field("day", {"temporal-unit": "day"})],
    })
    detail = card("detail", "用户名 · 每日模型用量", usage, "table", {
        "order-by": [["desc", usage_field("day")], ["desc", usage_field("total_tokens")]],
    })
    versions = card("versions", "用户名 · 安装与版本记录", activity, "table", {
        "order-by": [["desc", field(activity, "last_seen")]],
    })
    filters = [
        ("date", "日期", "date/all-options", "day", "day"),
        ("username", "用户名", "string/=", "username", "username"),
        ("version", "版本", "string/=", "last_reported_version", "client_version"),
        ("provider", "供应商", "string/=", "provider", None),
        ("model", "模型", "string/=", "model", None),
    ]
    params = [{"id": key, "name": label, "type": kind, "slug": key} for key, label, kind, _, _ in filters]
    dashboard = save("dashboard", "dashboard", {
        "name": "Sub2Agent 用户用量分析", "collection_id": collection, "parameters": params,
        "description": "按北京时间统计最近 90 天。用户名来自客户端操作系统，安装编号可区分重名或未上报的安装。",
    })
    if not state.get("configured"):
        cards = []
        for i, (card_id, table, row, height) in enumerate([
            (trend, usage, 0, 5), (pivot, usage, 5, 8), (detail, usage, 13, 8),
            (versions, activity, 21, 8),
        ]):
            mappings = []
            for key, _, _, usage_col, activity_col in filters:
                column = usage_col if table is usage else activity_col
                if column:
                    mappings.append({"parameter_id": key, "card_id": card_id,
                                     "target": ["dimension", field(table, column)]})
            cards.append({"id": -i-1, "card_id": card_id, "col": 0, "row": row,
                          "size_x": 24, "size_y": height, "parameter_mappings": mappings})
        api(f"dashboard/{dashboard}/cards", {"cards": cards}, "PUT")
        state["configured"] = True
        path.write_text(json.dumps(state) + "\n")
    result = api(f"dashboard/{dashboard}")
    assert len(result["dashcards"]) == 4
    print(f"dashboard /dashboard/{dashboard}")


if __name__ == "__main__":
    provision(Path(sys.argv[1]))
