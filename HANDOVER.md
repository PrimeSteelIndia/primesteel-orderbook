# Prime Steel Order Book — Handover Documentation

**Project:** Prime Steel Order Book & Scale Weighing System  
**Repository Location:** `C:\Users\Prime Steel\Desktop\PrimeSteel`  
**Desktop Shortcut:** `C:\Users\Prime Steel\Desktop\Prime Steel Order Book.lnk`  
**Current Status:** Production Ready & Live on Port 8077  
**Date of Handover:** 18 November 2026  

---

## 1. System Overview

Prime Steel Order Book is a real-time, local-first steel trading and scale-weighing application designed for steel stockists and fabricators. It consists of:
1. **Official Landing Page (`/`)**: Prime Steel showcase landing page featuring 3D WebGL coil/pipe visualizer, product catalog, application showcase, and prominent "Place Order Online" call-to-actions.
2. **Customer Order Portal (`/order`)**: Dedicated public portal for customers. Customer name is strictly manual text input (zero customer database leakage), honeypot anti-bot flood protection, and private "My Orders" tab displaying only orders matching the customer's verified phone number.
3. **Worker Station App (`/worker`)**: Scale weighing and order maintenance app for shop-floor workers. Protected by Worker PIN (`1234` or Admin Password). Allows taking orders, searching registered clients, entering scale weights, and correcting line weights.
4. **Office Admin Dashboard (`/admin`)**: Desktop-optimized administrative portal locked with admin password (`Prime2026`) for order monitoring, rate list maintenance, customer management with bulk excel-paste addition, settings configuration, and one-click Excel/CSV report exports.
5. **Backend Service (`server.py`)**: Zero-dependency Python HTTP service backed by SQLite with automatic column migrations, instant calculation engine, real-time Excel rates sync, sliding-window rate limiting, and encrypted 24x7 Cloudflare Argo Tunnel with automatic HTTP→HTTPS enforcement.

---

## 2. Key Features Delivered

### A. Flexible Multi-Unit Architecture (Coil & Standard Steel)
Steel inventory requires dynamic conversion between weight, pieces, lengths, and coils:
- **Main Unit:** Primary pricing unit (usually `kg`). Rate ₹ multiplies **exclusively with the Main Unit** (`est_amount = main_qty * rate`).
- **Primary Alternate Unit (`alt_unit` & `alt_factor`):** E.g. `feet` at `1.9 kg/ft`.
- **Secondary Alternate Unit (`alt_unit2` & `alt_unit2_factor`):** E.g. `pcs` at `100 kg/pc`.
- **Automatic Dimension Derivation:** If an item has `alt_factor = 1.9` (kg/ft) and `alt_unit2_factor = 100` (kg/pc), length per piece is automatically derived as `100 / 1.9 = 52.63 ft/pc`.
- **Supported Units:** `kg`, `pcs`, `feet`, `inch` (auto-converts `/ 12` to feet), `metre` (auto-converts `* 3.28084` to feet), `bundle`, and custom units.
- **Worker Quantity Sheet:** Real-time conversion chain chips (e.g. `1 pc = 100 kg = 52.6 ft`) so workers can pick whichever unit the buyer specifies.

### B. Bulk Customer Addition (No CSV Required)
- Located on the office dashboard under **Customers &rarr; Bulk add**.
- Direct clipboard paste from Excel or Google Sheets (supports tab-delimited, comma-delimited, and spaced columns: `Name, Phone, GSTIN, Address`).
- Interactive live preview grid with real-time **New** vs **Will update** detection for existing customers.
- Direct row editing and "+ Add blank row" button to type directly in the interface.
- Preserves customer site address and notes across all orders.

### C. Rate List & Item Editing
- **In-Table Editing:** Item Name, Category, Rate, Main Unit, Alt Unit 1, Alt 1 Factor, Sec Alt Unit, Sec Alt Factor, Length (ft), and Weight (kg) are directly editable inside the rate list table with auto-save.
- **Category Autocomplete:** Datalist dropdown (`#catDatalist`) assists quick categorization without typos.
- **Modal Sheets:** Both "Edit item" and "Add item" modals provide full controls for secondary alt units and conversion factors.

