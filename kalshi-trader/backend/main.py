import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from pydantic import BaseModel
from typing import Optional
import json

from core.database import get_db, engine
from core.engine import start_engine, stop_engine, load_and_schedule_strategies
from core.kalshi import kalshi_client
from models.db import Strategy, Decision, PortfolioSnapshot, Base
from strategies.base import all_registered

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await start_engine()
    yield
    await stop_engine()


app = FastAPI(title="Kalshi Trader", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ──────────────────────────────────────────────────────────────────

class StrategyUpdate(BaseModel):
    enabled: Optional[bool] = None
    config: Optional[dict] = None
    description: Optional[str] = None


class StrategyCreate(BaseModel):
    name: str
    description: str = ""
    enabled: bool = True
    config: dict = {}


# ── Portfolio ─────────────────────────────────────────────────────────────────

@app.get("/api/portfolio")
async def get_portfolio():
    """Live balance + positions from Kalshi."""
    try:
        balance = await kalshi_client.get_balance()
        positions = await kalshi_client.get_positions()
        return {"balance": balance, "positions": positions}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/portfolio/history")
async def get_portfolio_history(limit: int = 120, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PortfolioSnapshot).order_by(desc(PortfolioSnapshot.created_at)).limit(limit)
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "cash": float(r.cash or 0),
            "positions_value": float(r.positions_value or 0),
            "total_value": float(r.total_value or 0),
            "created_at": r.created_at.isoformat(),
        }
        for r in reversed(rows)
    ]


# ── Strategies ────────────────────────────────────────────────────────────────

@app.get("/api/strategies")
async def list_strategies(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Strategy).order_by(Strategy.id))
    rows = result.scalars().all()
    registered = all_registered()
    return [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "enabled": r.enabled,
            "config": r.config,
            "has_class": r.name in registered,
            "poll_interval_seconds": getattr(registered.get(r.name), "poll_interval_seconds", None),
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@app.patch("/api/strategies/{strategy_id}")
async def update_strategy(strategy_id: int, body: StrategyUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Strategy).where(Strategy.id == strategy_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Strategy not found")
    if body.enabled is not None:
        row.enabled = body.enabled
    if body.config is not None:
        row.config = body.config
    if body.description is not None:
        row.description = body.description
    await db.commit()
    # Reschedule
    await load_and_schedule_strategies()
    return {"ok": True}


@app.post("/api/strategies")
async def create_strategy(body: StrategyCreate, db: AsyncSession = Depends(get_db)):
    s = Strategy(name=body.name, description=body.description, enabled=body.enabled, config=body.config)
    db.add(s)
    await db.commit()
    await load_and_schedule_strategies()
    return {"ok": True, "id": s.id}


# ── Decisions ─────────────────────────────────────────────────────────────────

@app.get("/api/decisions")
async def list_decisions(limit: int = 100, action: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    q = select(Decision).order_by(desc(Decision.created_at)).limit(limit)
    if action:
        q = q.where(Decision.action == action)
    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "strategy_id": r.strategy_id,
            "market_ticker": r.market_ticker,
            "side": r.side,
            "action": r.action,
            "reason": r.reason,
            "contract_price": float(r.contract_price) if r.contract_price else None,
            "time_remaining_seconds": r.time_remaining_seconds,
            "portfolio_cash": float(r.portfolio_cash) if r.portfolio_cash else None,
            "position_size": float(r.position_size) if r.position_size else None,
            "contracts": r.contracts,
            "order_id": r.order_id,
            "params": r.params,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@app.get("/api/decisions/stats")
async def decision_stats(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Decision.action, func.count(Decision.id)).group_by(Decision.action)
    )
    counts = {row[0]: row[1] for row in result.all()}
    return counts


# ── Markets ───────────────────────────────────────────────────────────────────

@app.get("/api/markets/{series}")
async def get_markets(series: str):
    try:
        markets = await kalshi_client.get_markets(series)
        return markets
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/market-state")
async def get_market_state():
    """Last observed market snapshot from the active strategy poll."""
    from core.kalshi import market_state
    return market_state.to_dict()


@app.get("/api/api-stats")
async def get_api_stats():
    """Kalshi API call counts, error rates, and avg latency per endpoint."""
    from core.kalshi import api_stats
    return {
        "totals": api_stats.totals(),
        "endpoints": api_stats.summary(),
    }
