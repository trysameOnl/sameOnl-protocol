import { startServer } from './serve.mjs';
import { launch } from './lib/browser.mjs';

const widths = [360, 390, 430, 1366, 1440];
const s = await startServer('dist');
const b = await launch();
let bad = 0;
for (const w of widths) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: 900 });
  await p.setRequestInterception(true);
  p.on('request', (r) => (r.url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
  await p.goto(`http://127.0.0.1:${s.port}/`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 800));
  const m = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const small = [...document.querySelectorAll('a[href],button,[role=tab],span.icon')].map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 43.5 || r.height < 43.5)).map(({ e, r }) => `${e.tagName}.${e.className}:${Math.round(r.width)}x${Math.round(r.height)}`);
    const soc = document.querySelector('.social').getBoundingClientRect();
    const icons = [...document.querySelectorAll('.social [data-record]')].map((e) => e.getBoundingClientRect().right);
    return { vw, scrollW: document.documentElement.scrollWidth, small, socialRight: Math.round(soc.right), icons: icons.length, ca: document.querySelector('[data-ca]').getBoundingClientRect().top };
  });
  const issues = [];
  if (m.scrollW > m.vw) issues.push('horizontal overflow ' + m.scrollW);
  if (m.small.length) issues.push('small targets: ' + [...new Set(m.small)].join(', '));
  if (m.icons !== 2) issues.push('icons ' + m.icons);
  if (m.socialRight < m.vw - 40) issues.push('social not top-right');
  bad += issues.length;
  console.log(w, issues.length ? 'FAIL ' + issues.join('; ') : 'OK', JSON.stringify({ scrollW: m.scrollW, socialRight: m.socialRight, caTop: Math.round(m.ca) }));
  await p.close();
}
await b.close(); s.close();
process.exit(bad ? 1 : 0);