### D. Mobile Phone Ergonomics & Auto-Zoom Fix
- Fixed browser auto-zoom bug on mobile phones when typing in inputs.
- Configured `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">` in [index.html](file:///C:/Users/Prime%20Steel/Desktop/PrimeSteel/web/index.html) and [admin.html](file:///C:/Users/Prime%20Steel/Desktop/PrimeSteel/web/admin.html).
- Enforced `font-size: 16px !important` for all mobile inputs in [app.css](file:///C:/Users/Prime%20Steel/Desktop/PrimeSteel/web/app.css).

### E. Order Editing & Scale Weight Correction
- Orders can be edited at any time (items added, deleted, quantities changed, units changed, customer name/phone altered).
- Per-line item narrations (e.g. *"half sheet"*, *"cut to 4ft"*, *"bend 90 deg"*) appear in the worker app, office drawers, print slips, and Excel exports.
- Workers can correct item weights anytime by tapping **Change weight** even after weights have been submitted.

### F. 24x7 Online Access via Encrypted Cloudflare Tunnel & Dedicated Roles
- **Zero-config public HTTPS access:** Hosted directly from this machine 24x7 with Cloudflare Argo Tunnel.
- **Dedicated Portals & Links:**
  1. **Official Landing Page (`/`):**
     - Primary Domain: `https://primesteel.cc.cd/`
     - Features 3D WebGL coils, specs, products, contact, and direct buttons to place orders.
  2. **Customer Order Portal (`/order`):**
     - Primary Domain: `https://primesteel.cc.cd/order`
     - **Privacy Guard:** Customer name is strictly manual input (never leaks registered customer names).
     - **Phone-Based Isolation:** In "My Orders", customers only see orders placed under their specific phone number. Other clients' orders are never displayed.
     - **Anti-Bot Protection:** Honeypot field + sub-second script rejection + sliding-window rate limit (max 6 orders / 5 min).
  3. **Worker Scale Station (`/worker`):**
     - Primary Domain: `https://primesteel.cc.cd/worker`
     - **Worker PIN Protected:** Unlocks with Worker PIN (`1234`) or Admin Password (`Prime2026`).
     - Includes instant "Lock" button in header.
     - Allows yard workers to enter scale weights, fix weights, and search clients.
  4. **Office Admin Dashboard (`/admin`):**
     - Primary Domain: `https://primesteel.cc.cd/admin`
     - **Admin Password Protected:** Unlocks with `Prime2026` (changeable in Settings).
     - Manages rates, Excel sync, bulk client import, settings, and Worker PIN.
- **Danger Sign & Security Headers:**
  - Automatic `301 Moved Permanently` from `http://` to `https://`.
  - HSTS (`Strict-Transport-Security`), `X-Content-Type-Options: nosniff`, and `X-Frame-Options: SAMEORIGIN` headers sent on every response.
- **Windows Auto-Start:**
  - Running `Install 24x7 Windows AutoStart.bat` ensures the server and tunnel automatically start on Windows boot silently in the background.

### G. Automatic Excel Rates & Weight/Piece Sync
- Real-time watcher connected to `C:\Users\Prime Steel\Desktop\COMPANY STUDY_backup.xlsm`.
- Reads `Setting` sheet:
  - Column H: Item Name
  - Column I: Rate (₹)
  - Column J: Weight per Piece (kg)
- **Automatic Sync:** Whenever the Excel file is edited and saved, Prime Steel detects the file update and automatically updates matching database rates in real-time.
- **Manual Sync Button:** Instant on-demand "Sync from Excel" button in Admin Rate List and Settings.
- Safe binary reading prevents file-locking conflicts with Microsoft Excel.

---

## 3. Architecture & File Structure

```
C:\Users\Prime Steel\Desktop\PrimeSteel\
├── server.py               # Main Python backend (HTTP + SQLite + Auto-migrations)
├── excel_export.py         # OpenPyXL order and master workbook generators
├── data/
│   ├── orders.db           # SQLite database
│   └── settings.json       # Business name, tagline, PIN, shared folder config
├── exports/                # Automatic exported .xlsx / .csv invoices
├── tools/
│   ├── smoke_test.py             # End-to-end smoke test suite
│   ├── test_enhancements.py      # Integration test suite for multi-unit & narrations
│   └── test_prompt8_features.py  # Unit test suite for Coil math, bulk customers, item edit
└── web/
    ├── index.html          # Worker progressive web app shell
    ├── worker.js           # Worker UI logic, offline outbox, unit calculations
    ├── admin.html          # Office management dashboard shell
    ├── admin.js            # Office UI logic, rate tables, bulk customer modal
    ├── app.css             # Shared styles and mobile responsive rules
    └── ui.js               # Common modal sheet, toast, and icon rendering helpers
```

---

## 4. Database Schema

The SQLite schema automatically checks and applies migrations on startup:

| Table | Purpose | Key Columns |
|---|---|---|
| `orders` | Master orders | `id, order_no, customer_name, customer_phone, worker, note, status, est_weight, est_amount, actual_weight, actual_amount, weighed_at` |
| `order_lines` | Order line items | `id, order_id, line_no, item_id, name, category, pcs, weight_per_pc, rate, actual_weight, narration, entry_unit, entry_qty, unit, qty` |
| `items` | Master rate list | `id, name, norm, category, rate, weight_per_pc, main_unit, alt_unit, alt_factor, alt_unit2, alt_unit2_factor, length_per_pc, active` |
| `customers` | Customer directory | `id, name, norm, phone, gstin, address, updated_at` |
| `counters` | Sequence numbers | `name, value` (e.g. `orders-2026`) |
| `log` | Audit logs | `id, at, kind, detail` |

---

## 5. API Reference Summary

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/bootstrap` | Initial worker & admin payload (items, categories, settings, LAN IPs) |
| `GET` | `/api/orders` | List orders (filterable by `?status=OPEN` or `?status=WEIGHED`) |
| `POST` | `/api/orders` | Create a new order with multiple unit inputs and narrations |
| `POST` | `/api/orders/{id}/update` | Update order metadata and line items |
| `POST` | `/api/orders/{id}/weight` | Submit scale weights for all items |
| `POST` | `/api/orders/{id}/lines/{lid}/update`| Update individual line weight (weight correction) or narration |
| `GET` | `/api/customers` | Search and list registered customers |
| `POST` | `/api/customers` | Create a single customer |
| `POST` | `/api/customers/bulk` | Bulk create/update customers from parsed rows |
| `POST` | `/api/items/{id}/update` | Update rate list item fields (name, category, units, factors) |
| `POST` | `/api/items/bulk` | Bulk upsert items from spreadsheet rows |
| `GET` | `/api/settings` | Retrieve LAN addresses, paths, business metadata |
| `GET` | `/api/export/order/{id}` | Download single order `.xlsx` or `.csv` |
| `GET` | `/api/export/ready` | Download consolidated master report |

---

## 6. How to Run & Verify

1. **Start the Service:**
   ```powershell
   cd "C:\Users\Prime Steel\Desktop\PrimeSteel"
   python server.py --port 8077
   ```
2. **Access URLs:**
   - Worker App: `http://localhost:8077/` (or via Wi-Fi: `http://<LAN_IP>:8077/`)
   - Office Dashboard: `http://localhost:8077/admin`
3. **Execute Test Suites:**
   ```powershell
   python tools/test_excel_sync_and_tunnel.py
   python tools/test_prompt8_features.py
   python tools/test_enhancements.py
   python tools/smoke_test.py
   ```
   *(All 4 test suites pass with 100% success).*
