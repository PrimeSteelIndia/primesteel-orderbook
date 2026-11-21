# Prime Steel — Order Book

One small server on the office PC holds every order. Phones take orders.
The office PC and the Mac both open that same server in a browser, so they
always see the same list — nothing to sync.

- **Office PC** — `http://localhost:8077/admin`
- **Phone (same Wi-Fi)** — `http://192.168.0.247:8077`
- **Mac (same Wi-Fi)** — open `http://192.168.0.247:8077` in Safari

If the address ever changes, the office **Settings** page shows the current one.

---

## 1. Starting the day

1. Double-click **`Start Prime Steel.bat`** on the office PC.
2. A black window opens and the office page opens in the browser.
   **Leave the black window open** — closing it stops the phones.
3. On each phone, open the phone address once and choose
   **Add to Home screen**. From then on it is an icon like any app.

First time only: right-click **`Allow phones on Wi-Fi.bat`** → *Run as
administrator*. That opens port 8077 in Windows Firewall. Windows may also
pop up a firewall question the first time — click **Allow**.

To stop, close the black window (or press `Ctrl+C` in it).

---

## 2. Taking an order on a phone

1. Tap the item. A phone-sized card grid with a search box — type `202` or
   `20G` if the list is long.
2. Choose pieces (stepper, or 5 / 10 / 25 / 50). The weight and amount show
   immediately from the recorded kg per piece and rate per kg.
3. **Add to order**, then **Review**.
4. Pick the customer (search by name or phone), type your name under
   *Taken by*, add a note if needed, and **Save order**.

The estimate goes to the office straight away. No Wi-Fi at that moment?
The order waits on the phone and sends itself when the signal returns.

### Weighing later

Material arrives → **Orders** tab → tap the waiting order → type the reading
from the scale for each line (or tap **Use est.** when it matches) →
**Submit weight**.

Once submitted, the order cannot be changed from the phone. The office can
reopen it if something was typed wrong.

---

## 3. In the office

`http://localhost:8077/admin` — three tabs.

**Orders**
- Every order, newest first. *To weigh* / *Ready* filters, search, date range.
- Click a row to open it: pieces, estimate, actual weight, difference.
- **Excel file** downloads that order as a workbook laid out like your
  ESTIMATE sheet.
- **Copy rows** copies the item rows (Item Name, Pieces, KG) directly to the clipboard, without rate or amount. Paste straight into Excel.
- **Reopen** puts an order back to *To weigh* so the phone can enter the
  weight again.
- **Export weighed orders** downloads one workbook with every weighed order.

Every weighed order is also written automatically to the **`exports`**
folder as its own file, so there is always a copy on disk.

**Rate list**
- Rate per kg and weight per piece for all items. Click a number, type, press
  Tab or Enter — it saves as you go.
- **Bulk update** — paste rows copied from Excel. Columns:
  `name`, `rate per kg`, `weight per pc`, optional `category`.
  A preview shows what will change before anything is saved.
- **CSV** downloads the whole rate list.
- The amber bar at the top counts items with no weight per piece. Those
  show ₹0 estimates on the phone, so fill them in when you can.

**Settings**
- Business name, shared folder for extra copies, backup download.
- **PIN** — optional. Set one to stop workers opening the office page on a
  phone; leave it empty and the office page opens straight away.

---

## 4. Backups

Everything lives in two files:

- `data\prime.db` — orders, items, customers
- `data\settings.json` — business name, PIN, shared folder

**Settings → Download database backup** saves a copy of the database. Do that
before big rate changes, and keep the copy somewhere else (a pen drive or
your usual backup folder). To restore, close the server and put the file back
as `data\prime.db`.

---

## 5. If a phone cannot connect

1. Is the black window still open on the office PC?
2. Is the phone on the **same Wi-Fi** as the PC? (Mobile data off.)
3. Type the address exactly: `http://192.168.0.247:8077` — `http`, not `https`.
4. Run **`Allow phones on Wi-Fi.bat`** as administrator once.
5. Check the *Main* address on the office **Settings** page — if the router
   gave the PC a new address, use that one. Two addresses may be listed;
   the one marked **Main** is the right one for phones.

If the Mac shows "cannot connect", it is the same three checks — same Wi-Fi,
the *Main* address, and the server window open on the PC.

---

## 6. What is in this folder

```
Start Prime Steel.bat      start the server (double-click)
Allow phones on Wi-Fi.bat  one-time firewall rule for phones
server.py                  the server: database, API, pages
excel_export.py            ESTIMATE-style Excel / CSV output
web\                       the pages phones and the office use
data\prime.db              all orders, items and customers
data\settings.json         business name, PIN, shared folder
exports\                   one file per weighed order
tools\smoke_test.py        quick self-test of the server
```

`tools\smoke_test.py` is safe to run any time: `py -3 tools\smoke_test.py`.
It creates a test order and removes it again.

---

## 7. Things worth knowing

- Order numbers run `PS-2026-0001`, `PS-2026-0002`, … and never repeat.
- Money shows two decimals; weights show one decimal on phones, two in Excel.
- The phone app works without a signal for saving: anything it could not send
  sits in a queue and retries.
- The office page is read-mostly on purpose — the numbers come from the phones,
  not from typing on the PC.
