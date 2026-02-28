from sqlalchemy import Column, Integer, Text, Boolean, Numeric, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from core.database import Base


class Strategy(Base):
    __tablename__ = "strategies"
    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False, unique=True)
    description = Column(Text)
    enabled = Column(Boolean, nullable=False, default=True)
    config = Column(JSONB, nullable=False, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Decision(Base):
    __tablename__ = "decisions"
    id = Column(Integer, primary_key=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"))
    market_ticker = Column(Text, nullable=False)
    side = Column(Text, nullable=False)
    action = Column(Text, nullable=False)
    reason = Column(Text)
    contract_price = Column(Numeric(10, 4))
    time_remaining_seconds = Column(Integer)
    portfolio_cash = Column(Numeric(14, 2))
    position_size = Column(Numeric(14, 2))
    contracts = Column(Integer)
    order_id = Column(Text)
    params = Column(JSONB, nullable=False, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"
    id = Column(Integer, primary_key=True)
    cash = Column(Numeric(14, 2))
    positions_value = Column(Numeric(14, 2))
    total_value = Column(Numeric(14, 2))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
