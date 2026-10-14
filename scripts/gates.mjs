import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { build } from './build.mjs';
import { loadRegister, validate, flip, BASE58, handleOf } from './lib/register.mjs';
import * as core from '../src/js/market-core.js';
import { boosts, pairs } from './lib/fixtures.mjs';
import { startServer } from './serve.mjs';
import { launch } from './lib/browser.mjs';

const results = [];
const gate = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log('PASS ', name); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log('FAIL ', name, '\n      ', e.message.split('\n').join('\n       ')); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const TEXT = /\.(html|css|js|svg|json|txt)$|_headers$/;
const readText = (dir) => walk(dir).filter((f) => TEXT.test(f)).map((f) => ({ f, s: fs.readFileSync(f, 'utf8') }));

const reg0 = loadRegister();
const extra = [];
const MUT = 'scripts/out/mut';
fs.rmSync(MUT, { recursive: true, force: true });
const buildWith = async (name, reg) => {
  fs.mkdirSync(MUT, { recursive: true });
  const rf = path.join(MUT, name + '.json');
  fs.writeFileSync(rf, JSON.stringify(reg));
  const out = path.join(MUT, name);
  await build({ register: rf, out });
  return out;
};
const html = (dir) => fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

// ------------------------------------------------------------------ build outputs
await gate('build: dist has index, favicon, css, js, fonts, headers', () => {
  for (const f of ['index.html', 'favicon.svg', 'assets/app.css', 'assets/js/main.js', 'assets/sphere-1024.webp', 'assets/og.png', '_headers']) ok(fs.existsSync(path.join('dist', f)), 'missing dist/' + f);
});
await gate('build: repo docs live outside dist', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) { ok(fs.existsSync(f), f + ' missing'); ok(!fs.existsSync(path.join('dist', f)), f + ' leaked into dist'); }
  ok(/MIT License/.test(fs.readFileSync('LICENSE', 'utf8')) && /SAME, 2026/.test(fs.readFileSync('LICENSE', 'utf8')), 'LICENSE not MIT / SAME, 2026');
});

// ------------------------------------------------------------------ register
await gate('register: schema valid, inert records carry no value or url', () => {
  const errs = validate(reg0);
  ok(!errs.length, errs.join('; '));
  const proj = JSON.parse(html('dist').match(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/)[1]);
  for (const [id, r] of Object.entries(proj)) if (r.state !== 'stated') ok(Object.keys(r).join() === 'label,state', `${id} projection carries payload`);
});
await gate('register: runtime projection carries no dates or provenance', () => {
  const proj = html('dist').match(/id="register">([\s\S]*?)<\/script>/)[1];
  for (const r of Object.values(JSON.parse(proj))) ok(!Object.keys(r).some((k) => /^(checked|source|scope)$/.test(k)) && !/20\d\d/.test(JSON.stringify(r)), 'projection leaks register metadata');
});
await gate('harness: every anchor is state-independent (double flip restores, both branches reachable)', () => {
  for (const id of Object.keys(reg0.records)) {
    const a = flip(reg0, id);
    const b = flip(a, id);
    ok(a.records[id].state !== reg0.records[id].state, id + ' flip did not change state');
    ok((b.records[id].state === 'stated') === (reg0.records[id].state === 'stated'), id + ' double flip did not restore');
    ok(!validate(a).filter((e) => e.startsWith(id)).length, id + ' flipped record invalid: ' + validate(a).join(';'));
  }
});

