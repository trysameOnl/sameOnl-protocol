import { createPoller } from './market-core.js';
import { fmtUsd, fmtPrice, fmtPct, arrow } from './format.js';
import { copyText } from './clipboard.js';
import { countTo, spring, prefersReduced } from './spring.js';

const $ = (s, r = document) => r.querySelector(s);
const COPY_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path fill="currentColor" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';

const LABEL = {
  loading: 'connecting', live: 'live', stale: 'holding last data', error: 'feed down, retrying', inert: 'pending',
};

function tile(t) {
  const d = document.createElement('div');
  d.className = 'logo';
  const letter = document.createElement('span');
  letter.className = 'logo-letter';
  letter.textContent = (t.symbol || '?').replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?';
  d.append(letter);
  if (t.image) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => { d.append(img); requestAnimationFrame(() => img.classList.add('is-in')); });
    img.addEventListener('error', () => img.remove());
    img.src = t.image;
  }
  return d;
}

function makeRow(t) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.addr = t.address;
  li.dataset.spotlight = '';
  li.innerHTML = `
    <div class="cell-id"><span class="rank" aria-hidden="true"></span><span class="logo-slot"></span>
      <span class="id"><b class="sym"></b><span class="nm"></span></span></div>
    <div class="cell cell-price" data-k="price"><span class="k">Price</span><span class="v mono"></span></div>
    <div class="cell cell-change" data-k="change"><span class="k">24h</span><span class="v mono"></span></div>
    <div class="cell cell-volume" data-k="volume"><span class="k">Volume</span><span class="v mono"></span></div>
    <div class="cell cell-liq" data-k="liquidity"><span class="k">Liquidity</span><span class="v mono"></span></div>
    <button class="copy" type="button"><span class="copy-ic"></span></button>`;
  $('.logo-slot', li).replaceWith(tile(t));
  const btn = $('.copy', li);
  $('.copy-ic', li).innerHTML = COPY_ICON;
  btn.addEventListener('click', async () => {
    const ok = await copyText(t.address);
    btn.classList.toggle('is-done', ok);
    $('.copy-ic', btn).innerHTML = ok ? CHECK_ICON : COPY_ICON;
    btn.setAttribute('aria-label', ok ? `Copied address for ${li.dataset.sym}` : `Copy address for ${li.dataset.sym}`);
    const live = $('#market-live');
    if (live) live.textContent = ok ? `Copied address for ${li.dataset.sym}` : 'Copy failed';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      btn.classList.remove('is-done');
      $('.copy-ic', btn).innerHTML = COPY_ICON;
      btn.setAttribute('aria-label', `Copy address for ${li.dataset.sym}`);
    }, 1400);
  });
  return li;
}

const FMT = { price: fmtPrice, change: fmtPct, volume: fmtUsd, liquidity: fmtUsd };

function setCell(li, key, value, first, delay) {
  const cell = $(`[data-k="${key}"] .v`, li);
  if (!cell) return;
  const prev = li._vals?.[key];
  li._vals = { ...(li._vals || {}), [key]: value };
  const render = (n) => {
    if (key === 'change') cell.textContent = `${arrow(value)} ${fmtPct(n)}`.trim();
    else cell.textContent = FMT[key](n);
  };
  if (key === 'change') cell.dataset.dir = value == null ? '' : value > 0 ? 'up' : value < 0 ? 'down' : '';
  if (value == null) { cell.textContent = '—'; return; }
  const target = key === 'change' ? Math.abs(value) : value;
  if (first) {
    countTo({ from: 0, to: target, format: (n) => n, apply: render, delay });
  } else if (prev !== value && prev != null) {
    const from = key === 'change' ? Math.abs(prev) : prev;
    countTo({ from, to: target, format: (n) => n, apply: render, stiffness: 120 });
    cell.classList.remove('flash-up', 'flash-down');
    void cell.offsetWidth;
    if (!prefersReduced()) cell.classList.add(value >= prev ? 'flash-up' : 'flash-down');
  } else render(target);
}

