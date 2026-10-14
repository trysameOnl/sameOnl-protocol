import { copyText } from './clipboard.js';

// Contract slot. Only wired when the register states a contract, in which case the
// server-rendered markup holds a button carrying the address.
export function initContract(chain) {
  const btn = document.querySelector('[data-copy]');
  if (!btn) return;
  const label = btn.querySelector('[data-copy-label]');
  const note = document.querySelector('[data-ca-note]');
  let t;
  btn.addEventListener('click', async () => {
    const ok = await copyText(btn.dataset.copy);
    btn.classList.toggle('is-done', ok);
    if (label) label.textContent = ok ? 'Copied' : 'Copy failed';
    if (note) note.textContent = ok ? 'Contract address copied to clipboard.' : 'Copy failed. Select the address manually.';
    clearTimeout(t);
    t = setTimeout(() => { btn.classList.remove('is-done'); if (label) label.textContent = 'Copy'; }, 1600);
  });
  verify(btn.dataset.copy, chain, note);
}

// Optional on-chain presence check through the chain record's RPC endpoint.
async function verify(address, chain, note) {
  if (!chain?.rpc) return;
  const chip = document.querySelector('[data-ca-chain]');
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const res = await fetch(chain.rpc, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }] }),
    });
    clearTimeout(timer);
    const j = await res.json();
    if (chip) chip.textContent = j?.result?.value ? 'found on chain' : 'not found on chain';
    if (chip) chip.hidden = false;
  } catch { /* the chip stays hidden when the endpoint is unreachable */ }
  void note;
}
