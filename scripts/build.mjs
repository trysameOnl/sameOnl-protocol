import fs from 'node:fs';
import path from 'node:path';
import { loadRegister, validate, project, handleOf } from './lib/register.mjs';
import { buildPalette, tokensCss, SOURCES } from './palette.mjs';
import { buildBrandAssets } from './lib/assets.mjs';

const ICONS = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  github: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>',
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function args(argv) {
  const o = { register: 'register.json', out: 'dist', quiet: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--register') o.register = argv[++i];
    else if (argv[i] === '--out') o.out = argv[++i];
    else if (argv[i] === '--quiet') o.quiet = true;
  }
  return o;
}

// Rule 2: store the URL, derive the handle. Rule 1: nothing stated, nothing linked.
export function renderSocial(reg) {
  const one = (id, name) => {
    const r = reg.records[id];
    if (r.state === 'stated' && r.url) {
      const handle = handleOf(r.url);
      const label = handle ? `${name} ${handle}` : name;
      return `<a class="icon" data-record="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}" title="${esc(label)}">${ICONS[id]}</a>`;
    }
    return `<span class="icon is-inert" data-record="${id}" data-state="${r.state}" role="img" aria-disabled="true" aria-label="${name}, pending" title="${name}, pending">${ICONS[id]}</span>`;
  };
  return `<nav class="social" aria-label="Social">${one('x', 'X')}${one('github', 'GitHub')}</nav>`;
}

export function renderContract(reg) {
  const r = reg.records.contract;
  if (r.state === 'stated' && r.value) {
    return `<section class="ca" id="contract" data-ca data-state="stated" aria-label="Contract address">
  <div class="ca-head"><span class="label">contract address</span><span class="ca-chain" data-ca-chain hidden></span></div>
  <button class="ca-box" type="button" data-copy="${esc(r.value)}" aria-label="Copy contract address"><span class="ca-value">${esc(r.value)}</span><span class="ca-action">${ICONS.copy}<b data-copy-label>Copy</b></span></button>
  <p class="ca-note" data-ca-note role="status" aria-live="polite"></p>
</section>`;
  }
  return `<section class="ca" id="contract" data-ca data-state="${r.state}" aria-label="Contract address">
  <div class="ca-head"><span class="label">contract address</span></div>
  <div class="ca-box is-inert" role="group" aria-label="Contract address, pending"><span class="ca-value">pending</span></div>
  <p class="ca-note"></p>
</section>`;
}

const tile = (r, { item = true } = {}) => {
  const shown = r.state === 'stated' && r.value ? `<div class="v mono">${esc(r.value)}</div>` : '<div class="v is-pending mono">pending</div>';
  return `<div class="tile"${item ? ' data-item' : ''} data-record-state="${r.state}"><div class="label">${esc(r.label)}</div>${shown}</div>`;
};

export function renderRecords(reg) {
  const rows = ['chain', 'contract', 'x', 'github', 'market-source'].map((id) => {
    const r = reg.records[id];
    let s = 'pending';
    if (r.state === 'stated') {
      if (id === 'chain') s = r.value;
      else if (id === 'x' || id === 'github') s = handleOf(r.url);
      else if (id === 'market-source') s = 'live';
      else s = 'stated';
    }
    return `<li class="chip" data-item data-spotlight data-state="${r.state}"><span class="l">${esc(r.label)}</span><span class="s">${esc(s)}</span></li>`;
  });
  return rows.join('\n      ');
}

export async function build(opts) {
  const reg = loadRegister(opts.register);
  const errs = validate(reg);
  if (errs.length) throw new Error('register invalid:\n  ' + errs.join('\n  '));

  // palette: cached by the mtime of its two source images
  const cacheFile = 'scripts/out/palette.json';
  const stamp = Object.values(SOURCES).map((f) => fs.statSync(f).mtimeMs).join(':');
  let pal;
  const stampFile = 'scripts/out/palette.stamp';
  if (fs.existsSync(cacheFile) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp) pal = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  else {
    pal = await buildPalette();
    fs.mkdirSync('scripts/out', { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(pal, null, 2));
    fs.writeFileSync(stampFile, stamp);
  }
  const tokens = tokensCss(pal);
  if (!fs.existsSync('src/tokens.css') || fs.readFileSync('src/tokens.css', 'utf8') !== tokens) fs.writeFileSync('src/tokens.css', tokens);
  const bgHex = pal.find((p) => p.token === 'bg').hex;

  const cache = await buildBrandAssets(pal);

  const out = opts.out;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'assets/js'), { recursive: true });
  fs.mkdirSync(path.join(out, 'assets/fonts'), { recursive: true });

  const R = reg.records;
  let html = fs.readFileSync('src/index.template.html', 'utf8');
  const slots = {
    THEME_COLOR: bgHex,
    SOCIAL: renderSocial(reg),
    CONTRACT: renderContract(reg),
    STATS: ['stat-cycles', 'stat-retired', 'stat-recycled'].map((id) => tile(R[id])).join('\n      '),
    PARAMS: ['param-share', 'param-floor'].map((id) => tile(R[id])).join('\n        '),
    RECORDS: renderRecords(reg),
    REGISTER_JSON: JSON.stringify(project(reg)).replace(/</g, '\\u003c'),
  };
  for (const [k, v] of Object.entries(slots)) html = html.replaceAll(`{{${k}}}`, v);
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('unfilled template slot');
  fs.writeFileSync(path.join(out, 'index.html'), html);

  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim() + '\n';
  fs.writeFileSync(path.join(out, 'assets/app.css'), tokens + strip(fs.readFileSync('src/styles.css', 'utf8')));
  for (const f of fs.readdirSync('src/js')) fs.copyFileSync(path.join('src/js', f), path.join(out, 'assets/js', f));
  for (const f of ['eb-garamond-latin-400-normal', 'eb-garamond-latin-400-italic', 'jetbrains-mono-latin-400-normal', 'jetbrains-mono-latin-500-normal']) {
    const pkg = f.startsWith('eb') ? 'eb-garamond' : 'jetbrains-mono';
    fs.copyFileSync(`node_modules/@fontsource/${pkg}/files/${f}.woff2`, path.join(out, 'assets/fonts', `${f}.woff2`));
  }
  for (const f of ['sphere-1024.webp', 'sphere-512.webp', 'og.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(cache, f), path.join(out, 'assets', f));
  fs.copyFileSync(path.join(cache, 'favicon.svg'), path.join(out, 'favicon.svg'));

  const rpc = R.chain.state === 'stated' && R.chain.rpc ? new URL(R.chain.rpc).origin : '';
  const feed = R['market-source'].state === 'stated' ? new URL(R['market-source'].url).origin : '';
  const connect = ["'self'", feed, rpc].filter(Boolean).join(' ');
  fs.writeFileSync(path.join(out, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src ${connect}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'

/assets/*
  Cache-Control: public, max-age=3600
`);
  fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  return { out };
}

if (process.argv[1]?.endsWith('build.mjs')) {
  const o = args(process.argv.slice(2));
  build(o).then(() => { if (!o.quiet) console.log(`built -> ${o.out}`); }).catch((e) => { console.error(e.message); process.exit(1); });
}
