"""End-to-end smoke test against a running server.

    py -3.13 tools/smoke_test.py
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8077"
ROOT = Path(__file__).resolve().parent.parent
failures: list[str] = []


def call(method: str, path: str, payload: dict | None = None, raw: bool = False):
    data = None
    headers = {"X-Admin-Pin": "Prime2026"}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            body = res.read()
            return res.status, (body if raw else json.loads(body or b"{}")), res.headers
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}"), exc.headers


def check(label: str, cond: bool, detail: str = ""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        failures.append(label)


def main() -> None:
    print("\nPrime Steel smoke test\n")

    status, boot, _ = call("GET", "/api/bootstrap")
    check("bootstrap loads", status == 200 and boot.get("items"))
    check("has categories", len(boot.get("categories", [])) > 0, str(boot.get("categories")))
    items = boot["items"]
    usable = [i for i in items if i["weight_per_pc"] > 0]
    check("items with weight available", len(usable) >= 2, str(len(usable)))

    # --- create an order ------------------------------------------------
    a, b = usable[0], usable[1]
    cid = f"smoke-test-{int(time.time()*1000)}"
    payload = {
        "client_id": cid,
        "customer_name": "Smoke Test Customer",
        "customer_phone": "9999999999",
        "worker": "Tester",
        "note": "smoke test",
        "lines": [{"item_id": a["id"], "pcs": 3}, {"item_id": b["id"], "pcs": 2}],
    }
    status, res, _ = call("POST", "/api/orders", payload)
    check("order created", status == 200 and res.get("order"), str(res)[:200])
    order = res["order"]
    check("order number format", order["order_no"].startswith("PS-"), order["order_no"])
    check("3 + 2 pieces", order["pcs"] == 5, str(order["pcs"]))
    expected_w = round(3 * a["weight_per_pc"] + 2 * b["weight_per_pc"], 3)
    check("estimated weight", abs(order["est_weight"] - expected_w) < 0.01,
          f"{order['est_weight']} vs {expected_w}")
    expected_a = round(3 * a["weight_per_pc"] * a["rate"] + 2 * b["weight_per_pc"] * b["rate"], 2)
    check("estimated amount", abs(order["est_amount"] - expected_a) < 0.05,
          f"{order['est_amount']} vs {expected_a}")
    check("status OPEN", order["status"] == "OPEN")
    check("lines snapshotted", len(order["lines_detail"]) == 2)

    # idempotency
    status, res2, _ = call("POST", "/api/orders", payload)
    check("same client_id does not duplicate",
          status == 200 and res2["order"]["id"] == order["id"])

    # --- weights --------------------------------------------------------
    lines = order["lines_detail"]
    weights = {lines[0]["id"]: round(lines[0]["est_weight"] + 1.5, 3),
               lines[1]["id"]: lines[1]["est_weight"]}
    status, res, _ = call("POST", f"/api/orders/{order['id']}/weight", {"weights": weights})
    check("weights submitted", status == 200 and res["order"]["status"] == "WEIGHED", str(res)[:200])
    wo = res["order"]
    expected_amt = round(weights[lines[0]["id"]] * lines[0]["rate"] +
                         weights[lines[1]["id"]] * lines[1]["rate"], 2)
    check("actual amount", abs(wo["actual_amount"] - expected_amt) < 0.05,
          f"{wo['actual_amount']} vs {expected_amt}")
    check("actual weight", abs(wo["actual_weight"] - sum(weights.values())) < 0.01)
    check("rejects missing weight", call("POST", f"/api/orders/{order['id']}/weight",
                                         {"weights": {lines[0]["id"]: 1}})[0] == 400)

    # --- exports --------------------------------------------------------
    status, blob, headers = call("GET", f"/api/export/order/{order['id']}", raw=True)
    ctype = headers.get("Content-Type", "")
    check("order export downloads", status == 200 and len(blob) > 3000, f"{status} {len(blob)} {ctype}")
    if "spreadsheet" in ctype:
        import openpyxl
        import io
        wb = openpyxl.load_workbook(io.BytesIO(blob))
        ws = wb["ESTIMATE"]
        values = [ws.cell(r, 2).value for r in range(1, ws.max_row + 1)]
        check("xlsx has item names", a["name"] in values, str(values[:14]))
        check("xlsx has totals row", any(ws.cell(r, 1).value == "TOTAL" for r in range(1, 30)))
    else:
        print("        (openpyxl missing, CSV fallback used)")

    status, blob, _ = call("GET", "/api/export/ready", raw=True)
    check("master export downloads", status == 200 and len(blob) > 2000)

    # --- auto export to disk -------------------------------------------
    files = list((ROOT / "exports").glob("*"))
    check("weighed order auto-written to exports/", len(files) >= 1, str(files))

    # --- bulk items -----------------------------------------------------
    status, res, _ = call("POST", "/api/items/bulk", {"rows": [
        {"name": a["name"], "rate": a["rate"] + 1.0, "weight": a["weight_per_pc"]},
        {"name": "SMOKE TEST ITEM", "rate": 100, "weight": 10},
        {"name": "SMOKE TEST ITEM", "rate": 100, "weight": 10},
    ]})
    check("bulk update runs", status == 200 and res.get("updated") == 1 and res.get("created") == 1, str(res)[:200])

    # restore the rate, remove the test item
    items2 = call("GET", "/api/items")[1]["items"]
    restored = next(i for i in items2 if i["name"] == a["name"])
    check("bulk rate applied", abs(restored["rate"] - (a["rate"] + 1)) < 0.01, str(restored["rate"]))
    call("POST", f"/api/items/{restored['id']}/update", {"rate": a["rate"]})
    ghost = next(i for i in items2 if i["name"] == "SMOKE TEST ITEM")
    call("POST", f"/api/items/{ghost['id']}/delete", {})

    # --- security & privacy checks -------------------------------------
    # 1. Unauthenticated GET /api/orders must be blocked (401)
    req_no_auth = urllib.request.Request(BASE + "/api/orders")
    try:
        urllib.request.urlopen(req_no_auth, timeout=5)
        check("unauth orders blocked", False, "Expected 401 but got 200")
    except urllib.error.HTTPError as e:
        check("unauth orders blocked", e.code == 401, f"HTTP {e.code}")

    # 2. Unauthenticated GET /api/customers must be blocked (401)
    req_no_auth_cust = urllib.request.Request(BASE + "/api/customers")
    try:
        urllib.request.urlopen(req_no_auth_cust, timeout=5)
        check("unauth customers blocked", False, "Expected 401 but got 200")
    except urllib.error.HTTPError as e:
        check("unauth customers blocked", e.code == 401, f"HTTP {e.code}")

    # 3. Customer order lookup by phone works without auth
    status, cust_orders, _ = call("GET", f"/api/customer/orders?phone={order['customer_phone']}")
    check("customer phone lookup works", status == 200 and len(cust_orders.get("orders", [])) >= 1)

    # 4. Anti-bot honeypot rejects automated submissions
    bot_payload = {
        "customer_name": "Bot Tester",
        "customer_phone": "9876543210",
        "company_website_url": "http://spambot.com",
        "lines": [{"item_id": a["id"], "pcs": 1}],
    }
    status, bot_res, _ = call("POST", "/api/orders", bot_payload)
    check("bot honeypot rejects", status == 400)

    # 5. Worker PIN check
    status, w_res, _ = call("POST", "/api/pin/worker/check", {"pin": "1234"})
    check("worker pin check", status == 200 and w_res.get("ok") is True)

    # --- cleanup --------------------------------------------------------
    status, _, _ = call("POST", f"/api/orders/{order['id']}/delete", {})
    check("test order removed", status == 200)
    # Only remove the file this test produced - never the owner's exports.
    for f in (ROOT / "exports").glob(order["order_no"] + "*"):
        f.unlink()

    # --- customer search ------------------------------------------------
    status, res, _ = call("GET", "/api/customers?q=enterprise")
    check("customer search works", status == 200 and res.get("customers"), str(res)[:120])

    print()
    if failures:
        print(f"{len(failures)} FAILED: {failures}")
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
