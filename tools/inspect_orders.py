import sqlite3

con = sqlite3.connect(r'C:\Users\Prime Steel\Desktop\PrimeSteel\data\prime.db')
con.row_factory = sqlite3.Row
cur = con.cursor()
o = cur.execute("SELECT * FROM orders WHERE order_no='PS-2026-0040'").fetchone()
print("ORDER:", dict(o))
lines = cur.execute("SELECT * FROM order_lines WHERE order_id=?", (o["id"],)).fetchall()
for l in lines:
    print("LINE:", dict(l))
con.close()
