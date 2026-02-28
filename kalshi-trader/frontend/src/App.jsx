import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Activity, Zap, Clock, ChevronDown, ChevronUp,
  Plus, RefreshCw, AlertTriangle, CheckCircle,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n) { return n == null ? '—' : `$${Number(n).toFixed(2)}` }
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
function fmtSeconds(s) {
  if (s == null) return '—'
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ── Shared UI Primitives ──────────────────────────────────────────────────────

function LiveDot({ active }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: active ? 'var(--green)' : 'var(--text3)',
      animation: active ? 'pulse-green 1.5s infinite' : 'none',
      boxShadow: active ? '0 0 6px var(--green)' : 'none',
    }} />
  )
}

function Label({ children }) {
  return (
    <span style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text3)', fontFamily: 'var(--cond)', textTransform: 'uppercase' }}>
      {children}
    </span>
  )
}

function Ticker({ label, value, sub, color, mono }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Label>{label}</Label>
      <span style={{
        fontSize: 22, fontFamily: mono ? 'var(--mono)' : 'var(--cond)',
        fontWeight: mono ? 400 : 700, color: color || 'var(--text)',
        letterSpacing: mono ? '0.02em' : '-0.01em',
      }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{sub}</span>}
    </div>
  )
}

function ActionBadge({ action }) {
  const map = {
    buy: { color: 'var(--green)', bg: 'var(--green-bg)', icon: <CheckCircle size={10} /> },
    skip: { color: 'var(--text3)', bg: 'transparent', icon: <Clock size={10} /> },
    error: { color: 'var(--red)', bg: 'var(--red-bg)', icon: <AlertTriangle size={10} /> },
  }
  const s = map[action] || map.skip
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.1em',
      color: s.color, background: s.bg, border: `1px solid ${s.color}33`,
      padding: '2px 6px', borderRadius: 1,
    }}>
      {s.icon}{action.toUpperCase()}
    </span>
  )
}

function SideIndicator({ side }) {
  if (!side || side === 'unknown') return <span style={{ color: 'var(--text3)' }}>—</span>
  return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: side === 'yes' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{side.toUpperCase()}</span>
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 11 }}>
      <div style={{ color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      {payload.map(p => <div key={p.dataKey} style={{ color: p.color }}>{p.name}: ${Number(p.value).toFixed(2)}</div>)}
    </div>
  )
}

// ── Market Monitor Widget ─────────────────────────────────────────────────────

