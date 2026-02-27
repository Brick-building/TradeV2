"""
Strategy base class and registry.

To add a new strategy:
1. Create a new file in strategies/
2. Subclass BaseStrategy
3. Import it in strategies/__init__.py

The scheduler will automatically discover and run all registered strategies.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class TradeSignal:
    """What a strategy decided to do."""
    action: str  # 'buy' | 'skip' | 'error'
    side: Optional[str] = None  # 'yes' | 'no'
    market_ticker: Optional[str] = None
    contract_price: Optional[float] = None
    time_remaining_seconds: Optional[int] = None
    portfolio_cash: Optional[float] = None
    position_size: Optional[float] = None
    contracts: Optional[int] = None
    reason: str = ""
    params: dict = None

    def __post_init__(self):
        if self.params is None:
            self.params = {}


class BaseStrategy(ABC):
    """
    All trading strategies inherit from this class.

    The scheduler calls evaluate() on every enabled strategy
    at the configured poll interval. If evaluate() returns a
    TradeSignal with action='buy', the engine will place the order
    and log the decision. 'skip' signals are still logged so you
    can audit why trades were passed.
    """

    #: Unique name — must match the strategies.name column
    name: str = ""
    #: How often to poll in seconds
    poll_interval_seconds: int = 15

    def __init__(self, db_config: dict):
        """
        db_config is the strategies.config JSONB column parsed as a dict.
        Override __init__ to extract the params you need.
        """
        self.config = db_config

    @abstractmethod
    async def evaluate(self) -> TradeSignal:
        """
        Inspect the market and return a TradeSignal.
        Must not raise — catch all exceptions and return action='error'.
        """
        ...

    def log(self, msg: str):
        logger.info(f"[{self.name}] {msg}")


# Registry: name -> class
_REGISTRY: dict[str, type[BaseStrategy]] = {}


def register(cls: type[BaseStrategy]) -> type[BaseStrategy]:
    """Decorator to register a strategy class."""
    _REGISTRY[cls.name] = cls
    return cls


def get_strategy_class(name: str) -> Optional[type[BaseStrategy]]:
    return _REGISTRY.get(name)


def all_registered() -> dict[str, type[BaseStrategy]]:
    return dict(_REGISTRY)
