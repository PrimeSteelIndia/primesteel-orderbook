"""The real routes the UI uses, on one keep-alive connection each.

Regression test for the socket bug that made deletes look like no-ops:
bytes left unread in the socket were parsed as the start of the next request.
"""
import http.client, json

HOST, PORT = "127.0.0.1", 8077

def call(c, method, path, body):
    headers, payload = {}, None
    if body is not None:
        payload = json.dumps(body)
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = str(len(payload))
    c.request(method, path, body=payload, headers=headers)
    r = c.getresponse()
    raw = r.read()
    return r.status, raw

def run(label, steps):
    c = http.client.HTTPConnection(HOST, PORT, timeout=15)
    out = []
    for method, path, body in steps:
        status, raw = call(c, method, path, body)
        snippet = raw[:70].decode("utf-8", "replace").replace("\n", " ")
        out.append((method, path, status, snippet))
    c.close()
    ok = all(s < 400 for _, _, s, _ in out)
    print(f"{'PASS' if ok else 'FAIL'}  {label}")
    for m, p, s, sn in out:
        print(f"       {s}  {m:6} {p:32} {sn}")
    print()
    return ok

# --- create a throwaway customer through the API so the delete is real
c = http.client.HTTPConnection(HOST, PORT, timeout=15)
s, raw = call(c, "POST", "/api/customers", {"name": "KA DELETE ME", "phone": ""})
cid = json.loads(raw)["customer"]["id"]
c.close()
print(f"created throwaway customer id={cid}\n")

results = []

results.append(run("add item then refresh (showed ERR_INVALID_HTTP_RESPONSE)", [
    ("GET", "/api/items?all=1", None),
    ("POST", "/api/items", {"name": "KA TEST A", "rate": 10, "weight_per_pc": 1}),
    ("GET", "/api/items?all=1", None),
]))

results.append(run("delete customer via the route the UI uses", [
    ("GET", "/api/customers?all=1", None),
    ("POST", f"/api/customers/{cid}/delete", {}),
    ("GET", "/api/customers?all=1", None),
]))

results.append(run("GET carrying a body (unusual but legal)", [
    ("GET", "/api/items?all=1", {"probe": 1}),
    ("GET", "/api/items?all=1", None),
]))

results.append(run("mixed verbs on one connection", [
    ("GET", "/api/bootstrap", None),
    ("POST", "/api/items", {"name": "KA TEST B", "rate": 11, "weight_per_pc": 2}),
    ("POST", "/api/items", {"name": "KA TEST C", "rate": 12, "weight_per_pc": 3}),
    ("GET", "/api/items?all=1", None),
    ("GET", "/api/bootstrap", None),
]))

print("ALL PASS" if all(results) else "SOME FAILED")

# --- cleanup
import sqlite3
con = sqlite3.connect("data/prime.db")
con.execute("delete from items where name like 'KA TEST %'")
con.execute("delete from customers where name = 'KA DELETE ME'")
con.commit()
print("cleaned up test rows")