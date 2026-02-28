"""
BTC 15-Minute High-Confidence Strategy
=======================================
Config keys (set in strategies.config JSONB):
    market_series       str     Kalshi series ticker, e.g. "KXBTC"
    interval_minutes    int     15
    min_price_threshold float   0.90  (90 cents)
    max_seconds_remaining int   60
    position_pct        float   0.05  (5% of cash)
"""
from datetime import datetime, timezone
from strategies.base import BaseStrategy, TradeSignal, register
from core.kalshi import kalshi_client, market_state
import math


@register
class BTC15mHighConfidence(BaseStrategy):
    name = "btc_15m_high_confidence"
    poll_interval_seconds = 10

    def __init__(self, db_config: dict):
        super().__init__(db_config)
        self.series = db_config.get("market_series", "KXBTC")
        self.interval = db_config.get("interval_minutes", 15)
        self.threshold = float(db_config.get("min_price_threshold", 0.90))
        self.max_seconds = int(db_config.get("max_seconds_remaining", 60))
        self.position_pct = float(db_config.get("position_pct", 0.05))

    async def evaluate(self) -> TradeSignal:
        try:
            markets = await kalshi_client.get_markets(self.series, status="open")
            if not markets:
                return TradeSignal(action="skip", reason="No open markets found")

            target = self._find_target_market(markets)
            if not target:
                return TradeSignal(
                    action="skip",
                    reason=f"No {self.interval}-min market found in open markets"
                )

            ticker = target["ticker"]
            title = target.get("title") or target.get("subtitle") or ticker
            close_time = self._parse_time(target.get("close_time") or target.get("expiration_time"))
            if close_time is None:
                return TradeSignal(action="skip", reason="Could not parse market close time")

            now = datetime.now(timezone.utc)
            seconds_remaining = int((close_time - now).total_seconds())

            # Fetch current prices
            detail = await kalshi_client.get_market(ticker)
            yes_price = (detail.get("yes_ask") or detail.get("yes_bid") or 0) / 100
            no_price = (detail.get("no_ask") or detail.get("no_bid") or 0) / 100

            # Update shared market state for dashboard
            market_state.update(
                ticker=ticker,
                title=title,
                yes_price=yes_price,
                no_price=no_price,
                close_time=close_time.isoformat(),
                seconds_remaining=seconds_remaining,
            )

            self.log(f"{ticker} | yes={yes_price:.2f} no={no_price:.2f} | {seconds_remaining}s left")

            if seconds_remaining > self.max_seconds or seconds_remaining < 0:
                return TradeSignal(
                    action="skip",
                    market_ticker=ticker,
                    time_remaining_seconds=seconds_remaining,
                    reason=f"Time remaining {seconds_remaining}s outside window [0, {self.max_seconds}]"
                )

            side = None
            price = None
            if yes_price >= self.threshold:
                side, price = "yes", yes_price
            elif no_price >= self.threshold:
                side, price = "no", no_price

            if side is None:
                return TradeSignal(
                    action="skip",
                    market_ticker=ticker,
                    contract_price=max(yes_price, no_price),
                    time_remaining_seconds=seconds_remaining,
                    reason=f"Neither side meets threshold (yes={yes_price:.2f}, no={no_price:.2f} < {self.threshold})"
                )

            balance = await kalshi_client.get_balance()
            cash_cents = balance.get("balance", 0)
            cash = cash_cents / 100
            spend = cash * self.position_pct
            price_cents = round(price * 100)
            contracts = max(1, math.floor((spend * 100) / price_cents))

            return TradeSignal(
                action="buy",
                side=side,
                market_ticker=ticker,
                contract_price=price,
                time_remaining_seconds=seconds_remaining,
                portfolio_cash=cash,
                position_size=round((contracts * price_cents) / 100, 2),
                contracts=contracts,
                reason=f"{side.upper()} @ {price:.2f} with {seconds_remaining}s remaining",
                params={
                    "price_cents": price_cents,
                    "threshold": self.threshold,
                    "position_pct": self.position_pct,
                }
            )

        except Exception as e:
            self.log(f"ERROR: {e}")
            return TradeSignal(action="error", reason=str(e))

    def _find_target_market(self, markets: list[dict]) -> dict | None:
        now = datetime.now(timezone.utc)
        candidates = []
        for m in markets:
            close = self._parse_time(m.get("close_time") or m.get("expiration_time"))
            if close:
                delta = (close - now).total_seconds()
                if 0 < delta <= self.interval * 60 + 30:
                    candidates.append((delta, m))

        if not candidates:
            for m in markets:
                close = self._parse_time(m.get("close_time") or m.get("expiration_time"))
                if close:
                    delta = (close - now).total_seconds()
                    if delta > 0:
                        candidates.append((delta, m))

        if not candidates:
            return None
        candidates.sort(key=lambda x: x[0])
        return candidates[0][1]

    @staticmethod
    def _parse_time(ts: str | None) -> datetime | None:
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            return None
