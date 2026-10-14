import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dirs = ['brand', 'reference'];
const CT = { 0: 'greyscale', 2: 'truecolour', 3: 'indexed', 4: 'greyscale+alpha', 6: 'truecolour+alpha' };

function header(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { kind: 'PNG', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), depth: buf[24], colourType: buf[25], colourName: CT[buf[25]], interlace: buf[28] };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { kind: 'JPEG', depth: buf[i + 4], h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), components: buf[i + 9] };
      }
      i += 2 + len;
    }
  }
  return { kind: 'unknown' };
}

function kmeans(px, k, iters = 24) {
  const n = px.length / 3;
  const cs = [];
  for (let i = 0; i < k; i++) { const j = Math.floor(((i + 0.5) / k) * n); cs.push([px[j * 3], px[j * 3 + 1], px[j * 3 + 2]]); }
  const asg = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (let p = 0; p < n; p++) {
      let b = 0, bd = 1e18;
      for (let c = 0; c < k; c++) {
        const dr = px[p * 3] - cs[c][0], dg = px[p * 3 + 1] - cs[c][1], db = px[p * 3 + 2] - cs[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; b = c; }
      }
      asg[p] = b; const s = sum[b]; s[0] += px[p * 3]; s[1] += px[p * 3 + 1]; s[2] += px[p * 3 + 2]; s[3]++;
    }
    for (let c = 0; c < k; c++) if (sum[c][3]) cs[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  // snap each centroid to a real pixel coordinate
  return cs.map((c, ci) => {
    let bp = -1, bd = 1e18, count = 0;
    for (let p = 0; p < n; p++) {
      if (asg[p] === ci) count++;
      const dr = px[p * 3] - c[0], dg = px[p * 3 + 1] - c[1], db = px[p * 3 + 2] - c[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; bp = p; }
    }
    return { share: count / n, rgb: [px[bp * 3], px[bp * 3 + 1], px[bp * 3 + 2]], pixelIndex: bp };
  });
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

const out = [];
for (const d of dirs) {
  for (const f of fs.readdirSync(d).sort()) {
    const fp = path.join(d, f);
    const buf = fs.readFileSync(fp);
    const hd = header(buf);
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    const hist = new Array(8).fill(0);
    let pureBlackTransparent = 0, opaque = 0, partial = 0, zero = 0;
    const opaquePx = [];
    const freq = new Map();
    for (let p = 0; p < n; p++) {
      const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2], a = data[p * 4 + 3];
      hist[a >> 5]++;
      if (a === 0) { zero++; if (r + g + b === 0) pureBlackTransparent++; } else if (a === 255) opaque++; else partial++;
      if (a > 0) { if (p % 3 === 0) opaquePx.push(r, g, b); const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3); freq.set(key, (freq.get(key) || 0) + 1); }
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, c]) => hex(((k >> 10) & 31) << 3 | 4, ((k >> 5) & 31) << 3 | 4, (k & 31) << 3 | 4) + ' x' + c);
    const km = kmeans(Uint8Array.from(opaquePx), 6).sort((a, b) => b.share - a.share).map((c) => ({ hex: hex(...c.rgb), share: +c.share.toFixed(4), x: (c.pixelIndex * 3) % info.width, y: Math.floor((c.pixelIndex * 3) / info.width) }));
    out.push({ file: fp, bytes: buf.length, header: hd, alphaHist8: hist, alpha0: zero, alpha0PureBlackRGB: pureBlackTransparent, alpha255: opaque, alphaPartial: partial, dominantQuantised: top, kmeans6: km });
  }
}
fs.mkdirSync('scripts/out', { recursive: true });
fs.writeFileSync('scripts/out/assets.json', JSON.stringify(out, null, 2));
for (const o of out) console.log(JSON.stringify(o));
