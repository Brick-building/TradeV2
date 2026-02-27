"""
Kalshi REST API client.
Uses RSA key-based auth as required by Kalshi's v2 API.

Tracks per-endpoint call counts and latency in memory.
Also caches the last observed market state for dashboard display.
"""
import time
import base64
import httpx
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from core.config import settings


# ── In-memory stats ───────────────────────────────────────────────────────────

class ApiStats:
    def __init__(self):
        # {endpoint_label: {"calls": int, "errors": int, "total_ms": float}}
        self._data: dict[str, dict] = defaultdict(lambda: {"calls": 0, "errors": 0, "total_ms": 0.0})
        self.started_at = datetime.now(timezone.utc)

    def record(self, label: str, elapsed_ms: float, error: bool = False):
        self._data[label]["calls"] += 1
        self._data[label]["total_ms"] += elapsed_ms
        if error:
            self._data[label]["errors"] += 1

    def summary(self) -> list[dict]:
        rows = []
        for label, d in sorted(self._data.items()):
            calls = d["calls"]
            rows.append({
                "endpoint": label,
                "calls": calls,
                "errors": d["errors"],
                "avg_ms": round(d["total_ms"] / calls, 1) if calls else 0,
                "total_ms": round(d["total_ms"], 1),
            })
        return rows

    def totals(self) -> dict:
        total_calls = sum(d["calls"] for d in self._data.values())
        total_errors = sum(d["errors"] for d in self._data.values())
        uptime_s = (datetime.now(timezone.utc) - self.started_at).total_seconds()
        return {
            "total_calls": total_calls,
            "total_errors": total_errors,
            "calls_per_minute": round(total_calls / (uptime_s / 60), 2) if uptime_s > 0 else 0,
            "uptime_seconds": int(uptime_s),
        }


api_stats = ApiStats()


# ── Last market state cache ───────────────────────────────────────────────────

class MarketState:
    """Holds the most recently observed market snapshot from strategy polls."""
    def __init__(self):
        self.ticker: Optional[str] = None
        self.title: Optional[str] = None
        self.yes_price: Optional[float] = None
        self.no_price: Optional[float] = None
        self.close_time: Optional[str] = None
        self.seconds_remaining: Optional[int] = None
        self.checked_at: Optional[str] = None

    def update(self, ticker, title, yes_price, no_price, close_time, seconds_remaining):
        self.ticker = ticker
        self.title = title
        self.yes_price = yes_price
        self.no_price = no_price
        self.close_time = close_time
        self.seconds_remaining = seconds_remaining
        self.checked_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "title": self.title,
            "yes_price": self.yes_price,
            "no_price": self.no_price,
            "close_time": self.close_time,
            "seconds_remaining": self.seconds_remaining,
            "checked_at": self.checked_at,
        }


market_state = MarketState()


# ── Client ────────────────────────────────────────────────────────────────────

class KalshiClient:
    def __init__(self):
        self.base_url = settings.kalshi_base_url
        self.key_id = settings.kalshi_api_key_id
        self._private_key_pem = settings.kalshi_api_key
        self._private_key = None
        self._load_key()

    def _load_key(self):
        if not self._private_key_pem:
            return
        try:
            key_bytes = self._private_key_pem.encode()
            if not key_bytes.startswith(b"-----"):
                key_bytes = base64.b64decode(key_bytes)
            self._private_key = serialization.load_pem_private_key(key_bytes, password=None)
        except Exception as e:
            print(f"[KalshiClient] Failed to load private key: {e}")

    def _sign(self, method: str, path: str, body: str = "") -> dict:
        ts = str(int(time.time() * 1000))
        path_without_query = path.split("?")[0]
        msg = ts + method.upper() + path_without_query + body
        if self._private_key is None:
            return {}
        sig = self._private_key.sign(msg.encode(), padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH), hashes.SHA256())
        return {
            "KALSHI-ACCESS-KEY": self.key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": base64.b64encode(sig).decode(),
        }

    async def _get(self, label: str, path: str) -> dict:
        headers = self._sign("GET", f"/trade-api/v2{path}")
        t0 = time.monotonic()
        error = False
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get(f"{self.base_url}{path}", headers=headers, timeout=10)
                r.raise_for_status()
                return r.json()
        except Exception as e:
            error = True
            raise
        finally:
            api_stats.record(label, (time.monotonic() - t0) * 1000, error=error)

    async def get_markets(self, series_ticker: str, status: str = "open") -> list[dict]:
        path = f"/markets?series_ticker={series_ticker}&status={status}&limit=20"
        data = await self._get("GET /markets", path)
        return data.get("markets", [])

    async def get_market(self, ticker: str) -> dict:
        data = await self._get("GET /markets/{ticker}", f"/markets/{ticker}")
        return data.get("market", {})

    async def get_balance(self) -> dict:
        return await self._get("GET /portfolio/balance", "/portfolio/balance")

    async def get_positions(self) -> list[dict]:
        data = await self._get("GET /portfolio/positions", "/portfolio/positions")
        return data.get("market_positions", [])

    async def place_order(
        self,
        ticker: str,
        side: str,
        count: int,
        price_cents: int,
        action: str = "buy",
        order_type: str = "limit",
    ) -> dict:
        import json
        path = "/portfolio/orders"
        body_dict = {
            "ticker": ticker,
            "action": action,
            "side": side,
            "count": count,
            "type": order_type,
            "yes_price": price_cents if side == "yes" else 100 - price_cents,
            "no_price": price_cents if side == "no" else 100 - price_cents,
        }
        body = json.dumps(body_dict)
        headers = {**self._sign("POST", f"/trade-api/v2{path}", body), "Content-Type": "application/json"}
        t0 = time.monotonic()
        error = False
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(f"{self.base_url}{path}", content=body, headers=headers, timeout=10)
                r.raise_for_status()
                return r.json()
        except Exception as e:
            error = True
            raise
        finally:
            api_stats.record("POST /portfolio/orders", (time.monotonic() - t0) * 1000, error=error)


kalshi_client = KalshiClient()