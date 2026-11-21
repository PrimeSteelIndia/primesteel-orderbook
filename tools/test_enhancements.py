"""Integration test for new features:
1. Customer management (add, update, alter, list, delete)
2. Multiple unit options & auto-conversion (pcs, feet, inch, kg, alt unit/factor)
3. Item narrations per order line (e.g. "half sheet", "cut to 4ft")
4. Order editing anytime (both open and weighed)
5. Worker weight correction on weighed orders
6. Excel / CSV export with line narrations
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

# Ensure root directory is on sys.path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import server
import excel_export


import uuid

class TestPrimeSteelEnhancements(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()

    def test_01_customer_crud(self):
        """Test customer adding, updating, altering name and number, and deleting."""
        test_suffix = uuid.uuid4().hex[:6]
        cname = f"Gupta Iron Works {test_suffix}"
        cust = server.create_customer({
            "name": cname,
            "phone": "9829012345",
            "gstin": "08ABCDE1234F1Z5",
            "address": "Road No. 9, VKI Area, Jaipur",
        })
        self.assertIsNotNone(cust)
        cust_id = cust["id"]
        self.assertEqual(cust["name"], cname)
        self.assertEqual(cust["phone"], "9829012345")

        # 2. List customers and verify search
        res = server.list_customers(query=test_suffix)
        self.assertTrue(any(c["id"] == cust_id for c in res))

        # 3. Alter customer name and number
        cname_updated = f"Gupta & Sons Iron Works {test_suffix}"
        updated = server.update_customer(cust_id, {
            "name": cname_updated,
            "phone": "9829099999",
            "address": "Plot 12, Phase 2, Jaipur",
        })
        self.assertEqual(updated["name"], cname_updated)
        self.assertEqual(updated["phone"], "9829099999")

        # Verify from DB
        found = server.get_customer_by_id(cust_id)
        self.assertEqual(found["name"], cname_updated)
        self.assertEqual(found["phone"], "9829099999")

        # 4. Delete customer
        del_res = server.delete_customer(cust_id)
        self.assertTrue(del_res)
        self.assertIsNone(server.get_customer_by_id(cust_id))

    def test_02_unit_conversions(self):
        """Test unit calculations: inch to feet, feet to pcs, kg to pcs, and alt factor."""
        # Item: 20 ft pipe, 15 kg per piece, rate 80/kg
        item = {
            "name": "Test Pipe 20ft",
            "weight_per_pc": 15.0,
            "rate": 80.0,
            "main_unit": "pcs",
            "alt_unit": "bundle",
            "alt_factor": 5.0,  # 1 bundle = 5 pcs
            "length_per_pc": 20.0,  # 20 ft per pc
        }

        # Case A: 3 pcs
        res_pcs = server.resolve_quantity(item, 3, "pcs")
        self.assertEqual(res_pcs["pcs"], 3)
        self.assertEqual(res_pcs["weight"], 45.0)

        # Case B: 60 feet -> 60 / 20 = 3 pcs
        res_feet = server.resolve_quantity(item, 60, "feet")
        self.assertEqual(res_feet["pcs"], 3)
        self.assertEqual(res_feet["weight"], 45.0)

        # Case C: 240 inches -> 20 feet -> 1 pc
        res_inch = server.resolve_quantity(item, 240, "inch")
        self.assertEqual(res_inch["pcs"], 1)
        self.assertEqual(res_inch["weight"], 15.0)

        # Case D: 2 bundles -> 2 * 5 = 10 pcs
        res_bundle = server.resolve_quantity(item, 2, "bundle")
        self.assertEqual(res_bundle["pcs"], 10)
        self.assertEqual(res_bundle["weight"], 150.0)

        # Case E: 30 kg -> 30 kg directly
        res_kg = server.resolve_quantity(item, 30, "kg")
        self.assertEqual(res_kg["weight"], 30.0)
        self.assertEqual(res_kg["pcs"], 2)  # 30 / 15 = 2 pcs

    def test_03_order_flow_with_narrations_and_editing(self):
        """Test full order flow: create order with units and narrations, edit order, weigh, fix weight."""
        # 1. Create a test item
        item_suffix = uuid.uuid4().hex[:6]
        item = server.create_item({
            "name": f"Test Angle 50x50x5 {item_suffix}",
            "category": "MS Angle",
            "rate": 65.0,
            "weight_per_pc": 22.5,
            "main_unit": "kg",
            "alt_unit": "pcs",
            "alt_factor": 22.5,
            "length_per_pc": 20.0,
        })
        item_id = item["id"]

        # 2. Create order with units and narrations
        order_payload = {
            "client_id": f"test-order-enh-{item_suffix}",
            "customer_name": "Sharma Fabricators",
            "customer_phone": "9829111222",
            "worker": "Kailash",
            "note": "Immediate delivery needed",
            "lines": [
                {
                    "item_id": item_id,
                    "entry_qty": 40,
                    "entry_unit": "feet",  # 40 ft = 2 pcs
                    "narration": "cut into 2 equal halves (10ft each)",
                }
            ],
        }

        order = server.create_order(order_payload)
        self.assertIsNotNone(order)
        order_id = order["id"]
        self.assertEqual(order["customer_name"], "Sharma Fabricators")
        self.assertEqual(order["customer_phone"], "9829111222")
        self.assertEqual(len(order["lines_detail"]), 1)

        line = order["lines_detail"][0]
        self.assertEqual(line["entry_unit"], "feet")
        self.assertEqual(line["entry_qty"], 40.0)
        self.assertEqual(line["pcs"], 2)
        self.assertEqual(line["narration"], "cut into 2 equal halves (10ft each)")
        self.assertEqual(order["est_weight"], 45.0)  # 2 pcs * 22.5 kg
        self.assertEqual(order["est_amount"], 45.0 * 65.0)

        # 3. Edit the taken order anytime: alter customer details and add line narration
        updated_order = server.update_order(order_id, {
            "customer_name": "Sharma Steel & Fabricators",
            "customer_phone": "9829111333",
            "note": "Urgent site delivery at Mansarovar",
            "lines": [
                {
                    "id": line["id"],
                    "item_id": item_id,
                    "entry_qty": 60,
                    "entry_unit": "feet",  # 60 ft = 3 pcs
                    "narration": "cut to 3 pieces of 20ft",
                    "rate": 65.0,
                }
            ],
        })
        self.assertEqual(updated_order["customer_name"], "Sharma Steel & Fabricators")
        self.assertEqual(updated_order["customer_phone"], "9829111333")
        self.assertEqual(updated_order["pcs"], 3)
        self.assertEqual(updated_order["est_weight"], 67.5)  # 3 * 22.5
        self.assertEqual(updated_order["lines_detail"][0]["narration"], "cut to 3 pieces of 20ft")

        # 4. Weigh the order
        line_id = updated_order["lines_detail"][0]["id"]
        weighed_order = server.submit_weights(order_id, {line_id: 68.4})
        self.assertEqual(weighed_order["status"], "WEIGHED")
        self.assertEqual(weighed_order["actual_weight"], 68.4)
        self.assertEqual(weighed_order["actual_amount"], round(68.4 * 65.0, 2))

        # 5. Worker weight correction: worker finds scale weight was entered wrong (e.g. 68.4 was mistake, actual was 66.8)
        corrected_order = server.submit_weights(order_id, {line_id: 66.8})
        self.assertEqual(corrected_order["actual_weight"], 66.8)
        self.assertEqual(corrected_order["actual_amount"], round(66.8 * 65.0, 2))

        # 6. Test Excel / CSV export with line narrations
        settings = server.load_settings()
        csv_data = excel_export.order_csv(corrected_order, settings)
        self.assertIn("cut to 3 pieces of 20ft", csv_data)
        if excel_export.HAS_OPENPYXL:
            wb_data = excel_export.order_workbook(corrected_order, settings)
            self.assertTrue(len(wb_data) > 0)
            m_wb_data = excel_export.master_workbook([corrected_order], settings)
            import openpyxl, io
            m_wb = openpyxl.load_workbook(io.BytesIO(m_wb_data))
            self.assertIn("Items", m_wb.sheetnames)
            item_vals = [m_wb["Items"].cell(r, 4).value for r in range(1, m_wb["Items"].max_row + 1)]
            self.assertTrue(any("cut to 3 pieces of 20ft" in str(v) for v in item_vals))

        # Cleanup test order and item
        server.delete_order(order_id)
        server.delete_item(item_id, hard=True)

    def test_04_line_level_operations_and_item_deactivation(self):
        """Test adding/updating individual lines and safe item deactivation."""
        item = server.create_item({
            "name": f"Test Sheet {uuid.uuid4().hex[:6]}",
            "category": "CR Sheet",
            "rate": 72.0,
            "weight_per_pc": 30.0,
            "main_unit": "sheet",
            "alt_unit": "kg",
            "alt_factor": 0,
            "length_per_pc": 0,
        })
        item_id = item["id"]

        # Create order with 1 sheet
        order = server.create_order({
            "customer_name": "Modern Engineering",
            "customer_phone": "9829555666",
            "lines": [
                {
                    "item_id": item_id,
                    "qty": 1,
                    "unit": "sheet",
                    "narration": "half sheet needed",
                }
            ],
        })
        order_id = order["id"]
        line_id = order["lines_detail"][0]["id"]
        self.assertEqual(order["lines_detail"][0]["narration"], "half sheet needed")

        # Update line narration and qty
        updated = server.update_order_line(order_id, line_id, {
            "narration": "quarter sheet 2ft x 4ft",
            "qty": 2,
        })
        self.assertEqual(updated["lines_detail"][0]["narration"], "quarter sheet 2ft x 4ft")

        # Deleting item with existing order line must deactivate (soft delete), not crash
        del_item_res = server.delete_item(item_id, hard=False)
        self.assertEqual(del_item_res["action"], "deactivated")

        # Cleanup
        server.delete_order(order_id)
        server.delete_item(item_id, hard=True)


if __name__ == "__main__":
    unittest.main()
