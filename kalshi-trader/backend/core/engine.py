"""
Trading Engine
==============
Loads enabled strategies from DB, instantiates the matching Python class,
and schedules them to run at their poll_interval_seconds.

Trade flow:
  evaluate() → TradeSignal → place_order() → log Decision → snapshot portfolio
"""
import logging
import asyncio
from sqlalchemy import select
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from core.database import AsyncSessionLocal
from core.kalshi import kalshi_client
from models.db import Strategy, Decision, PortfolioSnapshot
from strategies.base import get_strategy_class, TradeSignal
import strategies  # noqa — triggers all @register decorators

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


async def run_strategy(strategy_id: int, strategy_name: str, config: dict):
    """Called by APScheduler for each enabled strategy."""
    cls = get_strategy_class(strategy_name)
    if cls is None:
        logger.warning(f"No Python class registered for strategy '{strategy_name}'")
        return

    instance = cls(config)
    signal: TradeSignal = await instance.evaluate()

    order_id = None
    if signal.action == "buy":
        try:
            resp = await kalshi_client.place_order(
                ticker=signal.market_ticker,
                side=signal.side,
                count=signal.contracts,
                price_cents=signal.params.get("price_cents", round(signal.contract_price * 100)),
            )
            order_id = resp.get("order", {}).get("order_id")
            logger.info(f"[{strategy_name}] Order placed: {order_id}")
        except Exception as e:
            logger.error(f"[{strategy_name}] Order failed: {e}")
            signal.action = "error"
            signal.reason = f"Order placement failed: {e}"

    async with AsyncSessionLocal() as db:
        db.add(Decision(
            strategy_id=strategy_id,
            market_ticker=signal.market_ticker or "",
            side=signal.side or "unknown",
            action=signal.action,
            reason=signal.reason,
            contract_price=signal.contract_price,
            time_remaining_seconds=signal.time_remaining_seconds,
            portfolio_cash=signal.portfolio_cash,
            position_size=signal.position_size,
            contracts=signal.contracts,
            order_id=order_id,
            params=signal.params or {},
        ))
        await db.commit()


async def snapshot_portfolio():
    """Record portfolio value every minute."""
    try:
        balance = await kalshi_client.get_balance()
        cash = (balance.get("balance", 0)) / 100
        positions = await kalshi_client.get_positions()
        pos_value = sum(
            (p.get("market_exposure") or 0) / 100
            for p in positions
        )
        async with AsyncSessionLocal() as db:
            db.add(PortfolioSnapshot(
                cash=cash,
                positions_value=pos_value,
                total_value=cash + pos_value,
            ))
            await db.commit()
    except Exception as e:
        logger.error(f"Portfolio snapshot failed: {e}")


async def load_and_schedule_strategies():
    """Pull enabled strategies from DB and schedule them."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Strategy).where(Strategy.enabled == True))  # noqa: E712
        rows = result.scalars().all()

    for row in rows:
        cls = get_strategy_class(row.name)
        if cls is None:
            logger.warning(f"Strategy '{row.name}' in DB has no registered Python class. Skipping.")
            continue
        interval = getattr(cls, "poll_interval_seconds", 15)
        job_id = f"strategy_{row.id}"
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)
        scheduler.add_job(
            run_strategy,
            "interval",
            seconds=interval,
            id=job_id,
            args=[row.id, row.name, row.config],
            max_instances=1,
            coalesce=True,
        )
        logger.info(f"Scheduled strategy '{row.name}' every {interval}s")

    # Portfolio snapshot every 60s
    if not scheduler.get_job("portfolio_snapshot"):
        scheduler.add_job(snapshot_portfolio, "interval", seconds=60, id="portfolio_snapshot")


async def start_engine():
    await load_and_schedule_strategies()
    scheduler.start()
    logger.info("Trading engine started")


async def stop_engine():
    scheduler.shutdown(wait=False)
