import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const LOGO = 'brand/LOGO SAME PNG...png';
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export async function readRgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Square crop around the opaque sphere (alpha > 8) with proportional padding.
export function cropToSphere(img, pad = 0.06) {
  const { data, width, height } = img;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const side = Math.ceil(Math.max(x1 - x0 + 1, y1 - y0 + 1) * (1 + pad * 2));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const sx = Math.round(cx - side / 2);
  const sy = Math.round(cy - side / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const X = sx + x;
    const Y = sy + y;
    if (X < 0 || Y < 0 || X >= width || Y >= height) continue;
    data.copy(out, (y * side + x) * 4, (Y * width + X) * 4, (Y * width + X) * 4 + 4);
  }
  return { data: out, width: side, height: side, bbox: [x0, y0, x1, y1] };
}

// Premultiplied resize. Transparent pixels in the source are RGB (0,0,0); resizing straight
// alpha would drag that black into every edge pixel. RGB is premultiplied, scaled as its own
// plane, scaled again alongside a separate alpha plane, then un-premultiplied.
export async function resizePremultiplied(img, size) {
  const { data, width, height } = img;
  const n = width * height;
  const rgb = Buffer.alloc(n * 3);
  const a = Buffer.alloc(n);
  for (let p = 0; p < n; p++) {
    const al = data[p * 4 + 3];
    a[p] = al;
    rgb[p * 3] = Math.round((data[p * 4] * al) / 255);
    rgb[p * 3 + 1] = Math.round((data[p * 4 + 1] * al) / 255);
    rgb[p * 3 + 2] = Math.round((data[p * 4 + 2] * al) / 255);
  }
  const [pr, paRes] = await Promise.all([
    sharp(rgb, { raw: { width, height, channels: 3 } }).resize(size, size, { kernel: 'lanczos3' }).raw().toBuffer(),
    sharp(a, { raw: { width, height, channels: 1 } }).resize(size, size, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true }),
  ]);
  const pa = paRes.data;
  const ach = paRes.info.channels;
  const out = Buffer.alloc(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const al = pa[p * ach];
    for (let c = 0; c < 3; c++) out[p * 4 + c] = al ? Math.min(255, Math.round((pr[p * 3 + c] * 255) / al)) : 0;
    out[p * 4 + 3] = al;
  }
  return { data: out, width: size, height: size };
}

// Area-average (box) downscale in premultiplied space, used for the favicon grid.
export function boxGrid(img, cells) {
  const { data, width } = img;
  const step = width / cells;
  const grid = [];
  for (let gy = 0; gy < cells; gy++) {
    const row = [];
    for (let gx = 0; gx < cells; gx++) {
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      for (let y = Math.floor(gy * step); y < Math.floor((gy + 1) * step); y++) {
        for (let x = Math.floor(gx * step); x < Math.floor((gx + 1) * step); x++) {
          const i = (y * width + x) * 4;
          const al = data[i + 3];
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al; cnt++;
        }
      }
      row.push(a ? { r: r / a, g: g / a, b: b / a, a: a / cnt } : { r: 0, g: 0, b: 0, a: 0 });
    }
    grid.push(row);
  }
  return grid;
}

export function traceFavicon(grid, tones, bg) {
  const palette = tones.map((h) => ({ h, rgb: hexToRgb(h) }));
  const near = (c) => palette.reduce((best, p) => {
    const d = (c.r - p.rgb[0]) ** 2 + (c.g - p.rgb[1]) ** 2 + (c.b - p.rgb[2]) ** 2;
    return d < best.d ? { d, h: p.h } : best;
  }, { d: Infinity, h: palette[0].h }).h;
  const groups = new Map();
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (c.a < 16) { x++; continue; }
      const fill = near(c);
      const op = c.a >= 250 ? '' : (c.a / 255).toFixed(2);
      let w = 1;
      while (x + w < row.length) {
        const n = row[x + w];
        if (n.a < 16 || near(n) !== fill || (n.a >= 250 ? '' : (n.a / 255).toFixed(2)) !== op) break;
        w++;
      }
      const key = fill;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(`<rect x="${x}" y="${y}" width="${w}" height="1"${op ? ` fill-opacity="${op}"` : ''}/>`);
      x += w;
    }
  });
  const body = [...groups].map(([fill, rects]) => `<g fill="${fill}">${rects.join('')}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" rx="7" fill="${bg}"/>${body}</svg>\n`;
}

// Builds every raster/vector brand output once and caches it by input mtime.
export async function buildBrandAssets(palette, cacheDir = 'scripts/out/brand-cache') {
  const stamp = String(fs.statSync(LOGO).mtimeMs) + JSON.stringify(palette.map((p) => p.hex)) + fs.readFileSync('scripts/lib/assets.mjs', 'utf8').length;
  const stampFile = path.join(cacheDir, 'stamp.txt');
  if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp) return cacheDir;
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const tok = Object.fromEntries(palette.map((p) => [p.token, p.hex]));
  const src = await readRgba(LOGO);
  const crop = cropToSphere(src);

  const big = await resizePremultiplied(crop, 1024);
  const small = await resizePremultiplied(crop, 512);
  const save = (img, f, fmt) => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })[fmt](fmt === 'webp' ? { quality: 90, alphaQuality: 100, effort: 5 } : { compressionLevel: 9 }).toFile(path.join(cacheDir, f));
  await save(big, 'sphere-1024.webp', 'webp');
  await save(small, 'sphere-512.webp', 'webp');

  const bgRgb = hexToRgb(tok.bg);
  const onBg = async (w, h, sphere, f) => {
    const png = await sharp(sphere.data, { raw: { width: sphere.width, height: sphere.height, channels: 4 } }).png().toBuffer();
    await sharp({ create: { width: w, height: h, channels: 3, background: { r: bgRgb[0], g: bgRgb[1], b: bgRgb[2] } } })
      .composite([{ input: png, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(path.join(cacheDir, f));
  };
  await onBg(1200, 630, await resizePremultiplied(crop, 560), 'og.png');
  await onBg(180, 180, await resizePremultiplied(crop, 140), 'apple-touch-icon.png');

  // favicon: 32 x 32 grid; the sphere sits inside a 4px margin on the brand black
  const inner = await resizePremultiplied(crop, 24 * 8);
  const pad = Buffer.alloc(32 * 8 * 32 * 8 * 4);
  const off = 4 * 8;
  for (let y = 0; y < inner.height; y++) inner.data.copy(pad, ((y + off) * 32 * 8 + off) * 4, y * inner.width * 4, (y + 1) * inner.width * 4);
  const grid = boxGrid({ data: pad, width: 32 * 8, height: 32 * 8 }, 32);
  fs.writeFileSync(path.join(cacheDir, 'favicon.svg'), traceFavicon(grid, [tok['sphere-hi'], tok['sphere-mid'], tok['sphere-lo'], tok['sphere-edge']], tok.bg));

  // edge check: mean luminance of partially transparent pixels, naive vs premultiplied
  let sum = 0, cnt = 0;
  for (let p = 0; p < big.width * big.height; p++) {
    const a = big.data[p * 4 + 3];
    if (a > 0 && a < 255) { sum += (big.data[p * 4] + big.data[p * 4 + 1] + big.data[p * 4 + 2]) / 3; cnt++; }
  }
  fs.writeFileSync(path.join(cacheDir, 'edge-report.json'), JSON.stringify({ cropBox: crop.bbox, cropSide: crop.width, edgePixels: cnt, edgeMeanLuma: cnt ? +(sum / cnt).toFixed(1) : null, hex }, null, 2));
  fs.writeFileSync(stampFile, stamp);
  return cacheDir;
}
