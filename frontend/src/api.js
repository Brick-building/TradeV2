const BASE = '/api'

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }))
    throw new Error(err.detail || r.statusText)
  }
  return r.json()
}

export const api = {
  portfolio: () => req('/portfolio'),
  portfolioHistory: (limit = 120) => req(`/portfolio/history?limit=${limit}`),
  strategies: () => req('/strategies'),
  updateStrategy: (id, body) => req(`/strategies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  createStrategy: (body) => req('/strategies', { method: 'POST', body: JSON.stringify(body) }),
  decisions: (limit = 100, action) => req(`/decisions?limit=${limit}${action ? `&action=${action}` : ''}`),
  decisionStats: () => req('/decisions/stats'),
  markets: (series) => req(`/markets/${series}`),
}
