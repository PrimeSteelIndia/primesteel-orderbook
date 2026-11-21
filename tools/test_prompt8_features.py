import sys
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import server

class TestPrompt8Features(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()

    def test_01_customer_bulk_add_and_address(self):
        """Test customer bulk addition without CSV and address retention."""
        suffix = uuid.uuid4().hex[:6]
        c1_name = f"Bulk Alpha {suffix}"
        c2_name = f"Bulk Beta {suffix}"

        # 1. Bulk add customers
        rows = [
            {"name": c1_name, "phone": "9811111111", "gstin": "08AAA1111A1Z1", "address": "Jaipur Industrial Area"},
            {"name": c2_name, "phone": "9822222222", "gstin": "", "address": "Sikar Road Workshop"},
        ]
        res = server.bulk_update_customers(rows)
        self.assertEqual(res["created"], 2)
        self.assertEqual(res["updated"], 0)

        # 2. Verify customers in DB with addresses
        all_custs = server.list_customers(q=suffix)
        cust_map = {c["name"]: c for c in all_custs}
        self.assertIn(c1_name, cust_map)
        self.assertIn(c2_name, cust_map)
        self.assertEqual(cust_map[c1_name]["address"], "Jaipur Industrial Area")
        self.assertEqual(cust_map[c2_name]["address"], "Sikar Road Workshop")

        # 3. Bulk update existing customer + add a new one
        c3_name = f"Bulk Gamma {suffix}"
        rows2 = [
            {"name": c1_name, "phone": "9899999999", "gstin": "08AAA1111A1Z9", "address": "Updated Site Mansarovar"},
            {"name": c3_name, "phone": "9833333333", "gstin": "08CCC3333C3Z3", "address": "Sitapura"},
        ]
        res2 = server.bulk_update_customers(rows2)
        self.assertEqual(res2["created"], 1)
        self.assertEqual(res2["updated"], 1)

        # Verify update
        c1_updated = server.get_customer_by_id(cust_map[c1_name]["id"])
        self.assertEqual(c1_updated["phone"], "9899999999")
        self.assertEqual(c1_updated["address"], "Updated Site Mansarovar")

    def test_02_item_name_and_category_editing(self):
        """Test editing item name and category."""
        suffix = uuid.uuid4().hex[:6]
        item = server.create_item({
            "name": f"Original Item {suffix}",
            "category": "MS",
            "rate": 55.0,
            "weight_per_pc": 10.0,
            "main_unit": "kg",
            "alt_unit": "pcs",
            "alt_factor": 10.0,
        })
        item_id = item["id"]

        # Update both name and category
        new_name = f"Renamed Item {suffix}"
        updated = server.update_item(item_id, {
            "name": new_name,
            "category": "GI",
        })
        self.assertEqual(updated["name"], new_name)
        self.assertEqual(updated["category"], "GI")

        # Check rejection of duplicate name
        dupe_item = server.create_item({"name": f"Other Item {suffix}", "rate": 50})
        with self.assertRaises(ValueError):
            server.update_item(dupe_item["id"], {"name": new_name})

    def test_03_multi_unit_secondary_alt_unit_coil(self):
        """Test secondary alt unit with Coil example:
        Main = kg (Rate ₹ multiplies with kg only)
        Alt unit = feet, alt_factor = 1.9 kg/ft
        Secondary alt unit = pcs, alt_unit2_factor = 100 kg/pc (gives 52.63 ft/pc)
        """
        suffix = uuid.uuid4().hex[:6]
        coil = server.create_item({
            "name": f"GI Coil 0.5mm {suffix}",
            "category": "COIL",
            "rate": 70.0,
            "main_unit": "kg",
            "alt_unit": "feet",
            "alt_factor": 1.9,
            "alt_unit2": "pcs",
            "alt_unit2_factor": 100.0,
            "length_per_pc": 0,  # Auto-derived as 100 / 1.9 = 52.63 ft
        })

        # 1. Enter 1 pcs: should be 100 kg, ₹7000, ~52.63 ft
        r_pcs = server.resolve_quantity(coil, 1, "pcs")
        self.assertEqual(r_pcs["main_qty"], 100.0)
        self.assertEqual(r_pcs["est_amount"], 7000.0)
        self.assertEqual(r_pcs["est_weight"], 100.0)
        self.assertEqual(r_pcs["pcs"], 1)
        self.assertAlmostEqual(r_pcs["calc_feet"], 52.63, delta=0.1)

        # 2. Enter 100 kg: should be 1 pc, ₹7000, ~52.63 ft
        r_kg = server.resolve_quantity(coil, 100, "kg")
        self.assertEqual(r_kg["main_qty"], 100.0)
        self.assertEqual(r_kg["est_amount"], 7000.0)
        self.assertEqual(r_kg["pcs"], 1)
        self.assertAlmostEqual(r_kg["calc_feet"], 52.63, delta=0.1)

        # 3. Enter 52.632 feet: should be 100 kg, ₹7000, 1 pc
        r_ft = server.resolve_quantity(coil, 52.632, "feet")
        self.assertAlmostEqual(r_ft["main_qty"], 100.0, delta=0.1)
        self.assertAlmostEqual(r_ft["est_amount"], 7000.0, delta=5.0)
        self.assertEqual(r_ft["pcs"], 1)

        # 4. Enter 631.58 inch: converts to 52.63 ft -> 100 kg, ₹7000, 1 pc
        r_in = server.resolve_quantity(coil, 631.58, "inch")
        self.assertAlmostEqual(r_in["main_qty"], 100.0, delta=0.5)
        self.assertAlmostEqual(r_in["est_amount"], 7000.0, delta=30.0)
        self.assertEqual(r_in["pcs"], 1)

        # 5. Full order lifecycle with Coil
        order = server.create_order({
            "client_id": f"coil-order-{suffix}",
            "customer_name": "Test Coil Customer",
            "worker": "Dev",
            "lines": [
                {
                    "item_id": coil["id"],
                    "entry_qty": 2,
                    "entry_unit": "pcs",  # 2 pcs = 200 kg
                    "narration": "cut in two coils",
                }
            ]
        })
        self.assertEqual(order["est_weight"], 200.0)
        self.assertEqual(order["est_amount"], 14000.0)  # 200 kg * ₹70

        # Scale weigh actual weight 204.5 kg
        line_id = order["lines_detail"][0]["id"]
        weighed = server.submit_weights(order["id"], {line_id: 204.5}, require_all=True)
        self.assertEqual(weighed["status"], "WEIGHED")
        self.assertEqual(weighed["actual_weight"], 204.5)
        self.assertEqual(weighed["actual_amount"], round(204.5 * 70.0, 2))

if __name__ == "__main__":
    unittest.main()
