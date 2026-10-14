const compact = (n, d = 2) => {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(d) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(d) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(d) + 'K';
  return n.toFixed(a >= 100 ? 0 : d);
};
export const fmtUsd = (n) => (n == null ? '—' : '$' + compact(n));
export function fmtPrice(n) {
  if (n == null) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  if (n >= 1e-9) {
    const digits = Math.min(14, 3 - Math.floor(Math.log10(n)));
    return '$' + n.toFixed(digits);
  }
  return '$' + n.toExponential(2);
}
export const fmtPct = (n) => (n == null ? '—' : Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 2) + '%');
export const arrow = (n) => (n == null || n === 0 ? '' : n > 0 ? '▲' : '▼');
