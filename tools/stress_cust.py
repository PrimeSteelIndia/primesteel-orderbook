"""Stress the customer delete path and identify the stray 501 request."""
import asyncio, json, sqlite3
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

async def main():
    con = sqlite3.connect("data/prime.db")
    con.row_factory = sqlite3.Row

    total = con.execute("SELECT COUNT(*) c FROM customers").fetchone()["c"]
    print(f"customers in DB: {total}")

    # a customer that actually has orders - the risky case
    withorders = con.execute("""
        SELECT c.id, c.name, (SELECT COUNT(*) FROM orders o WHERE o.customer_name=c.name) n
        FROM customers c
        WHERE n > 0 LIMIT 3
    """).fetchall()
    print("customers with orders:", [(r["id"], r["name"], r["n"]) for r in withorders])

    # throwaways
    ids = []
    for i in range(3):
        con.execute("INSERT INTO customers (name,norm,phone,gstin,updated_at,address) VALUES (?,?,?,'','0','')",
                    (f"ZZ STRESS {i}", f"ZZ STRESS {i}", "9999900000"))
        ids.append(con.execute("SELECT last_insert_rowid()").fetchone()[0])
    con.commit()
    print("throwaway ids:", ids)

    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1400, "height": 900})
        pg = await ctx.new_page()

        bad, errs = [], []
        pg.on("response", lambda r: bad.append(f"{r.status} {r.request.method} {r.url.replace(BASE,'')}")
              if r.status >= 400 else None)
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        await pg.goto(BASE + "/admin.html", wait_until="networkidle")
        await pg.click('.admin-nav button[data-tab="customers"]')
        await pg.wait_for_timeout(1800)

        async def find_row(name):
            return await pg.evaluate("""(n) => {
                const c = A.customers.find(x => x.name === n);
                return c ? c.id : null;
            }""", name)

        # ---- delete each throwaway via the real button ----
        for tid in ids:
            row = await pg.query_selector(f'[data-del-cust="{tid}"]')
            if not row:
                print(f"  id {tid}: NOT in list (beyond 200 cap)")
                continue
            await row.click()
            await pg.wait_for_timeout(1200)
            left = con.execute("SELECT COUNT(*) c FROM customers WHERE id=?", (tid,)).fetchone()["c"]
            print(f"  id {tid}: deleted={left == 0}")

        # ---- delete a customer that has orders ----
        if withorders:
            r = withorders[0]
            row = await pg.query_selector(f'[data-del-cust="{r["id"]}"]')
            print(f"  with-orders id {r['id']} ({r['name']}): button={bool(row)}")
            if row:
                await row.click()
                await pg.wait_for_timeout(1500)
                left = con.execute("SELECT COUNT(*) c FROM customers WHERE id=?", (r["id"],)).fetchone()["c"]
                print(f"    deleted={left == 0}")

        # ---- search then delete (the q-param path) ----
        s = await pg.query_selector("#customerSearch")
        if s:
            await s.fill("ZZ")
            await pg.wait_for_timeout(900)
            after = await pg.evaluate("() => A.customers.length")
            print(f"  after search 'ZZ': A.customers.length={after}")

        print(f"\n[HTTP >=400] {bad if bad else 'none'}")
        print(f"[errors] {errs if errs else 'none'}")
        ct = await pg.evaluate("() => { const e = document.querySelector('#customersCount'); return e ? e.textContent : null; }")
        print("[count text] " + repr(ct))
        await b.close()

    left = con.execute("SELECT COUNT(*) c FROM customers WHERE name LIKE 'ZZ%'").fetchone()["c"]
    print(f"[leftover ZZ customers] {left}")
    con.close()

asyncio.run(main())