function MarketMonitor({ state }) {
  if (!state?.ticker) {
    return (
      <div style={{ border: '1px solid var(--border)', background: 'var(--bg1)', padding: '16px 20px' }}>
        <Label>ACTIVE MARKET</Label>
        <div style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
          Waiting for first poll...
        </div>
      </div>
    )
  }

  const secsLeft = state.seconds_remaining
  const isHot = secsLeft != null && secsLeft <= 60 && secsLeft >= 0
  const yesHigh = state.yes_price >= 0.90
  const noHigh = state.no_price >= 0.90

  const priceBar = (label, price, highlight) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 6 }}>{label}</div>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 400,
        color: highlight ? (label === 'YES' ? 'var(--green)' : 'var(--red)') : 'var(--text)',
        textShadow: highlight ? `0 0 20px ${label === 'YES' ? 'var(--green)' : 'var(--red)'}` : 'none',
        transition: 'all 0.3s',
      }}>
        {price != null ? `${(price * 100).toFixed(0)}¢` : '—'}
      </div>
      {highlight && (
        <div style={{ fontSize: 9, color: label === 'YES' ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)', marginTop: 2, letterSpacing: '0.1em' }}>
          ▲ ABOVE THRESHOLD
        </div>
      )}
    </div>
  )

  return (
    <div style={{
      border: `1px solid ${isHot ? 'var(--yellow)' : 'var(--border)'}`,
      background: isHot ? 'rgba(255,204,0,0.03)' : 'var(--bg1)',
      transition: 'border-color 0.3s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LiveDot active={true} />
          <Label>ACTIVE MARKET</Label>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {isHot && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--yellow)', letterSpacing: '0.1em', animation: 'pulse-green 0.8s infinite' }}>
              ⚡ IN WINDOW
            </span>
          )}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
            checked {ago(state.checked_at)}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '14px 16px' }}>
        {/* Market name */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)', letterSpacing: '0.05em' }}>{state.ticker}</div>
          {state.title && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{state.title}</div>}
        </div>

        {/* Prices + Time */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {priceBar('YES', state.yes_price, yesHigh)}
          {priceBar('NO', state.no_price, noHigh)}

          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 24 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 6 }}>TIME LEFT</div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 28,
              color: isHot ? 'var(--yellow)' : secsLeft != null && secsLeft < 300 ? 'var(--text)' : 'var(--text2)',
              textShadow: isHot ? '0 0 20px var(--yellow)' : 'none',
              transition: 'all 0.3s',
            }}>
              {fmtSeconds(secsLeft)}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>
              closes {fmtTime(state.close_time)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── API Stats Widget ──────────────────────────────────────────────────────────

function ApiStatsWidget({ stats }) {
  if (!stats) return null
  const { totals, endpoints } = stats

  return (
    <div style={{ border: '1px solid var(--border)', background: 'var(--bg1)' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label>KALSHI API STATS</Label>
        <div style={{ display: 'flex', gap: 20 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)' }}>
            <span style={{ color: 'var(--text3)' }}>TOTAL </span>{totals?.total_calls ?? '—'}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)' }}>
            <span style={{ color: 'var(--text3)' }}>/MIN </span>{totals?.calls_per_minute ?? '—'}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: totals?.total_errors > 0 ? 'var(--red)' : 'var(--text3)' }}>
            <span style={{ color: 'var(--text3)' }}>ERRORS </span>{totals?.total_errors ?? 0}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
            UP {Math.floor((totals?.uptime_seconds ?? 0) / 60)}m
          </span>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['ENDPOINT', 'CALLS', 'ERRORS', 'AVG MS', 'TOTAL MS'].map(h => (
              <th key={h} style={{ padding: '7px 16px', textAlign: 'left', fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)', letterSpacing: '0.12em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(endpoints || []).map((e, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)22', background: i % 2 ? 'var(--bg2)22' : 'transparent' }}>
              <td style={{ padding: '7px 16px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--blue)' }}>{e.endpoint}</td>
              <td style={{ padding: '7px 16px', fontFamily: 'var(--mono)', fontSize: 11 }}>{e.calls}</td>
              <td style={{ padding: '7px 16px', fontFamily: 'var(--mono)', fontSize: 11, color: e.errors > 0 ? 'var(--red)' : 'var(--text3)' }}>{e.errors}</td>
              <td style={{ padding: '7px 16px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{e.avg_ms}ms</td>
              <td style={{ padding: '7px 16px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{e.total_ms}ms</td>
            </tr>
          ))}
          {(!endpoints || endpoints.length === 0) && (
            <tr>
              <td colSpan={5} style={{ padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>No calls recorded yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Strategy Card ─────────────────────────────────────────────────────────────

function StrategyCard({ strategy, onUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [configText, setConfigText] = useState(JSON.stringify(strategy.config, null, 2))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const toggle = async () => {
    setSaving(true)
    try { await api.updateStrategy(strategy.id, { enabled: !strategy.enabled }); onUpdate() }
    catch (e) { setErr(e.message) }
    setSaving(false)
  }

  const saveConfig = async () => {
    setSaving(true); setErr(null)
    try { await api.updateStrategy(strategy.id, { config: JSON.parse(configText) }); setEditing(false); onUpdate() }
    catch (e) { setErr(e.message) }
    setSaving(false)
  }

  const statusColor = strategy.enabled ? (strategy.has_class ? 'var(--green)' : 'var(--yellow)') : 'var(--text3)'

  return (
    <div style={{ border: `1px solid ${strategy.enabled ? 'var(--border-bright)' : 'var(--border)'}`, background: strategy.enabled ? 'var(--bg2)' : 'var(--bg1)', animation: 'slide-in 0.2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', borderBottom: expanded ? '1px solid var(--border)' : 'none' }} onClick={() => setExpanded(e => !e)}>
        <LiveDot active={strategy.enabled && strategy.has_class} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--cond)', fontWeight: 700, fontSize: 15, letterSpacing: '0.05em' }}>{strategy.name}</div>
          {strategy.description && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{strategy.description}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {strategy.poll_interval_seconds && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>/{strategy.poll_interval_seconds}s</span>}
          {!strategy.has_class && <span style={{ fontSize: 10, color: 'var(--yellow)', fontFamily: 'var(--mono)' }}>NO CLASS</span>}
          <button onClick={e => { e.stopPropagation(); toggle() }} style={{ padding: '3px 10px', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.1em', background: strategy.enabled ? 'var(--green-bg)' : 'var(--bg3)', color: statusColor, border: `1px solid ${statusColor}55`, borderRadius: 1 }}>
            {saving ? '...' : strategy.enabled ? 'ACTIVE' : 'DISABLED'}
          </button>
          {expanded ? <ChevronUp size={14} color="var(--text3)" /> : <ChevronDown size={14} color="var(--text3)" />}
        </div>
      </div>
      {expanded && (
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', letterSpacing: '0.1em' }}>CONFIG</span>
            <button onClick={() => setEditing(e => !e)} style={{ fontSize: 10, color: 'var(--blue)', background: 'none', padding: '2px 6px' }}>{editing ? 'CANCEL' : 'EDIT'}</button>
          </div>
          {editing ? (
            <div>
              <textarea value={configText} onChange={e => setConfigText(e.target.value)} rows={10} style={{ width: '100%', resize: 'vertical', fontSize: 12, lineHeight: 1.6 }} />
              {err && <div style={{ color: 'var(--red)', fontSize: 11, margin: '6px 0' }}>{err}</div>}
              <button onClick={saveConfig} style={{ marginTop: 8, padding: '6px 14px', fontSize: 11, background: 'var(--green-bg)', color: 'var(--green)', border: '1px solid var(--green)44' }}>
                {saving ? 'SAVING...' : 'SAVE CONFIG'}
              </button>
            </div>
          ) : (
            <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', background: 'var(--bg)', padding: 12, border: '1px solid var(--border)', overflowX: 'auto', lineHeight: 1.7 }}>
              {JSON.stringify(strategy.config, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── New Strategy Form ─────────────────────────────────────────────────────────

function NewStrategyForm({ onCreated }) {
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', config: '{\n  "market_series": "KXBTC",\n  "position_pct": 0.05\n}' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    setSaving(true); setErr(null)
    try { await api.createStrategy({ ...form, config: JSON.parse(form.config) }); setShow(false); onCreated() }
    catch (e) { setErr(e.message) }
    setSaving(false)
  }

  if (!show) return (
    <button onClick={() => setShow(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 11, fontFamily: 'var(--mono)', background: 'var(--bg2)', color: 'var(--blue)', border: '1px dashed var(--blue)55', width: '100%', justifyContent: 'center', letterSpacing: '0.1em' }}>
      <Plus size={12} /> ADD STRATEGY
    </button>
  )

  return (
    <div style={{ border: '1px solid var(--blue)44', background: 'var(--bg2)', padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'var(--mono)', marginBottom: 12, letterSpacing: '0.1em' }}>NEW STRATEGY</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input placeholder="strategy_name (must match Python class name)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <input placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        <textarea rows={6} value={form.config} onChange={e => setForm(f => ({ ...f, config: e.target.value }))} style={{ resize: 'vertical', lineHeight: 1.6 }} />
        {err && <div style={{ color: 'var(--red)', fontSize: 11 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={submit} style={{ padding: '6px 14px', fontSize: 11, background: 'var(--blue-bg)', color: 'var(--blue)', border: '1px solid var(--blue)44' }}>{saving ? 'CREATING...' : 'CREATE'}</button>
          <button onClick={() => setShow(false)} style={{ padding: '6px 14px', fontSize: 11, background: 'none', color: 'var(--text3)', border: '1px solid var(--border)' }}>CANCEL</button>
        </div>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [portfolio, setPortfolio] = useState(null)
  const [history, setHistory] = useState([])
  const [decisions, setDecisions] = useState([])
  const [stats, setStats] = useState({})
  const [strategies, setStrategies] = useState([])
  const [marketState, setMarketState] = useState(null)
  const [apiStats, setApiStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [connected, setConnected] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [p, h, d, s, st, ms, as_] = await Promise.all([
        api.portfolio().catch(() => null),
        api.portfolioHistory(),
        api.decisions(50),
        api.decisionStats(),
        api.strategies(),
        api.marketState().catch(() => null),
        api.apiStats().catch(() => null),
      ])
      setPortfolio(p)
      setHistory(h)
      setDecisions(d)
      setStats(s)
      setStrategies(st)
      setMarketState(ms)
      setApiStats(as_)
      setConnected(true)
      setLastUpdate(new Date())
    } catch { setConnected(false) }
    setLoading(false)
  }, [])

  useEffect(() => { refresh(); const id = setInterval(refresh, 10000); return () => clearInterval(id) }, [refresh])

  const cash = portfolio?.balance?.balance != null ? portfolio.balance.balance / 100 : null
  const positions = portfolio?.positions || []
  const posValue = positions.reduce((sum, p) => sum + (p.market_exposure || 0) / 100, 0)
  const totalValue = cash != null ? cash + posValue : null
  const recentErrors = decisions.filter(d => d.action === 'error').length

  const tabs = [
    { id: 'dashboard', label: 'DASHBOARD', icon: <Activity size={13} /> },
    { id: 'strategies', label: 'STRATEGIES', icon: <Zap size={13} /> },
    { id: 'log', label: 'DECISION LOG', icon: <Clock size={13} /> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* Top Bar */}
      <header style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg1)', padding: '0 20px', height: 48, flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--cond)', fontWeight: 900, fontSize: 20, letterSpacing: '0.12em', marginRight: 32 }}>
          <span style={{ color: 'var(--green)' }}>K</span>ALSHI
          <span style={{ color: 'var(--text3)', fontWeight: 300, marginLeft: 6 }}>TRADER</span>
        </div>
        <nav style={{ display: 'flex', height: '100%' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: '100%', padding: '0 16px', fontSize: 11, letterSpacing: '0.1em', fontFamily: 'var(--mono)', background: 'none', color: tab === t.id ? 'var(--text)' : 'var(--text3)', borderBottom: tab === t.id ? '2px solid var(--green)' : '2px solid transparent', transition: 'color 0.15s' }}>
              {t.icon}{t.label}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
          <LiveDot active={connected} />
          <span>{connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
          {lastUpdate && <span>· {fmtTime(lastUpdate.toISOString())}</span>}
          <button onClick={refresh} style={{ background: 'none', color: 'var(--text3)', padding: 4, marginLeft: 4 }}><RefreshCw size={12} /></button>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
            <span style={{ animation: 'pulse-green 1s infinite' }}>LOADING...</span>
          </div>
        ) : (
          <>
            {/* ── DASHBOARD ── */}
            {tab === 'dashboard' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* KPI Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                  <Ticker label="Cash Balance" value={fmt$(cash)} sub="from Kalshi API" color="var(--green)" mono />
                  <Ticker label="Open Positions" value={fmt$(posValue)} sub={`${positions.length} markets`} color="var(--blue)" mono />
                  <Ticker label="Total Value" value={fmt$(totalValue)} color="var(--text)" mono />
                  <Ticker label="Buys (last 50)" value={stats.buy || 0} color="var(--green)" />
                  <Ticker label="Skips" value={stats.skip || 0} color="var(--text3)" />
                  <Ticker label="Errors" value={stats.error || 0} color={recentErrors > 0 ? 'var(--red)' : 'var(--text3)'} />
                </div>

                {/* Market Monitor */}
                <MarketMonitor state={marketState} />

                {/* Portfolio Chart */}
                <div style={{ border: '1px solid var(--border)', background: 'var(--bg1)', padding: '16px 16px 8px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', letterSpacing: '0.12em', marginBottom: 12 }}>PORTFOLIO VALUE / 2H</div>
                  {history.length > 1 ? (
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={history} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00ff88" stopOpacity={0.15} />
                            <stop offset="100%" stopColor="#00ff88" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="created_at" tickFormatter={v => fmtTime(v)} tick={{ fontFamily: 'var(--mono)', fontSize: 10, fill: 'var(--text3)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontFamily: 'var(--mono)', fontSize: 10, fill: 'var(--text3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={55} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="total_value" name="Total" stroke="var(--green)" strokeWidth={1.5} fill="url(#greenGrad)" dot={false} />
                        <Area type="monotone" dataKey="cash" name="Cash" stroke="var(--blue)" strokeWidth={1} fill="none" dot={false} strokeDasharray="3 3" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                      NO SNAPSHOT DATA YET — portfolio snapshotted every 60s
                    </div>
                  )}
                </div>

                {/* API Stats */}
                <ApiStatsWidget stats={apiStats} />

                {/* Open Positions */}
                {positions.length > 0 && (
                  <div style={{ border: '1px solid var(--border)', background: 'var(--bg1)' }}>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', letterSpacing: '0.12em' }}>OPEN POSITIONS</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['TICKER', 'YES QTY', 'NO QTY', 'EXPOSURE'].map(h => (
                            <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)', letterSpacing: '0.12em' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((p, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)33' }}>
                            <td style={{ padding: '8px 16px', fontFamily: 'var(--mono)', fontSize: 12 }}>{p.ticker}</td>
                            <td style={{ padding: '8px 16px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green)' }}>{p.position || 0}</td>
                            <td style={{ padding: '8px 16px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)' }}>{p.no_position || 0}</td>
                            <td style={{ padding: '8px 16px', fontFamily: 'var(--mono)', fontSize: 12 }}>{fmt$((p.market_exposure || 0) / 100)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Recent Decisions */}
                <div style={{ border: '1px solid var(--border)', background: 'var(--bg1)' }}>
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', letterSpacing: '0.12em', display: 'flex', justifyContent: 'space-between' }}>
                    <span>RECENT DECISIONS</span>
                    <button onClick={() => setTab('log')} style={{ background: 'none', color: 'var(--blue)', fontSize: 10, fontFamily: 'var(--mono)' }}>VIEW ALL →</button>
                  </div>
                  {decisions.slice(0, 8).map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--border)22', animation: 'slide-in 0.15s ease' }}>
                      <ActionBadge action={d.action} />
                      <SideIndicator side={d.side} />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', flex: 1 }}>{d.market_ticker}</span>
                      {d.contract_price && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{(d.contract_price * 100).toFixed(0)}¢</span>}
                      {d.time_remaining_seconds != null && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{d.time_remaining_seconds}s</span>}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', minWidth: 55, textAlign: 'right' }}>{ago(d.created_at)}</span>
                    </div>
                  ))}
                </div>

              </div>
            )}

            {/* ── STRATEGIES ── */}
            {tab === 'strategies' && (
              <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', letterSpacing: '0.12em', marginBottom: 4 }}>
                  {strategies.length} REGISTERED — {strategies.filter(s => s.enabled).length} ACTIVE
                </div>
                {strategies.map(s => <StrategyCard key={s.id} strategy={s} onUpdate={refresh} />)}
                <NewStrategyForm onCreated={refresh} />
                <div style={{ marginTop: 8, padding: 14, border: '1px solid var(--border)', background: 'var(--bg1)', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>
                  <div style={{ color: 'var(--text2)', marginBottom: 6 }}>ADDING A NEW STRATEGY</div>
                  1. Create <span style={{ color: 'var(--blue)' }}>backend/strategies/your_strategy.py</span><br />
                  2. Subclass <span style={{ color: 'var(--green)' }}>BaseStrategy</span>, set <span style={{ color: 'var(--green)' }}>name</span>, implement <span style={{ color: 'var(--green)' }}>evaluate()</span><br />
                  3. Add <span style={{ color: 'var(--blue)' }}>@register</span> decorator<br />
                  4. Import in <span style={{ color: 'var(--blue)' }}>strategies/__init__.py</span><br />
                  5. Add strategy row above (name must match class name exactly)
                </div>
              </div>
            )}

            {/* ── DECISION LOG ── */}
            {tab === 'log' && (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', letterSpacing: '0.12em' }}>{decisions.length} ENTRIES</span>
                  {['buy', 'skip', 'error'].map(a => (
                    <span key={a} style={{ fontSize: 10, fontFamily: 'var(--mono)', color: a === 'buy' ? 'var(--green)' : a === 'error' ? 'var(--red)' : 'var(--text3)' }}>
                      {a.toUpperCase()}: {stats[a] || 0}
                    </span>
                  ))}
                </div>
                <div style={{ border: '1px solid var(--border)', background: 'var(--bg1)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['TIME', 'ACTION', 'SIDE', 'TICKER', 'PRICE', 'SECS LEFT', 'CONTRACTS', 'SIZE', 'REASON'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {decisions.map((d, i) => (
                        <tr key={d.id} style={{ borderBottom: '1px solid var(--border)22', background: i % 2 === 0 ? 'transparent' : 'var(--bg2)11' }}>
                          <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtTime(d.created_at)}</td>
                          <td style={{ padding: '7px 12px' }}><ActionBadge action={d.action} /></td>
                          <td style={{ padding: '7px 12px' }}><SideIndicator side={d.side} /></td>
                          <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11 }}>{d.market_ticker}</td>
                          <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{d.contract_price ? `${(d.contract_price * 100).toFixed(0)}¢` : '—'}</td>
                          <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11 }}>{d.time_remaining_seconds ?? '—'}</td>
                          <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11 }}>{d.contracts ?? '—'}</td>
                          <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11 }}>{d.position_size ? fmt$(d.position_size) : '—'}</td>
                          <td style={{ padding: '7px 12px', fontSize: 11, color: 'var(--text3)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
