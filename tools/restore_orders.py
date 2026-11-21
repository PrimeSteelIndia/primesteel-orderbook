import os
import glob
import uuid
import datetime
import sqlite3
import openpyxl

DB_PATH = r'C:\Users\Prime Steel\Desktop\PrimeSteel\data\prime.db'
EXPORTS_DIR = r'C:\Users\Prime Steel\Desktop\PrimeSteel\exports'

def restore():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Load existing order_nos
    existing = set(r[0] for r in cur.execute('SELECT order_no FROM orders').fetchall())
    print(f"Existing orders in DB: {existing}")

    # Build items lookup by norm/name
    items_rows = cur.execute('SELECT id, name, norm, category, weight_per_pc, rate FROM items').fetchall()
    item_map = {}
    for it in items_rows:
        item_map[it['name'].strip().upper()] = dict(it)
        item_map[it['norm'].strip().lower()] = dict(it)

    files = sorted(glob.glob(os.path.join(EXPORTS_DIR, '*.xlsx')))
    restored_count = 0

    for f in files:
        fname = os.path.basename(f)
        if 'Test' in fname or 'Sharma' in fname:
            continue
        
        # parse order_no from fname e.g. PS-2026-0021_...
        order_no = fname.split('_')[0]
        if order_no in existing:
            print(f"Skipping {order_no} (already in DB)")
            continue

        wb = openpyxl.load_workbook(f, data_only=True)
        ws = wb.active

        bill_to = str(ws.cell(4, 2).value or '').strip()
        phone = str(ws.cell(5, 2).value or '').strip()
        date_str = str(ws.cell(6, 2).value or '').strip()
        worker = str(ws.cell(7, 2).value or '').strip() or 'sahil'
        note = ''
        if ws.cell(9, 1).value == 'NOTE':
            note = str(ws.cell(9, 2).value or '').strip()

        # Parse date
        # format: '18-11-2026 10:33 AM'
        try:
            dt = datetime.datetime.strptime(date_str, '%d-%m-%Y %I:%M %p')
            created_at = int(dt.timestamp() * 1000)
        except Exception:
            created_at = int(datetime.datetime.now().timestamp() * 1000)

        # Seq and year from order_no e.g. PS-2026-0021
        parts = order_no.split('-')
        year = int(parts[1]) if len(parts) > 1 else 2026
        seq = int(parts[2]) if len(parts) > 2 else 0

        # Lines start at row 11
        order_id = str(uuid.uuid4())
        client_id = f"{created_at}{uuid.uuid4().hex[:8]}"

        lines = []
        tot_pcs = 0
        tot_act_wt = 0.0
        tot_act_amt = 0.0

        r = 11
        while r <= ws.max_row:
            cell_val = ws.cell(r, 1).value
            if cell_val == 'TOTAL' or cell_val is None or str(cell_val).strip() == '':
                break
            
            line_no = int(cell_val)
            name = str(ws.cell(r, 2).value or '').strip()
            pcs = int(ws.cell(r, 3).value or 0)
            act_wt = float(ws.cell(r, 4).value or 0.0)
            wp = float(ws.cell(r, 5).value or 0.0)
            rate = float(ws.cell(r, 6).value or 0.0)
            amt = float(ws.cell(r, 7).value or 0.0)

            # lookup item
            matched = item_map.get(name.upper())
            item_id = matched['id'] if matched else None
            cat = matched['category'] if matched else ('COIL' if 'COIL' in name.upper() else '202')
            if not wp and matched:
                wp = matched.get('weight_per_pc', 0.0)

            line_id = str(uuid.uuid4())
            lines.append((
                line_id, order_id, line_no, item_id, name, cat,
                pcs, wp, rate, act_wt, '', 'pcs', float(pcs), 'pcs', float(pcs)
            ))
            tot_pcs += pcs
            tot_act_wt += act_wt
            tot_act_amt += amt
            r += 1

        # est weight approx = act_wt
        est_weight = tot_act_wt
        est_amount = tot_act_amt

        # Insert order
        cur.execute('''
            INSERT INTO orders (
                id, order_no, seq, year, client_id, created_at,
                customer_name, customer_phone, worker, note, status,
                est_weight, est_amount, actual_weight, actual_amount,
                weighed_at, exported_at, export_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            order_id, order_no, seq, year, client_id, created_at,
            bill_to, phone, worker, note, 'WEIGHED',
            est_weight, est_amount, tot_act_wt, tot_act_amt,
            created_at + 120000, created_at + 150000, ''
        ))

        for l in lines:
            cur.execute('''
                INSERT INTO order_lines (
                    id, order_id, line_no, item_id, name, category,
                    pcs, weight_per_pc, rate, actual_weight, narration,
                    entry_unit, entry_qty, unit, qty
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', l)

        # Update counter if seq is higher
        cur.execute('''
            INSERT INTO counters (name, value) VALUES ('orders', ?)
            ON CONFLICT(name) DO UPDATE SET value = MAX(value, excluded.value)
        ''', (seq,))

        print(f"RESTORED: {order_no} | {bill_to} | {len(lines)} lines | {tot_act_wt} kg | Rs.{tot_act_amt}")
        restored_count += 1
        existing.add(order_no)

    conn.commit()
    conn.close()
    print(f"Finished restoring {restored_count} orders.")

if __name__ == '__main__':
    restore()