function sorters(mode) {
  if (mode === 'move') return (a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity);
  if (mode === 'liquidity') return (a, b) => (b.liquidity ?? -1) - (a.liquidity ?? -1);
  return (a, b) => b.volume - a.volume;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function mountMarket({ source, fetchFn = (...a) => fetch(...a) }) {
  const rowsEl = $('#market-rows');
  const pill = $('#market-pill');
  const pillText = $('b', pill);
  const err = $('#market-error');
  const stats = { volume: $('[data-total="volume"]'), liquidity: $('[data-total="liquidity"]'), count: $('[data-total="count"]') };
  const tabs = [...document.querySelectorAll('[data-sort]')];
  const track = $('#ticker-track');
  const rows = new Map();
  let sort = 'volume';
  let items = [];
  let firstPaint = true;
  let totals = { volume: null, liquidity: null };

  function setPill(status) {
    pill.dataset.status = status;
    pillText.textContent = LABEL[status];
    document.documentElement.dataset.market = status;
  }

  function skeletons() {
    rowsEl.replaceChildren(...Array.from({ length: 10 }, () => {
      const li = document.createElement('li');
      li.className = 'row is-skel';
      li.setAttribute('aria-hidden', 'true');
      li.innerHTML = '<div class="cell-id"><span class="skel sk-logo"></span><span class="id"><span class="skel sk-a"></span><span class="skel sk-b"></span></span></div><div class="cell"><span class="skel sk-c"></span></div><div class="cell"><span class="skel sk-c"></span></div><div class="cell"><span class="skel sk-c"></span></div><div class="cell"><span class="skel sk-c"></span></div><span class="skel sk-btn"></span>';
      return li;
    }));
  }

  function dashes() {
    for (const k of ['volume', 'liquidity', 'count']) if (stats[k]) stats[k].textContent = '—';
  }

  function paintTotals() {
    const vol = items.reduce((s, t) => s + (t.volume || 0), 0);
    const liq = items.reduce((s, t) => s + (t.liquidity || 0), 0);
    const apply = (el, from, to, fmt) => {
      if (from === to) { el.textContent = fmt(to); return; }
      countTo({ from: from ?? 0, to, format: (n) => n, apply: (n) => { el.textContent = fmt(n); }, stiffness: 70 });
      el.classList.remove('flash-up', 'flash-down');
      void el.offsetWidth;
      if (from != null && !prefersReduced()) el.classList.add(to >= from ? 'flash-up' : 'flash-down');
    };
    apply(stats.volume, totals.volume, vol, fmtUsd);
    apply(stats.liquidity, totals.liquidity, liq, fmtUsd);
    stats.count.textContent = String(items.length);
    totals = { volume: vol, liquidity: liq };
  }

  function order() {
    const list = [...items].sort(sorters(sort));
    const before = new Map([...rows].map(([a, li]) => [a, li.getBoundingClientRect().top]));
    list.forEach((t, i) => {
      const li = rows.get(t.address);
      $('.rank', li).textContent = String(i + 1).padStart(2, '0');
      rowsEl.append(li);
    });
    if (!prefersReduced() && !firstPaint) {
      for (const [a, li] of rows) {
        const dy = (before.get(a) ?? 0) - li.getBoundingClientRect().top;
        if (dy && before.has(a)) {
          li.style.transition = 'none';
          li.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => { li.style.transition = ''; li.style.transform = ''; });
        }
      }
    }
  }

  function paintTicker() {
    if (!track) return;
    const list = [...items].sort(sorters('volume'));
    const make = (t) => `<span class="tick" data-dir="${t.change > 0 ? 'up' : t.change < 0 ? 'down' : ''}"><b>${esc(t.symbol)}</b><span>${fmtPrice(t.price)}</span><i>${arrow(t.change)} ${fmtPct(t.change)}</i></span>`;
    const html = list.map(make).join('');
    if (track.dataset.n !== String(list.length)) {
      track.dataset.n = String(list.length);
      track.innerHTML = html + html;
      track.style.setProperty('--marquee-s', `${Math.max(24, list.length * 4)}s`);
      track.parentElement.classList.add('is-ready');
    } else {
      list.forEach((t, i) => {
        for (const off of [0, list.length]) {
          const el = track.children[i + off];
          if (el) el.outerHTML = make(t);
        }
      });
    }
  }

  function paint(data) {
    items = data;
    const seen = new Set();
    if (rows.size === 0) rowsEl.replaceChildren();
    data.forEach((t, i) => {
      seen.add(t.address);
      let li = rows.get(t.address);
      const created = !li;
      if (created) { li = makeRow(t); rows.set(t.address, li); rowsEl.append(li); }
      li.dataset.sym = t.symbol;
      $('.sym', li).textContent = t.symbol;
      $('.nm', li).textContent = t.name;
      const btn = $('.copy', li);
      if (!btn.classList.contains('is-done')) btn.setAttribute('aria-label', `Copy address for ${t.symbol}`);
      const d = firstPaint ? 120 + i * 55 : 0;
      for (const k of ['price', 'change', 'volume', 'liquidity']) setCell(li, k, t[k], created, d);
      if (created && firstPaint && !prefersReduced()) {
        li.classList.add('is-enter');
        spring({
          from: 0, to: 1, stiffness: 150, damping: 17, delay: i * 55,
          onUpdate: (p) => { li.style.opacity = String(Math.min(1, Math.max(0, p))); li.style.transform = `translateY(${(1 - p) * 14}px)`; },
          onDone: () => { li.style.opacity = ''; li.style.transform = ''; li.classList.remove('is-enter'); },
        });
      }
    });
    for (const [a, li] of rows) if (!seen.has(a)) { li.remove(); rows.delete(a); }
    order();
    paintTotals();
    paintTicker();
    err.hidden = true;
    firstPaint = false;
  }

  function onState({ status, data }) {
    setPill(status);
    if (status === 'inert') {
      rowsEl.replaceChildren();
      dashes();
      err.hidden = false;
      err.textContent = 'Market feed pending.';
      return;
    }
    if (status === 'loading' && !rows.size) { skeletons(); return; }
    if (status === 'live' && data) paint(data);
    if (status === 'error') {
      rows.clear();
      rowsEl.replaceChildren();
      dashes();
      err.hidden = false;
      err.textContent = 'Market feed unreachable. Retrying automatically.';
    }
    if (status === 'stale') { err.hidden = false; err.textContent = 'Refresh failed. Showing the last good data.'; }
  }

  tabs.forEach((b, i) => {
    b.addEventListener('click', () => {
      sort = b.dataset.sort;
      tabs.forEach((x) => { const on = x === b; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
      if (items.length) order();
    });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.focus();
      n.click();
    });
  });

  const poller = createPoller({ source, fetchFn, onState, isHidden: () => document.hidden });
  document.addEventListener('visibilitychange', () => (document.hidden ? poller.pause() : poller.resume()));
  $('#market-retry')?.addEventListener('click', () => poller.resume());
  poller.start();
}
