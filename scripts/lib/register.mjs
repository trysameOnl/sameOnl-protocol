import fs from 'node:fs';

export const STATES = ['stated', 'absent', 'unconfirmed'];
export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PAYLOAD_KEYS = ['value', 'url', 'rpc', 'pairs'];

export function loadRegister(file = 'register.json') {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Rule 1: only stated records may carry payload; everything else is label + state.
export function validate(reg) {
  const errs = [];
  for (const [id, r] of Object.entries(reg.records)) {
    if (!STATES.includes(r.state)) errs.push(`${id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      for (const k of PAYLOAD_KEYS) if (r[k] != null) errs.push(`${id}: inert record carries ${k}`);
      for (const [k, v] of Object.entries(r)) if (typeof v === 'string' && /^https?:\/\//i.test(v)) errs.push(`${id}: inert record carries url-like ${k}`);
    } else if (!PAYLOAD_KEYS.some((k) => r[k])) errs.push(`${id}: stated record has no payload`);
    if (id === 'contract' && r.state === 'stated' && !BASE58.test(r.value || '')) errs.push('contract: value is not a base58 address');
  }
  return errs;
}

// Runtime projection: no dates, no provenance, no payload unless stated.
export function project(reg) {
  const out = {};
  for (const [id, r] of Object.entries(reg.records)) {
    const p = { label: r.label, state: r.state };
    if (r.state === 'stated') for (const k of PAYLOAD_KEYS) if (r[k] != null) p[k] = r[k];
    out[id] = p;
  }
  return out;
}

// Rule 2: store the URL, derive the handle.
export function handleOf(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? '@' + seg.replace(/^@/, '') : u.hostname;
  } catch { return ''; }
}

// Mutation harness helpers. Anchors are never literal strings: the current
// record is read at runtime and flipped to its opposite state.
const TEST_PAYLOAD = {
  contract: { value: 'So11111111111111111111111111111111111111112' },
  x: { url: 'https://x.com/sameprobe' },
  github: { url: 'https://github.com/sameprobe/same' },
  'market-source': { url: 'https://api.dexscreener.com/token-boosts/top/v1', pairs: 'https://api.dexscreener.com/tokens/v1/solana/{addresses}' },
  chain: { value: 'Solana', rpc: 'https://solana-rpc.publicnode.com' },
};
export function flip(reg, id) {
  const copy = JSON.parse(JSON.stringify(reg));
  const r = copy.records[id];
  if (r.state === 'stated') {
    for (const k of PAYLOAD_KEYS) delete r[k];
    r.state = 'absent';
  } else {
    r.state = 'stated';
    Object.assign(r, TEST_PAYLOAD[id] || { value: 'probe' });
  }
  return copy;
}
