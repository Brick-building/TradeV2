"""
Kalshi REST API client.
Uses RSA key-based auth as required by Kalshi's v2 API.
"""
import time
import base64
import hashlib
import httpx
from typing import Optional
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from core.config import settings


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
            # Support base64-encoded key in env var
            if not key_bytes.startswith(b"-----"):
                key_bytes = base64.b64decode(key_bytes)
            self._private_key = serialization.load_pem_private_key(key_bytes, password=None)
        except Exception as e:
            print(f"[KalshiClient] Failed to load private key: {e}")

    def _sign(self, method: str, path: str, body: str = "") -> dict:
        """Generate Kalshi HMAC-style RSA signature headers."""
        ts = str(int(time.time() * 1000))
        msg = ts + method.upper() + path + body
        if self._private_key is None:
            return {}
        sig = self._private_key.sign(msg.encode(), padding.PKCS1v15(), hashes.SHA256())
        return {
            "KALSHI-ACCESS-KEY": self.key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": base64.b64encode(sig).decode(),
        }

    async def get_markets(self, series_ticker: str, status: str = "open") -> list[dict]:
        path = f"/markets?series_ticker={series_ticker}&status={status}&limit=20"
        headers = self._sign("GET", f"/trade-api/v2{path}")
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{self.base_url}{path}", headers=headers, timeout=10)
            r.raise_for_status()
            return r.json().get("markets", [])

    async def get_market(self, ticker: str) -> dict:
        path = f"/markets/{ticker}"
        headers = self._sign("GET", f"/trade-api/v2{path}")
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{self.base_url}{path}", headers=headers, timeout=10)
            r.raise_for_status()
            return r.json().get("market", {})

    async def get_balance(self) -> dict:
        path = "/portfolio/balance"
        headers = self._sign("GET", f"/trade-api/v2{path}")
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{self.base_url}{path}", headers=headers, timeout=10)
            r.raise_for_status()
            return r.json()

    async def place_order(
        self,
        ticker: str,
        side: str,
        count: int,
        price_cents: int,
        action: str = "buy",
        order_type: str = "limit",
    ) -> dict:
        path = "/portfolio/orders"
        import json
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
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{self.base_url}{path}", content=body, headers=headers, timeout=10)
            r.raise_for_status()
            return r.json()

    async def get_positions(self) -> list[dict]:
        path = "/portfolio/positions"
        headers = self._sign("GET", f"/trade-api/v2{path}")
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{self.base_url}{path}", headers=headers, timeout=10)
            r.raise_for_status()
            return r.json().get("market_positions", [])


kalshi_client = KalshiClient()
