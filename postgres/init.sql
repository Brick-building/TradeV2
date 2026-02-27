-- Strategies registry
CREATE TABLE IF NOT EXISTS strategies (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- All trade decisions (logged regardless of execution)
CREATE TABLE IF NOT EXISTS decisions (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id),
    market_ticker TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
    action TEXT NOT NULL CHECK (action IN ('buy', 'skip', 'error')),
    reason TEXT,
    contract_price NUMERIC(10,4),
    time_remaining_seconds INTEGER,
    portfolio_cash NUMERIC(14,2),
    position_size NUMERIC(14,2),
    contracts INTEGER,
    order_id TEXT,
    params JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Portfolio snapshots for charting
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id SERIAL PRIMARY KEY,
    cash NUMERIC(14,2),
    positions_value NUMERIC(14,2),
    total_value NUMERIC(14,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the BTC 15m strategy
INSERT INTO strategies (name, description, enabled, config) VALUES (
    'btc_15m_high_confidence',
    'Buy BTC 15-minute contracts when < 1 min remaining and price ≥ 0.90',
    true,
    '{
        "market_series": "KXBTC",
        "interval_minutes": 15,
        "min_price_threshold": 0.90,
        "max_seconds_remaining": 60,
        "position_pct": 0.05
    }'
) ON CONFLICT (name) DO NOTHING;
