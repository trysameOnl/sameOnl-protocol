// DOM-free market logic. It reads one record only: the market-source record.
export const POLL_MS = 60000;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 60000;
export const TIMEOUT_MS = 12000;
export const TOP_N = 10;
export const MAX_ADDRESSES = 30;

export function backoffDelay(attempt, rand = Math.random) {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(base * (0.85 + rand() * 0.3));
}

export function solanaAddresses(boosts) {
  const seen = new Set();
  for (const b of Array.isArray(boosts) ? boosts : []) {
    if (b && b.chainId === 'solana' && typeof b.tokenAddress === 'string') seen.add(b.tokenAddress);
  }
  return [...seen];
}

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

export function normalizePair(p) {
  return {
    address: p.baseToken.address,
    symbol: p.baseToken.symbol || '?',
    name: p.baseToken.name || p.baseToken.symbol || '?',
    price: num(p.priceUsd),
    change: num(p.priceChange?.h24),
    volume: num(p.volume?.h24),
    liquidity: num(p.liquidity?.usd),
    image: p.info?.imageUrl || null,
  };
}

// One row per token: its busiest Solana pair. Ranked by 24h volume, top ten.
export function rankPairs(pairs, wanted) {
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!p || p.chainId !== 'solana' || !p.baseToken?.address) continue;
    if (wanted && !wanted.has(p.baseToken.address)) continue;
    const vol = num(p.volume?.h24) ?? -1;
    const cur = best.get(p.baseToken.address);
    if (!cur || vol > (num(cur.volume?.h24) ?? -1)) best.set(p.baseToken.address, p);
  }
  return [...best.values()]
    .map(normalizePair)
    .filter((t) => t.volume != null)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, TOP_N);
}

async function getJson(url, fetchFn, outer) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  outer?.addEventListener?.('abort', stop);
  const timer = setTimeout(stop, TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener?.('abort', stop);
  }
}

export async function fetchMarket(source, fetchFn, signal) {
  const boosts = await getJson(source.url, fetchFn, signal);
  const addrs = solanaAddresses(boosts);
  if (!addrs.length) throw new Error('no solana entries');
  const chunks = [];
  for (let i = 0; i < addrs.length; i += MAX_ADDRESSES) chunks.push(addrs.slice(i, i + MAX_ADDRESSES));
  const lists = await Promise.all(chunks.map((c) => getJson(source.pairs.replace('{addresses}', c.join(',')), fetchFn, signal)));
  const ranked = rankPairs(lists.flat(), new Set(addrs));
  if (!ranked.length) throw new Error('no pairs');
  return ranked;
}

// Poller. status: inert | loading | live | stale | error
export function createPoller({ source, fetchFn, onState, isHidden = () => false, timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) }, rand = Math.random }) {
  let data = null;
  let attempt = 0;
  let timer = null;
  let ctl = null;
  let running = false;
  let inflight = false;

  const emit = (status, extra = {}) => onState({ status, data, attempt, ...extra });

  async function tick() {
    if (!running || inflight || isHidden()) return;
    inflight = true;
    ctl = new AbortController();
    if (!data) emit('loading');
    try {
      data = await fetchMarket(source, fetchFn, ctl.signal);
      attempt = 0;
      inflight = false;
      emit('live');
      plan(POLL_MS);
    } catch (err) {
      inflight = false;
      if (ctl.signal.aborted && isHidden()) return;
      const wait = backoffDelay(attempt, rand);
      attempt += 1;
      emit(data ? 'stale' : 'error', { retryInMs: wait });
      plan(wait);
    }
  }
  function plan(ms) {
    timers.clear(timer);
    timer = timers.set(tick, ms);
  }
  return {
    start() {
      if (!source || !source.url || !source.pairs) { onState({ status: 'inert', data: null, attempt: 0 }); return; }
      running = true;
      tick();
    },
    pause() { timers.clear(timer); timer = null; ctl?.abort(); inflight = false; },
    resume() { if (running) { timers.clear(timer); tick(); } },
    get data() { return data; },
  };
}