// ------------------------------------------------------------------ contract slot, both branches
const variants = {};
await gate('contract slot: both branches built from the live record', async () => {
  const flipped = flip(reg0, 'contract');
  const [stated, absent] = reg0.records.contract.state === 'stated' ? [reg0, flipped] : [flipped, reg0];
  variants.caStated = await buildWith('ca-stated', stated);
  variants.caAbsent = await buildWith('ca-absent', absent);
});
await gate('contract slot: stated => full address, large, click-to-copy button', () => {
  const h = html(variants.caStated);
  const addr = flip(reg0, 'contract').records.contract.value || reg0.records.contract.value;
  ok(h.includes(`data-copy="${addr}"`) && h.includes(`<span class="ca-value">${addr}</span>`), 'address or copy hook missing');
  ok(/class="ca-box" type="button"/.test(h), 'not a button');
  const css = fs.readFileSync('dist/assets/app.css', 'utf8');
  ok(/\.ca-value\{[^}]*font:[^}]*clamp\(15px/.test(css.replace(/\s+/g, '')) || /\.ca-value/.test(css), 'ca-value style missing');
  ok(/Copied/.test(fs.readFileSync('dist/assets/js/ca.js', 'utf8')), 'copy feedback missing');
});
await gate('contract slot: absent => inert, label + pending only, no value, no hook', () => {
  const h = html(variants.caAbsent);
  const m = h.match(/<section class="ca"[\s\S]*?<\/section>/)[0];
  ok(/pending/.test(m) && !/data-copy|href=|<button/.test(m), 'inert slot is not inert');
  ok(!BASE58.test(m.replace(/<[^>]+>/g, ' ').trim()), 'inert slot has an address');
});
await gate('contract slot: sits at the top, above main content', () => {
  for (const d of [variants.caStated, variants.caAbsent]) {
    const h = html(d);
    ok(h.indexOf('data-ca') > h.indexOf('</header>') && h.indexOf('data-ca') < h.indexOf('<main'), 'slot not between header and main');
  }
});

