"""Find out why the customer delete button does nothing.

Accepts the confirm() dialog so the dialog itself is not the cause, then watches
for network calls and toasts.
"""
import asyncio, json, sqlite3
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

async def main():
    # a throwaway customer to click on
    c = sqlite3.connect("data/prime.db")
    c.execute("INSERT INTO customers (name,norm,phone,gstin,updated_at,address) "
              "VALUES ('ZZ DELETE ME','ZZ DELETE ME','9999900001','','0','')")
    c.commit()
    cid = c.execute("SELECT id FROM customers WHERE name='ZZ DELETE ME'").fetchone()[0]
    print(f"test customer id={cid}")

    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1400, "height": 900})
        pg = await ctx.new_page()

        calls, errs = [], []
        pg.on("request", lambda r: calls.append(f"{r.method} {r.url.replace(BASE,'')}") if "/api/" in r.url else None)
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        await pg.goto(BASE + "/admin.html", wait_until="networkidle")
        print(f"[loaded] title={await pg.title()}")

        # if there is a login gate, report it rather than guessing a password
        gate = await pg.evaluate("""() => {
            const pw = document.querySelector('input[type=password]');
            return { loginVisible: !!pw, bodyStart: document.body.innerText.slice(0, 160) };
        }""")
        print(f"[gate] {json.dumps(gate)[:300]}")
        if gate["loginVisible"]:
            print("STOP: admin login required, cannot test delete without credentials")
            await b.close()
            return

        await pg.click('.admin-nav button[data-tab="customers"]')
        await pg.wait_for_timeout(2000)

        info = await pg.evaluate("""() => ({
            tab: typeof A !== 'undefined' ? A.tab : null,
            loaded: typeof A !== 'undefined' ? A.customers.length : null,
            rows: document.querySelectorAll('#customersTable tbody tr').length,
            delButtons: document.querySelectorAll('[data-del-cust]').length,
            countText: (document.querySelector('#customersCount') || {}).textContent,
            subText: (document.querySelector('#customersSub') || {}).textContent,
        })""")
        print(f"[customers tab] {json.dumps(info)}")

        # find the delete button for our test customer
        # our new row is not in the first 200; use the last visible row instead
        visible = await pg.evaluate("() => A.customers.slice(-1)[0]")
        cid = visible["id"]
        print(f"[using] last visible customer id={cid} name={visible['name']!r}")
        target = await pg.query_selector(f'[data-del-cust="{cid}"]')
        print(f"[button for id {cid}] found={bool(target)}")

        if not target:
            # is the row even in the first page of 200?
            present = await pg.evaluate("(id) => A.customers.some(c => c.id === id)", cid)
            print(f"[in A.customers] {present}")
            await b.close()
            return

        calls.clear()
        await target.click()
        await pg.wait_for_timeout(2500)

        print(f"[api calls] {calls}")
        toast = await pg.evaluate("""() => {
            const t = document.querySelector('.toast, #toast, .toast-host');
            return t ? t.innerText : null;
        }""")
        print(f"[toast] {toast!r}")

        still = c.execute("SELECT COUNT(*) FROM customers WHERE id=?", (cid,)).fetchone()[0]
        print(f"[db] row still present: {still}")
        print(f"[errors] {errs if errs else 'none'}")

        if still:
            c.execute("DELETE FROM customers WHERE id=?", (cid,)); c.commit()
        await b.close()

asyncio.run(main())