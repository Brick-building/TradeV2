# Kalshi Trader

Algorithmic trading system for Kalshi prediction markets.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Docker Compose                                      │
│                                                      │
│  ┌──────────────┐   ┌──────────┐   ┌─────────────┐ │
│  │  Frontend    │   │ Backend  │   │  Postgres   │ │
│  │  React+Vite  │──▶│ FastAPI  │──▶│  decisions  │ │
│  │  :3000       │   │  :8000   │   │  strategies │ │
│  └──────────────┘   └────┬─────┘   └─────────────┘ │
│                          │         ┌─────────────┐  │
│                          └────────▶│   Redis     │  │
│                          │         └─────────────┘  │
│                          │                           │
│                    APScheduler                       │
│                    runs strategies                   │
│                    on interval                       │
└─────────────────────────────────────────────────────┘
```

## Setup

### 1. Get Kalshi API credentials

- Go to https://kalshi.com/account/api (or demo.kalshi.com for testing)
- Generate a key pair — you'll get a Key ID and a PEM private key

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
POSTGRES_PASSWORD=your-secure-password
KALSHI_API_KEY_ID=your-key-id
KALSHI_API_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----
KALSHI_ENV=demo   # change to 'prod' for live trading
```

> **Note on KALSHI_API_KEY**: The PEM key can be multiline. In the `.env` file, 
> you can either use `\n` escapes on one line, or quote it with actual newlines.
> Alternatively, base64-encode it: `base64 -w0 your_key.pem`

### 3. Start

```bash
docker compose up --build
```

- Dashboard: http://localhost:3000
- API docs: http://localhost:8000/docs

## Strategies

### Built-in: `btc_15m_high_confidence`

**Logic**: When a BTC 15-minute market has less than 60 seconds remaining AND 
either the YES or NO price is ≥ 90¢, buy 5% of available cash.

**Config (editable in dashboard)**:
```json
{
  "market_series": "KXBTC",
  "interval_minutes": 15,
  "min_price_threshold": 0.90,
  "max_seconds_remaining": 60,
  "position_pct": 0.05
}
```

### Adding a new strategy

1. Create `backend/strategies/my_strategy.py`:

```python
from strategies.base import BaseStrategy, TradeSignal, register
from core.kalshi import kalshi_client

@register
class MyStrategy(BaseStrategy):
    name = "my_strategy"
    poll_interval_seconds = 30

    def __init__(self, db_config):
        super().__init__(db_config)
        # extract your config keys here

    async def evaluate(self) -> TradeSignal:
        try:
            # your logic here
            return TradeSignal(action="skip", reason="conditions not met")
        except Exception as e:
            return TradeSignal(action="error", reason=str(e))
```

2. Add import to `backend/strategies/__init__.py`:
```python
from strategies import my_strategy  # noqa
```

3. Add a row in the dashboard (Strategies tab → ADD STRATEGY)
   - Name must exactly match `name` in your class

That's it — the engine will schedule and run it automatically.

## Database

All decisions are logged to the `decisions` table with full context:
- `action`: buy / skip / error
- `contract_price`: price at time of decision
- `time_remaining_seconds`: market time left
- `portfolio_cash`: cash at time of decision
- `position_size`: dollar size of position taken
- `params`: full strategy config snapshot

Query decisions:
```bash
docker exec -it kalshi-trader-postgres-1 psql -U trader -d kalshi_trader
SELECT action, count(*) FROM decisions GROUP BY action;
SELECT * FROM decisions WHERE action='buy' ORDER BY created_at DESC LIMIT 10;
```

## Development

Backend hot-reloads automatically. Frontend:
```bash
cd frontend && npm install && npm run dev
```

Then update `vite.config.js` proxy target to `http://localhost:8000`.