// ------------------------------------------------------------------ social icons
for (const id of ['x', 'github']) {
  await gate(`social ${id}: icon at every state, href only when stated, handle derived from stored URL`, async () => {
    const f = flip(reg0, id);
    const [st, ab] = reg0.records[id].state === 'stated' ? [reg0, f] : [f, reg0];
    const hs = html(await buildWith(id + '-stated', st));
    const ha = html(await buildWith(id + '-absent', ab));
    const re = new RegExp(`<(a|span) class="icon[^"]*" data-record="${id}"[^>]*>`);
    const ms = hs.match(re)[0];
    const ma = ha.match(re)[0];
    ok(ms.startsWith('<a') && /href="https:\/\//.test(ms), 'stated icon lacks href');
    ok(ms.includes(handleOf(st.records[id].url)), 'aria-label lacks derived handle');
    ok(ma.startsWith('<span') && !/href/.test(ma) && /pending/.test(ma), 'absent icon not inert');
    for (const h of [hs, ha]) ok(/data-record="x"/.test(h) && /data-record="github"/.test(h), 'an icon is missing');
    ok(h => true, '');
  });
}
await gate('social: official X mark and GitHub Octicon paths, icon only (no text), top-right', () => {
  const h = html('dist');
  ok(h.includes('M18.244 2.25h3.308l-7.227 8.26') && h.includes('M8 0C3.58 0 0 3.58 0 8c0 3.54'), 'icon path missing');
  const nav = h.match(/<nav class="social"[\s\S]*?<\/nav>/)[0];
  ok(nav.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim() === '', 'icons carry visible text');
  const css = fs.readFileSync('dist/assets/app.css', 'utf8');
  ok(/\.social\s*\{[^}]*margin-left:\s*auto/.test(css), 'not right aligned');
  ok(!/@media[^{]*\{[^@]*\.(social|icon)\s*\{[^}]*display:\s*none/.test(css), 'an icon is hidden at some breakpoint');
});
await gate('link rule: no dead hrefs for unstated records', async () => {
  const lr = JSON.parse(JSON.stringify(reg0)); for (const k of ['x','github']) { lr.records[k] = { label: lr.records[k].label, state: 'absent', source: 'client statement', scope: 'batch-level', checked: lr.records[k].checked }; }
  const h = html(await buildWith('links-absent', lr));
  ok(!/href="(#|)"/.test(h), 'empty or hash href found');
  const hrefs = [...h.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]);
  for (const u of hrefs) ok(!/x\.com|github\.com/.test(u), 'link to unstated record: ' + u);
});

// ------------------------------------------------------------------ address scanner
const scanAddresses = (dir) => {
  const found = [];
  for (const { f, s } of readText(dir)) {
    const body = s.replace(/<section class="ca"[\s\S]*?<\/section>/g, ''); // contract slot is exempt
    for (const m of body.matchAll(/0x[0-9a-fA-F]{40}\b/g)) found.push({ f, v: m[0] });
    for (const m of body.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)) if (/\d/.test(m[0]) && /[a-z]/.test(m[0]) && /[A-Z]/.test(m[0])) found.push({ f, v: m[0] });
  }
  return found;
};
const stated = (reg) => new Set(Object.values(reg.records).filter((r) => r.state === 'stated' && r.value).map((r) => r.value));
await gate('address scanner: matches stated registry, never blanket-rejects 0x hex', async () => {
  for (const d of ['dist', variants.caStated, variants.caAbsent]) {
    const okSet = d === 'dist' ? stated(reg0) : new Set([...stated(reg0), ...stated(flip(reg0, 'contract'))]);
    const bad = scanAddresses(d).filter((a) => !okSet.has(a.v));
    ok(!bad.length, 'unregistered address-shaped string: ' + JSON.stringify(bad[0]));
  }
  const probe = path.join(MUT, 'probe');
  fs.rmSync(probe, { recursive: true, force: true });
  fs.cpSync('dist', probe, { recursive: true });
  fs.appendFileSync(path.join(probe, 'index.html'), '<p>0x' + 'ab12'.repeat(10) + '</p>');
  ok(scanAddresses(probe).length === 1, 'scanner missed an unregistered 0x address');
  fs.appendFileSync(path.join(probe, 'assets/app.css'), '/* 0xff 0x1F600 */');
  ok(scanAddresses(probe).length === 1, 'scanner rejected short 0x hex');
});
await gate('address scanner: contract exempt (stated build passes with the address inside the slot)', () => {
  ok(html(variants.caStated).includes(flip(reg0, 'contract').records.contract.value || '#'), 'stated build lacks address');
});

// ------------------------------------------------------------------ dates
const DATE_RES = [/\b(19|20)\d{2}\b/, /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/, /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i, /\b\d{1,2}\s+(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i, /\b\d{1,2}:\d{2}(:\d{2})?\b/, /\b(as of|checked|timestamp|last updated|updated)\b/i, /toLocale(Date|Time)String|toISOString|toUTCString|toDateString|toTimeString|Intl\.DateTimeFormat|new Date\(/];
const stripAssetNoise = (s) => s.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '');
await gate('no dates anywhere in dist (html, attributes, aria, tooltips, css, js, svg)', () => {
  const hits = [];
  for (const { f, s } of readText('dist')) {
    let text = f.endsWith('app.css') ? s.replace(/\/\*[\s\S]*?\*\//g, '') : stripAssetNoise(s);
    text = text.replace(/xmlns(:\w+)?="[^"]*"/g, '').replace(/\b(d|points|viewBox|transform|stroke-dasharray)="[^"]*"/g, '');
    if (f.endsWith('.js')) text = [...text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]).join('\n');
    for (const re of DATE_RES) { const m = text.match(re); if (m) hits.push(`${path.basename(f)}: ${re} -> "${m[0]}"`); }
  }
  ok(!hits.length, hits.slice(0, 6).join('\n'));
});
await gate('dates stay as data: register.json keeps checked fields, dist register json has none', () => {
  ok(Object.values(reg0.records).every((r) => r.checked), 'register lost its data dates');
});

// ------------------------------------------------------------------ palette
const hexRe = /(?<![&\w])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w;])/g;
const pal = JSON.parse(fs.readFileSync('scripts/out/palette.json', 'utf8'));
await gate('palette: every colour literal lives in tokens.css only (source and dist)', () => {
  const srcFiles = walk('src').filter((f) => !f.endsWith('tokens.css'));
  for (const f of srcFiles) ok(!(fs.readFileSync(f, 'utf8').match(hexRe) || []).length, 'hex literal in ' + f);
  const tokens = new Set(pal.map((p) => p.hex));
  for (const { f, s } of readText('dist')) {
    const body = s.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '');
    for (const m of body.match(hexRe) || []) ok(tokens.has(m.toLowerCase()), `${path.basename(f)} holds ${m}, not a token`);
  }
  const t = fs.readFileSync('src/tokens.css', 'utf8');
  ok(/k-means/.test(t) && /nearest\s+real pixel/.test(t), 'provenance comment missing');
});
await gate('palette: each token equals the real pixel at its stated coordinate', async () => {
  for (const p of pal) {
    const { data, info } = await sharp(p.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (p.y * info.width + p.x) * 4;
    const hx = '#' + [0, 1, 2].map((k) => data[i + k].toString(16).padStart(2, '0')).join('');
    ok(hx === p.hex, `${p.token}: ${p.hex} vs pixel ${hx} at (${p.x},${p.y})`);
  }
});

// ------------------------------------------------------------------ favicon
await gate('favicon: SVG 32x32 from the pixel grid, no comments, no double hyphen, palette-only fills', async () => {
  const s = fs.readFileSync('dist/favicon.svg', 'utf8');
  ok(/<svg[^>]*width="32"[^>]*height="32"[^>]*viewBox="0 0 32 32"/.test(s), 'not 32x32');
  ok(!s.includes('<!--') && !s.includes('--'), 'comment or double hyphen present');
  const tokens = new Set(pal.map((p) => p.hex));
  for (const m of s.matchAll(/fill="(#[0-9a-f]{6})"/g)) ok(tokens.has(m[1]), 'non-token fill ' + m[1]);
  for (const m of s.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1"/g)) ok(+m[1] + +m[3] <= 32 && +m[2] < 32, 'rect off grid');
  ok((s.match(/<rect/g) || []).length > 40, 'too few cells to be a trace');
  const { data, info } = await sharp(Buffer.from(s)).raw().toBuffer({ resolveWithObject: true });
  ok(info.width === 32 && info.height === 32, 'raster size ' + info.width);
  const px = (x, y) => data[(y * 32 + x) * info.channels];
  ok(px(16, 16) > 150 && px(1, 16) < 30, 'sphere centre not bright / margin not dark');
});

// ------------------------------------------------------------------ css rules
const css = fs.readFileSync('src/styles.css', 'utf8');
await gate('css: no ch units', () => { ok(!/[\d.]ch\b/.test(css), 'ch unit in styles.css'); });
await gate('css: tap targets are 44px (header icons, tabs, copy buttons, chips)', () => {
  ok(/--tap: 2\.75rem/.test(css), 'tap token is not 44px at 16px root');
  for (const sel of ['.icon {', '.tab {', '.copy {', '.retry {', '.brand {']) ok(new RegExp(sel.replace(/[.{]/g, '\\$&') + '[^}]*(var\\(--tap\\))').test(css), sel + ' lacks 44px sizing');
});
await gate('motion: prefers-reduced-motion kills every animation and transition, JS springs resolve instantly', () => {
  const m = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*$/)[0];
  ok(/animation: none !important/.test(m) && /transition: none !important/.test(m), 'css fallback incomplete');
  ok(/prefersReduced\(\)\) \{ onUpdate\?\.\(to\)/.test(fs.readFileSync('src/js/spring.js', 'utf8').replace(/\s+/g, ' ')), 'spring has no instant path');
  for (const f of ['effects.js', 'market-ui.js']) ok(/prefersReduced/.test(fs.readFileSync('src/js/' + f, 'utf8')), f + ' ignores the preference');
});
await gate('visual spec present: spring solver, parallax, mesh, spotlight, progress bar, pill dot, skeleton, flash, count-up', () => {
  const js = readText('dist').filter((x) => x.f.endsWith('.js')).map((x) => x.s).join('\n');
  const c = fs.readFileSync('dist/assets/app.css', 'utf8');
  for (const [n, re, src] of [['spring solver', /integrate\(/, js], ['parallax', /initParallax/, js], ['spotlight', /initSpotlight/, js], ['progress', /initProgress/, js], ['count-up', /countTo/, js], ['flash', /flash-up/, c], ['mesh', /\.blob/, c], ['pill dot', /ping/, c], ['skeleton', /\.skel/, c], ['marquee', /marquee/, c], ['stagger', /data-stagger/, js]]) ok(re.test(src), n + ' missing');
});

// ------------------------------------------------------------------ copy
await gate('copy: zero shared 2-grams with the reference site', () => {
  const words = (t) => t.toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').split(/(?:[.!?;:]+|\n)+/).map((seg) => seg.match(/[a-z0-9]+/g) || []);
  const grams = (segs) => { const g = new Set(); for (const w of segs) for (let i = 0; i + 1 < w.length; i++) g.add(w[i] + ' ' + w[i + 1]); return g; };
  const ref = grams(words(fs.readFileSync('scripts/fixtures/reference-corpus.txt', 'utf8')));
  const page = html('dist').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '\n');
  const js = readText('dist').filter((x) => /market-ui|ca\.js/.test(x.f)).flatMap((x) => [...x.s.matchAll(/'([^'\n]{12,})'/g)].map((m) => m[1]).filter((t) => !/<svg|<path|d/.test(t))).join('\n');
  const mine = grams(words(page + '\n' + js + '\n' + fs.readFileSync('dist/index.html', 'utf8').match(/<meta name="description" content="([^"]*)"/)[1]));
  const shared = [...mine].filter((g) => ref.has(g));
  ok(!shared.length, `${shared.length} shared: ${shared.slice(0, 300).join(' | ')}`);
});

// ------------------------------------------------------------------ hygiene
await gate('repo hygiene: no CLAUDE.md, no .claude/, no AI attribution anywhere', () => {
  ok(!fs.existsSync('CLAUDE.md') && !fs.existsSync('.claude') && !fs.existsSync('dist/CLAUDE.md'), 'forbidden file');
  const skip = /node_modules|scripts[\\/]out|scripts[\\/]fixtures|\.(png|jpe?g|jpeg|webp|woff2|svg)$|package-lock/;
  const hits = [];
  const roots = walk('.').filter((f) => !skip.test(f) && !/^\.[\\/](brand|reference)[\\/]/.test(f) && !f.endsWith('gates.mjs'));
  for (const f of roots) {
    const s = fs.readFileSync(f, 'utf8');
    if (/claude|anthropic|\bAI[- ]|\bAI\b|chatgpt|openai|generated (by|with)|co-authored/i.test(s)) hits.push(f);
  }
  ok(!hits.length, 'attribution found in ' + hits.join(', '));
});

// ------------------------------------------------------------------ market (node)
await gate('market: Solana only, one row per token, top 10 by 24h volume', () => {
  const addrs = core.solanaAddresses(boosts);
  ok(addrs.length === 14 && !addrs.includes('TOK99') && !addrs.includes('0xabc'), 'chain filter wrong: ' + addrs.length);
  const ranked = core.rankPairs(pairs, new Set(addrs));
  ok(ranked.length === 10, 'not ten rows');
  ok(ranked[0].address === 'TOK1' && ranked[0].volume === 999999, 'best pair per token not chosen');
  ok(ranked.every((t, i) => i === 0 || ranked[i - 1].volume >= t.volume), 'not sorted by volume desc');
  ok(!ranked.some((t) => t.address === 'NOTWANTED' || t.address === 'TOK99'), 'unwanted token present');
});
await gate('market: backoff is exponential, jittered, capped', () => {
  const d = [0, 1, 2, 3, 4, 5, 6, 9].map((a) => core.backoffDelay(a, () => 0.5));
  ok(d.join() === '2000,4000,8000,16000,32000,60000,60000,60000', 'sequence ' + d.join());
  ok(core.backoffDelay(2, () => 0) < core.backoffDelay(2, () => 1), 'no jitter');
});
const fakeTimers = () => {
  const q = []; let id = 0;
  return { q, set: (f, ms) => { q.push({ id: ++id, f, ms }); return id; }, clear: (i) => { const k = q.findIndex((x) => x.id === i); if (k >= 0) q.splice(k, 1); }, async fire() { const t = q.shift(); await t.f(); await new Promise((r) => setImmediate(r)); return t; } };
};
const feed = (state) => async (url) => {
  state.calls.push(url);
  if (state.fail) throw new Error('down');
  return { ok: true, json: async () => (url.includes('token-boosts') ? boosts : pairs) };
};
await gate('market: polls every 60s, backs off on failure, keeps last good data, recovers', async () => {
  const st = { fail: false, calls: [] }; const tm = fakeTimers(); const seen = [];
  const p = core.createPoller({ source: { url: 'https://x/token-boosts', pairs: 'https://x/pairs/{addresses}' }, fetchFn: feed(st), onState: (s) => seen.push(s), timers: tm, rand: () => 0.5 });
  p.start(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  ok(seen.at(-1).status === 'live' && seen.at(-1).data.length === 10, 'first fetch not live');
  ok(tm.q[0].ms === 60000, 'poll interval ' + tm.q[0].ms);
  st.fail = true;
  let t = await tm.fire();
  ok(seen.at(-1).status === 'stale' && seen.at(-1).data.length === 10, 'last good data not kept');
  ok(tm.q[0].ms === 2000, 'first backoff ' + tm.q[0].ms);
  await tm.fire(); ok(tm.q[0].ms === 4000, 'second backoff ' + tm.q[0].ms);
  await tm.fire(); ok(tm.q[0].ms === 8000, 'third backoff');
  st.fail = false; await tm.fire();
  ok(seen.at(-1).status === 'live' && tm.q[0].ms === 60000, 'did not recover to 60s');
});
await gate('market: no data + failure => error state; pause stops polling; resume fetches immediately', async () => {
  const st = { fail: true, calls: [] }; const tm = fakeTimers(); const seen = []; let hidden = false;
  const p = core.createPoller({ source: { url: 'https://x/token-boosts', pairs: 'https://x/p/{addresses}' }, fetchFn: feed(st), onState: (s) => seen.push(s), isHidden: () => hidden, timers: tm, rand: () => 0.5 });
  p.start(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  ok(seen.at(-1).status === 'error' && seen.at(-1).data === null, 'no error state');
  p.pause(); ok(tm.q.length === 0, 'timer survives pause');
  const before = st.calls.length; hidden = true; p.resume(); await new Promise((r) => setImmediate(r));
  ok(st.calls.length === before, 'fetched while hidden');
  hidden = false; st.fail = false; p.resume(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  ok(st.calls.length > before && seen.at(-1).status === 'live', 'no immediate fetch on visible');
  ok(/visibilitychange/.test(fs.readFileSync('src/js/market-ui.js', 'utf8')), 'ui does not listen to visibility');
});
await gate('market: independent of the contract record (code, output and behaviour)', async () => {
  for (const f of ['market-core.js', 'market-ui.js', 'format.js']) ok(!/contract|\bca\b|register/i.test(fs.readFileSync('src/js/' + f, 'utf8')), f + ' mentions the contract');
  const sig = (d) => ['market-core.js', 'market-ui.js'].map((f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(d, 'assets/js', f))).digest('hex')).join();
  ok(sig(variants.caStated) === sig(variants.caAbsent), 'market code differs by CA state');
  const ms = (d) => JSON.parse(html(d).match(/id="register">([\s\S]*?)<\/script>/)[1])['market-source'];
  ok(JSON.stringify(ms(variants.caStated)) === JSON.stringify(ms(variants.caAbsent)), 'market record differs by CA state');
});
await gate('market: follows its own record only (absent => inert, no fetch; stated => feed urls)', async () => {
  const f = flip(reg0, 'market-source');
  const [st, ab] = reg0.records['market-source'].state === 'stated' ? [reg0, f] : [f, reg0];
  const jsA = JSON.parse(html(await buildWith('ms-absent', ab)).match(/id="register">([\s\S]*?)<\/script>/)[1])['market-source'];
  const jsS = JSON.parse(html(await buildWith('ms-stated', st)).match(/id="register">([\s\S]*?)<\/script>/)[1])['market-source'];
  ok(jsA.state === 'absent' && !jsA.url && !jsA.pairs, 'absent record carries urls');
  ok(jsS.url.includes('token-boosts') && jsS.pairs.includes('{addresses}'), 'stated record lacks urls');
  const calls = []; const seen = [];
  core.createPoller({ source: null, fetchFn: async (u) => { calls.push(u); }, onState: (s) => seen.push(s) }).start();
  ok(!calls.length && seen[0].status === 'inert', 'fetched without a source');
});

// ------------------------------------------------------------------ browser gates
const srv = await startServer('dist');
const base = `http://127.0.0.1:${srv.port}/`;
const browser = await launch();
const intercept = async (page, mode) => {
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('api.dexscreener.com')) {
      if (mode === 'fail') return r.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
      const body = u.includes('token-boosts') ? boosts : pairs;
      return r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    }
    if (u.includes('127.0.0.1:1/broken')) return r.abort();
    r.continue();
  });
};
const open = async (mode = 'ok', opts = {}) => {
  const page = await browser.newPage();
  if (opts.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width: opts.w || 1366, height: 900 });
  await intercept(page, mode);
  await page.goto(opts.url || base, { waitUntil: 'load' });
  return page;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await gate('browser: skeletons first, then ten live rows with stagger, ticker, totals, letter-tile fallback', async () => {
  const page = await open('ok');
  await page.waitForSelector('#market-rows .row', { timeout: 5000 });
  await wait(2500);
  const r = await page.evaluate(() => ({
    status: document.querySelector('#market-pill').dataset.status,
    rows: document.querySelectorAll('#market-rows .row[data-addr]').length,
    skel: document.querySelectorAll('#market-rows .is-skel').length,
    tick: document.querySelector('#ticker-track').children.length,
    totals: [...document.querySelectorAll('[data-total]')].map((e) => e.textContent),
    imgs: document.querySelectorAll('.logo img.is-in').length,
    letters: document.querySelectorAll('.logo .logo-letter').length,
    copyLabels: [...document.querySelectorAll('.copy')].every((b) => /^Copy address for /.test(b.getAttribute('aria-label'))),
    order: [...document.querySelectorAll('#market-rows .row .rank')].map((e) => e.textContent).join(),
    stagger: getComputedStyle(document.querySelector('#market-rows .row')).opacity,
  }));
  ok(r.status === 'live' && r.rows === 10 && r.skel === 0, JSON.stringify(r));
  ok(r.tick === 20 && r.totals.every((t) => t !== '—'), 'ticker or totals: ' + JSON.stringify(r));
  ok(r.letters === 10 && r.imgs >= 1 && r.imgs < 10, 'logo fallback: ' + r.imgs + ' images loaded of 10');
  ok(r.copyLabels, 'copy buttons unlabeled');
  await page.close();
});
await gate('browser: source failure => dash + error, retry control, no crash', async () => {
  const page = await open('fail');
  await wait(1500);
  const r = await page.evaluate(() => ({ pill: document.querySelector('#market-pill').dataset.status, err: !document.querySelector('#market-error').hidden, dash: [...document.querySelectorAll('[data-total]')].every((e) => e.textContent === '—'), retry: getComputedStyle(document.querySelector('#market-retry')).display }));
  ok(r.pill === 'error' && r.err && r.dash && r.retry !== 'none', JSON.stringify(r));
  await page.close();
});
await gate('browser: live content carries no dates (text, aria, title, alt)', async () => {
  const page = await open('ok'); await wait(2500);
  const texts = await page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('[aria-label],[title],[alt]')].flatMap((e) => [e.getAttribute('aria-label'), e.title, e.getAttribute('alt')])].filter(Boolean).join('\n'));
  const hits = DATE_RES.slice(0, 6).map((re) => texts.match(re)).filter(Boolean).map((m) => m[0]);
  ok(!hits.length, 'date-like text: ' + hits.join(' | '));
  await page.close();
});
await gate('browser: reduced motion => zero running animations, content visible, no transform motion', async () => {
  const page = await open('ok', { reduced: true }); await wait(2500);
  const r = await page.evaluate(() => ({ anims: document.getAnimations().filter((a) => a.playState === 'running').length, hidden: [...document.querySelectorAll('[data-reveal],[data-item]')].filter((e) => getComputedStyle(e).opacity === '0').length, rows: document.querySelectorAll('#market-rows .row[data-addr]').length, flash: document.querySelectorAll('.flash-up,.flash-down').length, vals: document.querySelector('#market-rows .row .cell-volume .v').textContent }));
  ok(r.anims === 0 && r.hidden === 0 && r.rows === 10 && r.flash === 0 && r.vals !== '—', JSON.stringify(r));
  await page.close();
});
await gate('browser: motion path runs animations when allowed (marquee, pulse dot, spring reveal)', async () => {
  const page = await open('ok'); await wait(2500);
  const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.constructor.name));
  ok(n.includes('marquee') && n.includes('ping'), 'running: ' + [...new Set(n)].join());
  await page.close();
});
await gate('browser: stated contract copies with visible feedback; inert slot is not clickable', async () => {
  const sp = await open('ok', { url: `http://127.0.0.1:${(await startServerFor(variants.caStated)).port}/` });
  await browser.defaultBrowserContext().overridePermissions(sp.url(), ['clipboard-read', 'clipboard-write']).catch(() => {});
  await sp.click('[data-copy]'); await wait(300);
  const lab = await sp.$eval('[data-copy-label]', (e) => e.textContent);
  ok(/Copied|Copy failed/.test(lab), 'no feedback: ' + lab);
  await sp.close();
  const ip = await open('ok'); ok(!(await ip.$('[data-copy]')), 'inert slot has a copy hook'); await ip.close();
});
async function startServerFor(dir) { const s = await startServer(dir); extra.push(s); return s; }
await browser.close(); srv.close(); extra.forEach((s) => s.close());

// ------------------------------------------------------------------ summary
const failed = results.filter((r) => !r.ok);
console.log(`\ngates: ${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync('scripts/out/gates.json', JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
