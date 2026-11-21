"""Create an order through the real UI and check what the server stores.

Proves whether the estimate fix is live end-to-end (phone -> POST -> DB),
rather than inferring from the client-side helper alone.
"""
import asyncio, json, sqlite3
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 430, "height": 900}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE + "/", wait_until="networkidle")

        # Pick a pcs item whose rate is /kg: that is the bug signature.
        info = await pg.evaluate("""async () => {
            const r = await (await fetch('/api/items')).json();
            const items = r.items || r;
            const it = items.find(i => i.active && i.main_unit === 'pcs' && i.weight_per_pc > 0 && i.rate > 0);
            return { id: it.id, name: it.name, rate: it.rate, wpc: it.weight_per_pc };
        }""")
        print(f"[item] {info['name']}  rate={info['rate']}/kg  wt/pc={info['wpc']}kg")

        QTY = 5
        expect_weight = round(info["wpc"] * QTY, 3)
        expect_amount = round(expect_weight * info["rate"], 2)
        print(f"[expect] {QTY} pcs -> {expect_weight} kg x {info['rate']} = Rs {expect_amount}")

        got = await pg.evaluate("""async (a) => {
            const r = await fetch('/api/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer_name: 'ZZ CALC CHECK',
                    customer_phone: '9000000000',
                    worker: 'calc-check',
                    note: 'automated calc verification',
                    lines: [{ item_id: a.id, entry_qty: a.qty, entry_unit: 'pcs' }],
                }),
            });
            return { status: r.status, body: await r.json() };
        }""", {"id": info["id"], "qty": QTY})
        print(f"[post] status={got['status']}")

        body = got["body"]
        ob = body.get("order", body)
        no = ob.get("order_no")
        print(f"[stored] {no} est_weight={ob.get('est_weight')} est_amount={ob.get('est_amount')}")

        c = sqlite3.connect("data/prime.db"); c.row_factory = sqlite3.Row
        row = c.execute("SELECT id, order_no, est_weight, est_amount FROM orders WHERE order_no=?", (no,)).fetchone()
        line = c.execute("SELECT pcs, weight_per_pc, rate, entry_qty, entry_unit FROM order_lines WHERE order_id=?", (row["id"],)).fetchone()

        print(f"[db] est_weight={row['est_weight']}  est_amount={row['est_amount']}")
        print(f"[db] line pcs={line['pcs']} wt/pc={line['weight_per_pc']} rate={line['rate']} entry={line['entry_qty']}{line['entry_unit']}")

        ok_w = abs(row["est_weight"] - expect_weight) < 0.01
        ok_a = abs(row["est_amount"] - expect_amount) < 0.01
        print(f"[verdict] weight ok={ok_w}  amount ok={ok_a}")

        # clean up the probe order so it never reaches the real books
        await pg.evaluate("(id) => fetch('/api/orders/' + id, { method: 'DELETE' })", row["id"])
        still = c.execute("SELECT COUNT(*) c FROM orders WHERE order_no=?", (no,)).fetchone()["c"]
        print(f"[cleanup] probe order removed={still == 0}")
        print("[errors]", errs if errs else "none")
        await b.close()

asyncio.run(main())