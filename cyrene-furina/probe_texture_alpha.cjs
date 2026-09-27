// 统计 PNG 的 alpha 分布：全透明/全不透明/半透明占比 + 非透明区域包围盒
// 用法: node probe_texture_alpha.cjs <a.png> [b.png ...]
const fs = require('fs');
const zlib = require('zlib');

function analyze(p) {
  const b = fs.readFileSync(p);
  let off = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') {
      w = b.readUInt32BE(off + 8);
      h = b.readUInt32BE(off + 12);
      bd = b[off + 16];
      ct = b[off + 17];
    } else if (type === 'IDAT') {
      idat.push(b.subarray(off + 8, off + 8 + len));
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (ct !== 6 || bd !== 8) return { p, err: 'unsupported colortype=' + ct + ' depth=' + bd };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let tr = 0, op = 0, pa = 0;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos]; pos++;
    const line = raw.subarray(pos, pos + stride); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = line[x];
      let v;
      const left = x >= bpp ? cur[x - bpp] : 0;
      const up = prev[x];
      const ul = x >= bpp ? prev[x - bpp] : 0;
      switch (ft) {
        case 0: v = a; break;
        case 1: v = a + left; break;
        case 2: v = a + up; break;
        case 3: v = a + ((left + up) >> 1); break;
        case 4: {
          const p1 = Math.abs(up - ul), p2 = Math.abs(left - ul), p3 = Math.abs(left + up - 2 * ul);
          const pr = (p1 <= p2 && p1 <= p3) ? left : (p2 <= p3 ? up : ul);
          v = a + pr; break;
        }
        default: throw new Error('bad filter ' + ft);
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const al = cur[x * 4 + 3];
      if (al === 0) tr++; else if (al === 255) op++; else pa++;
      if (al > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const t = prev; prev = cur; cur = t;
  }
  const total = w * h;
  return {
    file: p, size: w + 'x' + h,
    alpha0_pct: +(tr / total * 100).toFixed(2),
    alpha255_pct: +(op / total * 100).toFixed(2),
    partial_pct: +(pa / total * 100).toFixed(2),
    contentBBox: [minX, minY, maxX, maxY],
    contentBBox_pct_of_atlas: [
      +(minX / w * 100).toFixed(1), +(minY / h * 100).toFixed(1),
      +((maxX - minX) / w * 100).toFixed(1), +((maxY - minY) / h * 100).toFixed(1)
    ],
    cornersAlpha: [cur[3], cur[(w - 1) * 4 + 3], prev[3], prev[(w - 1) * 4 + 3]]
  };
}

for (const p of process.argv.slice(2)) {
  try { console.log(JSON.stringify(analyze(p))); }
  catch (e) { console.log(JSON.stringify({ file: p, err: String(e && e.message || e) })); }
}
