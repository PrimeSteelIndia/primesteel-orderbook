"""Zero-dependency Turso (libSQL) HTTP /v2/pipeline driver compatible with sqlite3.Row usage.

Uses per-thread persistent HTTPS keep-alive connections and pipelines PRAGMA + close
in a single HTTP roundtrip to keep cloud queries fast.
"""
from __future__ import annotations

import base64
import http.client
import json
import math
import sqlite3
import ssl
import threading
from typing import Any
from urllib.parse import urlparse


_TLS_LOCAL = threading.local()
_SSL_CTX = ssl.create_default_context()


def _get_https_conn(host: str, port: int | None, timeout: float) -> http.client.HTTPSConnection:
    cache = getattr(_TLS_LOCAL, "conns", None)
    if cache is None:
        cache = {}
        _TLS_LOCAL.conns = cache
    key = (host, port or 443)
    conn = cache.get(key)
    if conn is None:
        conn = http.client.HTTPSConnection(host, port or 443, timeout=timeout, context=_SSL_CTX)
        cache[key] = conn
    return conn


def _reset_https_conn(host: str, port: int | None) -> None:
    cache = getattr(_TLS_LOCAL, "conns", None)
    if not cache:
        return
    key = (host, port or 443)
    conn = cache.pop(key, None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


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
    """sqlite3-compatible connection backed by Turso HTTP /v2/pipeline with keep-alive."""

    def __init__(self, base_url: str, auth_token: str, timeout: float = 20.0):
        url = base_url.strip().rstrip("/")
        if url.startswith("libsql://"):
            url = "https://" + url[len("libsql://"):]
        parsed = urlparse(url)
        self.host = parsed.hostname or ""
        self.port = parsed.port
        self.pipeline_path = (parsed.path.rstrip("/") or "") + "/v2/pipeline"
        self.auth_token = auth_token.strip()
        self.timeout = timeout
        self.baton: str | None = None
        self.in_tx: bool = False
        self._pending_pragmas: list[str] = []
        self.row_factory = sqlite3.Row

    def _post(self, requests_list: list[dict]) -> dict:
        payload: dict[str, Any] = {"requests": requests_list}
        if self.baton:
            payload["baton"] = self.baton
        body_bytes = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json",
            "Connection": "keep-alive",
            "User-Agent": "PrimeSteel-Turso/1.1",
        }

        last_exc: Exception | None = None
        for attempt in range(2):
            conn = _get_https_conn(self.host, self.port, self.timeout)
            try:
                conn.request("POST", self.pipeline_path, body=body_bytes, headers=headers)
                resp = conn.getresponse()
                raw = resp.read()
                if resp.status >= 400:
                    err_body = raw.decode("utf-8", errors="replace")
                    if "baton" in err_body.lower() and self.baton:
                        self.baton = None
                    raise sqlite3.OperationalError(f"Turso HTTP {resp.status}: {err_body[:300]}")
                data = json.loads(raw.decode("utf-8"))
                if "baton" in data:
                    self.baton = data["baton"]
                return data
            except sqlite3.OperationalError:
                raise
            except (http.client.HTTPException, OSError, TimeoutError) as exc:
                last_exc = exc
                _reset_https_conn(self.host, self.port)
                if attempt == 0 and not self.baton:
                    continue
                raise sqlite3.OperationalError(f"Turso connection error: {exc}") from exc
            except Exception as exc:
                _reset_https_conn(self.host, self.port)
                raise sqlite3.OperationalError(f"Turso connection error: {exc}") from exc
        raise sqlite3.OperationalError(f"Turso connection error: {last_exc}")

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

        # Defer standalone PRAGMA foreign_keys = ON so it rides free with the next query
        if upper.startswith("PRAGMA FOREIGN_KEYS"):
            self._pending_pragmas.append(clean_sql)
            return TursoCursor([])

        if upper.startswith("BEGIN IMMEDIATE") or upper.startswith("BEGIN EXCLUSIVE"):
            clean_sql = "BEGIN"
            upper = "BEGIN"
        if upper == "BEGIN":
            self.in_tx = True

        reqs: list[dict] = []
        if self._pending_pragmas:
            for p_sql in self._pending_pragmas:
                reqs.append({"type": "execute", "stmt": {"sql": p_sql}})
            self._pending_pragmas.clear()

        stmt: dict[str, Any] = {"sql": clean_sql}
        if params:
            stmt["args"] = [_encode_arg(p) for p in params]
        main_idx = len(reqs)
        reqs.append({"type": "execute", "stmt": stmt})

        # Single-shot queries outside a transaction close in the same HTTP call
        if not self.in_tx and not self.baton:
            reqs.append({"type": "close"})

        data = self._post(reqs)
        if not self.in_tx and reqs[-1].get("type") == "close":
            self.baton = None

        results = data.get("results") or []
        if len(results) <= main_idx:
            return TursoCursor([])
        for i, r in enumerate(results):
            if r.get("type") == "error":
                self._raise_for_result(r)
        res = self._raise_for_result(results[main_idx])
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
                data = self._post([
                    {"type": "execute", "stmt": {"sql": "COMMIT"}},
                    {"type": "close"},
                ])
                for r in data.get("results") or []:
                    self._raise_for_result(r)
            finally:
                self.in_tx = False
                self.baton = None

    def rollback(self) -> None:
        if self.in_tx and self.baton:
            try:
                self._post([
                    {"type": "execute", "stmt": {"sql": "ROLLBACK"}},
                    {"type": "close"},
                ])
            except Exception:
                pass
            finally:
                self.in_tx = False
                self.baton = None

    def close(self) -> None:
        self._pending_pragmas.clear()
        if self.baton:
            try:
                self._post([{"type": "close"}])
            except Exception:
                pass
            finally:
                self.baton = None
                self.in_tx = False
