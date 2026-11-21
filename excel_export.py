"""
Excel output for the Prime Steel order book.

The per-order workbook mirrors the layout of the yard's existing ESTIMATE
sheet (DETAILS / PCS / QNTY / W/PCS / RATE / AMOUNT) so rows can be copied
straight into the master file. Formulas are deliberately *not* used: the
values are final, so nothing recalculates or breaks when the file is opened
on a different machine.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.properties import PageSetupProperties
    HAS_OPENPYXL = True
except Exception:  # fallback: check local user Python site-packages
    try:
        import sys
        import os
        from pathlib import Path
        py39_site = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python39" / "lib" / "site-packages"
        if py39_site.exists() and str(py39_site) not in sys.path:
            sys.path.append(str(py39_site))
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.properties import PageSetupProperties
        HAS_OPENPYXL = True
    except Exception:
        HAS_OPENPYXL = False

NAVY = "1E3A5F"
LIGHT = "F1F5F9"
AMBER = "FEF3C7"
GREEN = "ECFDF5"

MONEY_FMT = '#,##0.00'
WEIGHT_FMT = '#,##0.000'
PCS_FMT = '#,##0'


def _stamp(ms: int | None) -> str:
    if not ms:
        return ""
    return datetime.fromtimestamp(ms / 1000).strftime("%d-%m-%Y %I:%M %p")


def _date_only(ms: int | None) -> str:
    if not ms:
        return ""
    return datetime.fromtimestamp(ms / 1000).strftime("%d-%m-%Y")


# --------------------------------------------------------------------------
# per-order workbook
# --------------------------------------------------------------------------

def order_workbook(order: dict, settings: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "ESTIMATE"
    ws.sheet_view.showGridLines = False

    widths = {"A": 5, "B": 42, "C": 9, "D": 13, "E": 11, "F": 12, "G": 16}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

    thin = Side(style="thin", color="D9DEE5")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)

    business = (settings.get("business_name") or "Prime Steel").upper()
    ws["A1"] = business
    ws["A1"].font = Font(size=20, bold=True, color=NAVY)
    ws["A2"] = "ESTIMATE SHEET"
    ws["A2"].font = Font(size=10, bold=True, color="64748B")

    weighed = order["status"] == "WEIGHED"
    ws["F1"] = "WEIGHED" if weighed else "ESTIMATE"
    ws["F1"].font = Font(size=10, bold=True, color="047857" if weighed else "B45309")
    ws["F1"].alignment = Alignment(horizontal="right")
    ws["F2"] = order["order_no"]
    ws["F2"].font = Font(size=12, bold=True, color=NAVY)
    ws["F2"].alignment = Alignment(horizontal="right")

    meta = [
        ("BILL TO", order["customer_name"] or "Walk-in customer"),
        ("PHONE", order["customer_phone"] or ""),
        ("DATE", _stamp(order["created_at"])),
        ("TAKEN BY", order["worker"] or ""),
    ]
    if weighed:
        meta.append(("WEIGHED", _stamp(order["weighed_at"])))
    if order.get("note"):
        meta.append(("NOTE", order["note"]))

    row = 4
    for label, value in meta:
        ws.cell(row=row, column=1, value=label).font = Font(size=9, bold=True, color="64748B")
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=4)
        c = ws.cell(row=row, column=2, value=value)
        c.font = Font(size=11, bold=(label == "BILL TO"))
        c.alignment = Alignment(horizontal="left", vertical="center")
        row += 1

    header_row = row + 1
    headers = ["#", "DETAILS", "PCS", "QNTY (kg)", "W/PCS", "RATE", "AMOUNT"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=header_row, column=i, value=h)
        c.font = Font(size=10, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=NAVY)
        c.alignment = Alignment(horizontal="center" if i != 2 else "left", vertical="center")
        c.border = box
    ws.row_dimensions[header_row].height = 22

    first = header_row + 1
    r = first
    single_line = len(order.get("lines_detail", [])) == 1
    order_act = float(order.get("actual_weight") or 0.0)

    def _line_weight(l: dict) -> float:
        act_w = l.get("actual_weight")
        if act_w is not None and float(act_w) > 0:
            return float(act_w)
        if single_line and order_act > 0:
            return order_act
        if act_w is not None:
            return float(act_w)
        return float(l.get("est_weight") or 0.0)

    for idx, line in enumerate(order["lines_detail"], start=1):
        w = _line_weight(line)
        amount = round(w * line["rate"], 2)
        name_disp = line["name"]
        if line.get("narration"):
            name_disp = f"{name_disp} ({line['narration']})"
        values = [idx, name_disp, line["pcs"], w, round(w / line["pcs"], 3) if line["pcs"] else 0,
                  line["rate"], amount]
        for col, val in enumerate(values, start=1):
            c = ws.cell(row=r, column=col, value=val)
            c.border = box
            c.font = Font(size=10, bold=(col == 7))
            if col == 2:
                c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            elif col in (3,):
                c.alignment = Alignment(horizontal="center")
                c.number_format = PCS_FMT
            elif col == 4 or col == 5:
                c.alignment = Alignment(horizontal="right")
                c.number_format = WEIGHT_FMT
            elif col == 6:
                c.alignment = Alignment(horizontal="right")
                c.number_format = MONEY_FMT
            elif col == 7:
                c.alignment = Alignment(horizontal="right")
                c.number_format = MONEY_FMT
        ws.row_dimensions[r].height = 18
        r += 1

    blank_rows = max(0, 3)  # leave a little room for hand-written extras
    for _ in range(blank_rows):
        for col in range(1, 8):
            ws.cell(row=r, column=col).border = box
        r += 1

    total_row = r
    ws.merge_cells(start_row=total_row, start_column=1, end_row=total_row, end_column=2)
    ws.cell(row=total_row, column=1, value="TOTAL").font = Font(size=11, bold=True, color="FFFFFF")
    ws.cell(row=total_row, column=1).fill = PatternFill("solid", fgColor=NAVY)
    ws.cell(row=total_row, column=1).alignment = Alignment(horizontal="right")
    pcs_total = sum(l["pcs"] for l in order["lines_detail"])
    w_total = sum(_line_weight(l) for l in order["lines_detail"])
    a_total = sum(_line_weight(l) * l["rate"] for l in order["lines_detail"])
    totals = [None, None, pcs_total, round(w_total, 3), None, None, round(a_total, 2)]
    for col, val in enumerate(totals, start=1):
        c = ws.cell(row=total_row, column=col, value=val)
        c.fill = PatternFill("solid", fgColor=NAVY)
        c.font = Font(size=11, bold=True, color="FFFFFF")
        c.border = box
        if col == 3:
            c.number_format = PCS_FMT
            c.alignment = Alignment(horizontal="center")
        if col == 4:
            c.number_format = WEIGHT_FMT
            c.alignment = Alignment(horizontal="right")
        if col == 7:
            c.number_format = MONEY_FMT
            c.alignment = Alignment(horizontal="right")
    ws.row_dimensions[total_row].height = 24

    foot = total_row + 2
    ws.merge_cells(start_row=foot, start_column=1, end_row=foot, end_column=7)
    note = ("Weights as per weighbridge." if weighed
            else "Estimated weights. Final amount follows the weighbridge reading.")
    ws.cell(row=foot, column=1, value=note).font = Font(size=9, italic=True, color="64748B")
    ws.cell(row=foot + 1, column=1,
            value="Prepared by Prime Steel Order Book - " + datetime.now().strftime("%d-%m-%Y %H:%M"))
    ws.cell(row=foot + 1, column=1).font = Font(size=8, color="94A3B8")

    ws.freeze_panes = ws.cell(row=first, column=1)
    ws.print_area = f"A1:G{foot + 1}"
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)

    return _save(wb)


# --------------------------------------------------------------------------
# master workbook (all weighed orders)
# --------------------------------------------------------------------------

def master_workbook(orders: list[dict], settings: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Orders"
    ws.sheet_view.showGridLines = False

    head_fill = PatternFill("solid", fgColor=NAVY)
    thin = Side(style="thin", color="E2E8F0")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)

    ws["A1"] = (settings.get("business_name") or "Prime Steel").upper()
    ws["A1"].font = Font(size=16, bold=True, color=NAVY)
    ws["A2"] = f"All weighed orders - exported {datetime.now().strftime('%d-%m-%Y %H:%M')}"
    ws["A2"].font = Font(size=9, color="64748B")

    headers = ["ORDER NO", "DATE", "TIME", "CUSTOMER", "PHONE", "WORKER", "ITEMS", "PCS",
               "EST WT (kg)", "ACT WT (kg)", "DIFF (kg)", "EST AMOUNT", "ACT AMOUNT", "DIFF"]
    row = 4
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=row, column=i, value=h)
        c.font = Font(size=9, bold=True, color="FFFFFF")
        c.fill = head_fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = box
    ws.row_dimensions[row].height = 28

    row = 5
    for o in orders:
        dt = datetime.fromtimestamp(o["created_at"] / 1000)
        vals = [
            o["order_no"], dt.strftime("%d-%m-%Y"), dt.strftime("%I:%M %p"),
            o["customer_name"] or "Walk-in", o["customer_phone"], o["worker"],
            o["lines"], o["pcs"], o["est_weight"], o["actual_weight"],
            round(o["actual_weight"] - o["est_weight"], 3),
            o["est_amount"], o["actual_amount"],
            round(o["actual_amount"] - o["est_amount"], 2),
        ]
        for i, v in enumerate(vals, start=1):
            c = ws.cell(row=row, column=i, value=v)
            c.font = Font(size=10)
            c.border = box
            if i in (7, 8):
                c.number_format = PCS_FMT
                c.alignment = Alignment(horizontal="center")
            elif i in (9, 10, 11):
                c.number_format = WEIGHT_FMT
                c.alignment = Alignment(horizontal="right")
            elif i in (12, 13, 14):
                c.number_format = MONEY_FMT
                c.alignment = Alignment(horizontal="right")
            if o["status"] == "OPEN":
                c.fill = PatternFill("solid", fgColor=AMBER)
        row += 1

    for col, w in {"A": 16, "B": 12, "C": 11, "D": 30, "E": 15, "F": 16, "G": 7, "H": 7,
                   "I": 12, "J": 12, "K": 10, "L": 14, "M": 14, "N": 12}.items():
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A5"
    ws.auto_filter.ref = f"A4:N{max(4, row - 1)}"

    # --- lines sheet ---
    ls = wb.create_sheet("Items")
    ls.sheet_view.showGridLines = False
    lheaders = ["ORDER NO", "DATE", "CUSTOMER", "ITEM", "PCS", "W/PCS", "RATE",
                "EST WT", "ACT WT", "EST AMOUNT", "ACT AMOUNT"]
    for i, h in enumerate(lheaders, start=1):
        c = ls.cell(row=1, column=i, value=h)
        c.font = Font(size=9, bold=True, color="FFFFFF")
        c.fill = head_fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = box
    r = 2
    for o in orders:
        dt = datetime.fromtimestamp(o["created_at"] / 1000)
        single_line = len(o.get("lines_detail", [])) == 1
        order_act = float(o.get("actual_weight") or 0.0)
        for line in o["lines_detail"]:
            act_w = line.get("actual_weight")
            if act_w is not None and float(act_w) > 0:
                act = float(act_w)
            elif single_line and order_act > 0:
                act = order_act
            elif act_w is not None:
                act = float(act_w)
            else:
                act = float(line.get("est_weight") or 0.0)
            name_disp = line["name"]
            if line.get("narration"):
                name_disp = f"{name_disp} ({line['narration']})"
            vals = [o["order_no"], dt.strftime("%d-%m-%Y"), o["customer_name"] or "Walk-in",
                    name_disp, line["pcs"], line["weight_per_pc"], line["rate"],
                    line["est_weight"], act, line["est_amount"], round(act * line["rate"], 2)]
            for i, v in enumerate(vals, start=1):
                c = ls.cell(row=r, column=i, value=v)
                c.font = Font(size=10)
                c.border = box
                if i == 5:
                    c.number_format = PCS_FMT
                elif i in (6, 8, 9):
                    c.number_format = WEIGHT_FMT
                elif i in (7, 10, 11):
                    c.number_format = MONEY_FMT
            r += 1
    for col, w in {"A": 16, "B": 12, "C": 28, "D": 38, "E": 7, "F": 10, "G": 10,
                   "H": 11, "I": 11, "J": 13, "K": 13}.items():
        ls.column_dimensions[col].width = w
    ls.freeze_panes = "A2"
    ls.auto_filter.ref = f"A1:K{max(1, r - 1)}"

    # --- summary ---
    ss = wb.create_sheet("Summary")
    ss["A1"] = "Summary"
    ss["A1"].font = Font(size=14, bold=True, color=NAVY)
    rows = [
        ("Orders", len(orders)),
        ("Pieces", sum(o["pcs"] for o in orders)),
        ("Estimated weight (kg)", round(sum(o["est_weight"] for o in orders), 3)),
        ("Actual weight (kg)", round(sum(o["actual_weight"] for o in orders), 3)),
        ("Estimated amount", round(sum(o["est_amount"] for o in orders), 2)),
        ("Actual amount", round(sum(o["actual_amount"] for o in orders), 2)),
        ("Difference", round(sum(o["actual_amount"] - o["est_amount"] for o in orders), 2)),
    ]
    for i, (label, value) in enumerate(rows, start=2):
        ss.cell(row=i, column=1, value=label).font = Font(size=10, color="475569")
        c = ss.cell(row=i, column=2, value=value)
        c.font = Font(size=11, bold=True)
        if isinstance(value, float):
            c.number_format = MONEY_FMT
        c.alignment = Alignment(horizontal="right")
    ss.column_dimensions["A"].width = 26
    ss.column_dimensions["B"].width = 16

    return _save(wb)


def _save(wb) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------------------
# CSV fallback (no openpyxl on this machine)
# --------------------------------------------------------------------------

def order_csv(order: dict, settings: dict) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    weighed = order["status"] == "WEIGHED"
    w.writerow([(settings.get("business_name") or "Prime Steel").upper()])
    w.writerow(["ESTIMATE" if not weighed else "WEIGHED BILL", order["order_no"]])
    w.writerow([])
    w.writerow(["BILL TO", order["customer_name"] or "Walk-in"])
    w.writerow(["PHONE", order["customer_phone"]])
    w.writerow(["DATE", _stamp(order["created_at"])])
    w.writerow(["TAKEN BY", order["worker"]])
    if weighed:
        w.writerow(["WEIGHED", _stamp(order["weighed_at"])])
    w.writerow([])
    w.writerow(["#", "DETAILS", "PCS", "QNTY (kg)", "W/PCS", "RATE", "AMOUNT"])
    single_line = len(order.get("lines_detail", [])) == 1
    order_act = float(order.get("actual_weight") or 0.0)

    def _line_weight(l: dict) -> float:
        act_w = l.get("actual_weight")
        if act_w is not None and float(act_w) > 0:
            return float(act_w)
        if single_line and order_act > 0:
            return order_act
        if act_w is not None:
            return float(act_w)
        return float(l.get("est_weight") or 0.0)

    for idx, line in enumerate(order["lines_detail"], start=1):
        wt = _line_weight(line)
        name_disp = line["name"]
        if line.get("narration"):
            name_disp = f"{name_disp} ({line['narration']})"
        w.writerow([idx, name_disp, line["pcs"], f"{wt:.3f}",
                    f"{(wt / line['pcs'] if line['pcs'] else 0):.3f}",
                    f"{line['rate']:.2f}", f"{wt * line['rate']:.2f}"])
    tw = sum(_line_weight(l) for l in order["lines_detail"])
    ta = sum(_line_weight(l) * l["rate"] for l in order["lines_detail"])
    w.writerow(["", "TOTAL", sum(l["pcs"] for l in order["lines_detail"]), f"{tw:.3f}", "", "", f"{ta:.2f}"])
    return out.getvalue()


def master_csv(orders: list[dict]) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["ORDER NO", "DATE", "TIME", "CUSTOMER", "PHONE", "WORKER", "ITEMS", "PCS",
                "EST WT", "ACT WT", "EST AMOUNT", "ACT AMOUNT"])
    for o in orders:
        dt = datetime.fromtimestamp(o["created_at"] / 1000)
        w.writerow([o["order_no"], dt.strftime("%d-%m-%Y"), dt.strftime("%I:%M %p"),
                    o["customer_name"] or "Walk-in", o["customer_phone"], o["worker"],
                    o["lines"], o["pcs"], f"{o['est_weight']:.3f}", f"{o['actual_weight']:.3f}",
                    f"{o['est_amount']:.2f}", f"{o['actual_amount']:.2f}"])
    return out.getvalue()
