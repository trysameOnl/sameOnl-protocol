// Palette generator. Samples real pixels from the brand + reference assets,
// writes src/tokens.css (the only file allowed to hold colour literals)
// and scripts/out/palette.json (provenance used by the gates).
import fs from 'node:fs';
import sharp from 'sharp';

export const SOURCES = {
  logo: 'brand/LOGO SAME PNG...png',
  slide: 'reference/SAME 1.jpg.jpeg',
};
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function load(file, minAlpha) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const idx = [];
  for (let p = 0; p < info.width * info.height; p++) if (data[p * 4 + 3] >= minAlpha) idx.push(p);
  return { data, w: info.width, idx };
}

// deterministic k-means over real pixels; centroids snapped to the nearest real pixel
function kmeans({ data, idx }, k, iters = 30) {
  const n = idx.length;
  const rgb = (p) => [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
  const cs = [];
  for (let i = 0; i < k; i++) cs.push(rgb(idx[Math.floor(((i + 0.5) / k) * n)]));
  const asg = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const [r, g, b] = rgb(idx[i]);
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (r - cs[c][0]) ** 2 + (g - cs[c][1]) ** 2 + (b - cs[c][2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      asg[i] = best; sum[best][0] += r; sum[best][1] += g; sum[best][2] += b; sum[best][3]++;
    }
    for (let c = 0; c < k; c++) if (sum[c][3]) cs[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const counts = new Array(k).fill(0);
  asg.forEach((a) => counts[a]++);
  return cs.map((c, ci) => {
    let bp = idx[0], bd = Infinity;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = rgb(idx[i]);
      const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
      if (d < bd) { bd = d; bp = idx[i]; }
    }
    return { rgb: rgb(bp), share: counts[ci] / n, p: bp };
  });
}

export async function buildPalette() {
  const logo = await load(SOURCES.logo, 255);
  const slide = await load(SOURCES.slide, 255);
  const sphere = kmeans(logo, 4).sort((a, b) => lum(...b.rgb) - lum(...a.rgb));
  const cold = kmeans(slide, 6).sort((a, b) => lum(...a.rgb) - lum(...b.rgb));
  const mk = (token, src, c, w) => ({ token, hex: hex(...c.rgb), file: SOURCES[src], x: c.p % w, y: Math.floor(c.p / w), share: +c.share.toFixed(4) });
  return [
    mk('bg', 'slide', cold[0], slide.w),
    mk('surface', 'slide', cold[1], slide.w),
    mk('line', 'slide', cold[2], slide.w),
    mk('dim', 'slide', cold[3], slide.w),
    mk('muted', 'slide', cold[4], slide.w),
    mk('bright', 'slide', cold[5], slide.w),
    mk('sphere-hi', 'logo', sphere[0], logo.w),
    mk('sphere-mid', 'logo', sphere[1], logo.w),
    mk('sphere-lo', 'logo', sphere[2], logo.w),
    mk('sphere-edge', 'logo', sphere[3], logo.w),
  ];
}

export function tokensCss(pal) {
  const rows = pal.map((t) => `  --${t.token}: ${t.hex}; /* ${t.file} @ (${t.x},${t.y}) share ${t.share} */`).join('\n');
  return `/* Palette provenance: k-means over real pixels of the brand logo (alpha 255 only) and the
   first reference slide (k=6, deterministic seeding, 30 passes). Each centroid is snapped to the
   nearest real pixel, so every literal below exists in the named file at the stated coordinate.
   This is the only file in the project allowed to hold colour literals. */
:root {
${rows}
}
`;
}

if (process.argv[1]?.endsWith('palette.mjs')) {
  const pal = await buildPalette();
  fs.mkdirSync('scripts/out', { recursive: true });
  fs.writeFileSync('scripts/out/palette.json', JSON.stringify(pal, null, 2));
  fs.writeFileSync('src/tokens.css', tokensCss(pal));
  console.table(pal);
}
