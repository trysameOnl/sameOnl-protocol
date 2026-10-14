// Deterministic market fixtures shared by the node tests and the browser gates.
const mk = (n, chain, vol, extra = {}) => ({
  chainId: chain, dexId: 'x', pairAddress: 'P' + n,
  baseToken: { address: 'TOK' + n, name: 'Token ' + n, symbol: 'T' + n },
  quoteToken: { address: 'Q', name: 'Q', symbol: 'Q' },
  priceUsd: String(0.001 * n), priceChange: { h24: n % 2 ? n : -n },
  volume: { h24: vol }, liquidity: { usd: 1000 * n },
  info: n % 3 === 0 ? undefined : { imageUrl: n % 3 === 1 ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' : 'http://127.0.0.1:1/broken.png' },
  ...extra,
});

export const boosts = [
  ...Array.from({ length: 14 }, (_, i) => ({ chainId: 'solana', tokenAddress: 'TOK' + (i + 1) })),
  { chainId: 'solana', tokenAddress: 'TOK1' },
  { chainId: 'cronos', tokenAddress: '0xabc' },
  { chainId: 'base', tokenAddress: 'TOK99' },
];

export const pairs = [
  ...Array.from({ length: 14 }, (_, i) => mk(i + 1, 'solana', (i + 1) * 1000)),
  mk(1, 'solana', 999999, { pairAddress: 'second' }),
  mk(99, 'base', 5e9),
  { chainId: 'solana', baseToken: { address: 'NOTWANTED', symbol: 'NW', name: 'NW' }, volume: { h24: 9e9 } },
];
