"""Zero-dependency Turso (libSQL) HTTP /v2/pipeline driver compatible with sqlite3.Row usage."""
from __future__ import annotations

import base64
import json
import math
import sqlite3
import urllib.error
import urllib.request
from typing import Any


def _encode_arg(val: Any) -> dict:
    if val is None:
        return {"type": "null"}
    if isinstance(val, bool):
        return {"type": "integer", "value": "1" if val else "0"}
    if isinstance(val, int):
        return {"type": "integer", "value": str(val)}
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return {"type": "null"}
        return {"type": "float", "value": val}
    if isinstance(val, (bytes, bytearray)):
        return {"type": "blob", "base64": base64.b64encode(bytes(val)).decode("ascii")}
    return {"type": "text", "value": str(val)}


def _decode_cell(cell: dict) -> Any:
    t = cell.get("type")
    if t == "null" or t is None:
        return None
    if t == "integer":
        return int(cell["value"])
    if t == "float":
        return float(cell["value"])
    if t == "blob":
        return base64.b64decode(cell.get("base64", ""))
    return cell.get("value")


class TursoRow:
    """Drop-in replacement for sqlite3.Row supporting index, key, .keys(), and dict(row)."""

    def __init__(self, cols: list[str], vals: list[Any]):
        self._cols = cols
        self._vals = vals
        self._map = {c: v for c, v in zip(cols, vals)}

    def __getitem__(self, key):
        if isinstance(key, (int, slice)):
            return self._vals[key]
        return self._map[key]

    def __len__(self) -> int:
        return len(self._vals)

    def __iter__(self):
        return iter(self._vals)

    def keys(self) -> list[str]:
        return list(self._cols)

    def __contains__(self, key: str) -> bool:
        return key in self._map

    def __repr__(self) -> str:
        return f"TursoRow({self._map!r})"


class TursoCursor:
    def __init__(self, rows: list[TursoRow], lastrowid: int | None = None, rowcount: int = 0):
        self._rows = rows
        self._idx = 0
        self.lastrowid = lastrowid
        self.rowcount = rowcount

    def fetchone(self) -> TursoRow | None:
        if self._idx >= len(self._rows):
            return None
        r = self._rows[self._idx]
        self._idx += 1
        return r

    def fetchall(self) -> list[TursoRow]:
        rem = self._rows[self._idx:]
        self._idx = len(self._rows)
        return rem

    def __iter__(self):
        return iter(self._rows)


class TursoConn:
    """sqlite3-compatible connection backed by Turso HTTP /v2/pipeline."""

    def __init__(self, base_url: str, auth_token: str, timeout: float = 20.0):
        url = base_url.strip().rstrip("/")
        if url.startswith("libsql://"):
            url = "https://" + url[len("libsql://"):]
        self.pipeline_url = url + "/v2/pipeline"
        self.auth_token = auth_token.strip()
        self.timeout = timeout
        self.baton: str | None = None
        self.in_tx: bool = False
        self.row_factory = sqlite3.Row

    def _post(self, requests_list: list[dict]) -> dict:
        payload: dict[str, Any] = {"requests": requests_list}
        if self.baton:
            payload["baton"] = self.baton
        req = urllib.request.Request(
            self.pipeline_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json",
                "User-Agent": "PrimeSteel-Turso/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            if "baton" in err_body.lower() and self.baton:
                self.baton = None
            raise sqlite3.OperationalError(f"Turso HTTP {exc.code}: {err_body[:300]}") from exc
        except Exception as exc:
            raise sqlite3.OperationalError(f"Turso connection error: {exc}") from exc

        if "baton" in data:
            self.baton = data["baton"]
        return data

    def _raise_for_result(self, res: dict) -> dict:
        if res.get("type") == "error":
            err = res.get("error") or {}
            msg = err.get("message") or str(err)
            code = (err.get("code") or "").upper()
            if "CONSTRAINT" in code or "UNIQUE" in msg.upper() or "FOREIGN KEY" in msg.upper():
                raise sqlite3.IntegrityError(msg)
            raise sqlite3.OperationalError(msg)
        return res.get("response", {}).get("result", {})

    def execute(self, sql: str, params: tuple | list = ()) -> TursoCursor:
        clean_sql = sql.strip()
        upper = clean_sql.upper()
        if upper.startswith("BEGIN IMMEDIATE") or upper.startswith("BEGIN EXCLUSIVE"):
            clean_sql = "BEGIN"
            upper = "BEGIN"
        if upper == "BEGIN":
            self.in_tx = True

        stmt: dict[str, Any] = {"sql": clean_sql}
        if params:
            stmt["args"] = [_encode_arg(p) for p in params]

        data = self._post([{"type": "execute", "stmt": stmt}])
        results = data.get("results") or []
        if not results:
            return TursoCursor([])
        res = self._raise_for_result(results[0])
        cols = [c.get("name", f"col{i}") for i, c in enumerate(res.get("cols") or [])]
        raw_rows = res.get("rows") or []
        rows = [TursoRow(cols, [_decode_cell(cell) for cell in r]) for r in raw_rows]
        lastrowid = res.get("last_insert_rowid")
        if lastrowid is not None:
            try:
                lastrowid = int(lastrowid)
            except (TypeError, ValueError):
                pass
        rowcount = int(res.get("affected_row_count") or 0)
        return TursoCursor(rows, lastrowid=lastrowid, rowcount=rowcount)

    def executescript(self, script: str) -> None:
        # Strip -- line comments and split on ;
        lines = []
        for line in script.splitlines():
            stripped = line.strip()
            if stripped.startswith("--"):
                continue
            lines.append(line)
        cleaned = "\n".join(lines)
        stmts = [
            s.strip() for s in cleaned.split(";")
            if s.strip() and not s.strip().upper().startswith("PRAGMA JOURNAL_MODE")
        ]
        if not stmts:
            return
        reqs = [{"type": "execute", "stmt": {"sql": s}} for s in stmts]
        data = self._post(reqs)
        for r in data.get("results") or []:
            self._raise_for_result(r)

    def commit(self) -> None:
        if self.in_tx and self.baton:
            try:
                data = self._post([{"type": "execute", "stmt": {"sql": "COMMIT"}}])
                for r in data.get("results") or []:
                    self._raise_for_result(r)
            finally:
                self.in_tx = False

    def rollback(self) -> None:
        if self.in_tx and self.baton:
            try:
                self._post([{"type": "execute", "stmt": {"sql": "ROLLBACK"}}])
            except Exception:
                pass
            finally:
                self.in_tx = False

    def close(self) -> None:
        if self.baton:
            try:
                self._post([{"type": "close"}])
            except Exception:
                pass
            finally:
                self.baton = None
                self.in_tx = False
