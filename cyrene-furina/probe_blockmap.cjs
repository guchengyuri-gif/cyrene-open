// 把 PNG 的 alpha 通道渲染成字符图（每格 B x B 像素），用于判断图集布局
// 用法: node probe_blockmap.cjs <a.png> [blocks]
const fs = require('fs'), zlib = require('zlib');

function decode(p) {
  const b = fs.readFileSync(p);
  let off = 8, w = 0, h = 0, ct = 0, bd = 0; const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off); const t = b.toString('ascii', off + 4, off + 8);
    if (t === 'IHDR') { w = b.readUInt32BE(off + 8); h = b.readUInt32BE(off + 12); bd = b[off + 16]; ct = b[off + 17]; }
    else if (t === 'IDAT') idat.push(b.subarray(off + 8, off + 8 + len));
    else if (t === 'IEND') break;
    off += 12 + len;
  }
  if (ct !== 6 || bd !== 8) throw new Error('unsupported ct=' + ct + ' bd=' + bd);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = new Uint8Array(w * h);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride), pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos]; pos++;
    const line = raw.subarray(pos, pos + stride); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = line[x]; let v;
      const left = x >= bpp ? cur[x - bpp] : 0, up = prev[x], ul = x >= bpp ? prev[x - bpp] : 0;
      switch (ft) {
        case 0: v = a; break;
        case 1: v = a + left; break;
        case 2: v = a + up; break;
        case 3: v = a + ((left + up) >> 1); break;
        case 4: { const p1 = Math.abs(up - ul), p2 = Math.abs(left - ul), p3 = Math.abs(left + up - 2 * ul); v = a + ((p1 <= p2 && p1 <= p3) ? left : (p2 <= p3 ? up : ul)); break; }
        default: throw new Error('bad filter ' + ft);
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) out[y * w + x] = cur[x * 4 + 3];
    const t2 = prev; prev = cur; cur = t2;
  }
  return { w, h, alpha: out };
}

const { w, h, alpha } = decode(process.argv[2]);
const B = parseInt(process.argv[3] || '64', 10);
const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
const chars = ' .:-=+*#%@';

// alpha 直方图
const bins = new Array(8).fill(0);
for (let i = 0; i < alpha.length; i++) bins[Math.min(7, alpha[i] >> 5)]++;
console.log('alpha 直方图 (0-31,32-63,...224-255): ' + bins.map((v, i) => (i * 32) + ':' + (v / alpha.length * 100).toFixed(2) + '%').join('  '));

const rows = [];
for (let by = 0; by < B; by++) {
  let line = '';
  for (let bx = 0; bx < B; bx++) {
    let sum = 0, n = 0, op = 0;
    for (let y = by * bh; y < Math.min(h, (by + 1) * bh); y += 4)
      for (let x = bx * bw; x < Math.min(w, (bx + 1) * bw); x += 4) {
        const a = alpha[y * w + x]; sum += a; n++; if (a > 250) op++;
      }
    const v = Math.max(sum / n / 255, op / n);
    line += chars[Math.min(chars.length - 1, Math.floor(v * chars.length))];
  }
  rows.push(line);
}
let first = 0, last = rows.length - 1;
while (first < rows.length && rows[first].trim() === '') first++;
while (last >= 0 && rows[last].trim() === '') last--;
console.log('size ' + w + 'x' + h + '  每格 ' + bw + 'x' + bh + 'px  B=' + B);
console.log('图例: 空格=透明 .=极淡 :=淡 -=中 =+偏浓 *=浓 #=接近不透明 %=全不透明');
for (let i = first; i <= last; i++) console.log(String(i).padStart(3, '0') + '|' + rows[i]);
