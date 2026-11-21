"""
Tests for Excel rates synchronization and Cloudflare Tunnel integration.
"""

import io
import os
import sqlite3
import sys
import unittest
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

import excel_sync
import tunnel
import server


class TestExcelSync(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript("""
            CREATE TABLE items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                norm TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                rate REAL NOT NULL,
                weight_per_pc REAL NOT NULL,
                main_unit TEXT NOT NULL DEFAULT 'kg',
                alt_unit TEXT NOT NULL DEFAULT 'pcs',
                alt_factor REAL NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                sort INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );
        """)

    def tearDown(self):
        self.conn.close()

    def test_apply_rates_updates_and_creates(self):
        # Insert initial item
        self.conn.execute(
            "INSERT INTO items (name, norm, category, rate, weight_per_pc, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("PVC (202) 16G", "PVC (202) 16G", "202", 150.0, 30.0, 1000),
        )
        self.conn.commit()

        sample_rows = [
            {"name": "PVC (202) 16G", "rate": 185.26, "weight": 38.0},
            {"name": "NEW COIL ITEM", "rate": 220.0, "weight": 100.0},
        ]

        res = excel_sync.apply_rates_to_db(
            sample_rows,
            self.conn,
            norm_name_fn=server.norm_name,
            now_ms_fn=server.now_ms,
        )

        self.assertTrue(res["ok"])
        self.assertEqual(res["updated"], 1)
        self.assertEqual(res["created"], 1)

        # Verify updated item
        updated_row = self.conn.execute("SELECT * FROM items WHERE norm=?", ("PVC (202) 16G",)).fetchone()
        self.assertAlmostEqual(updated_row["rate"], 185.26)
        self.assertAlmostEqual(updated_row["weight_per_pc"], 38.0)

        # Verify created item
        created_row = self.conn.execute("SELECT * FROM items WHERE norm=?", ("NEW COIL ITEM",)).fetchone()
        self.assertIsNotNone(created_row)
        self.assertAlmostEqual(created_row["rate"], 220.0)
        self.assertAlmostEqual(created_row["weight_per_pc"], 100.0)

    def test_read_real_company_study_file(self):
        path = excel_sync.DEFAULT_EXCEL_PATH
        if path.is_file():
            rows, err = excel_sync.read_rates_from_excel(path)
            self.assertIsNone(err)
            self.assertGreaterEqual(len(rows), 70)
            names = [r["name"] for r in rows]
            self.assertIn("COIL PVC (202) 24G", names)


class TestTunnelStatus(unittest.TestCase):
    def test_tunnel_status_schema(self):
        st = tunnel.get_tunnel_status()
        self.assertIn("active", st)
        self.assertIn("url", st)
        self.assertIn("mode", st)


if __name__ == "__main__":
    unittest.main()
