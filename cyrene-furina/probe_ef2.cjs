'use strict';
// 读取 hx() 的实际调用点上下文，确认 ef() 的实现（它对「绝对 URL」是否原样保留）
const fs = require('fs');
const F = 'D:\\ai\\program\\cyrene-furina\\work\\src\\dist\\renderer\\assets\\renderer-DtFVcmkW.js';
const s = fs.readFileSync(F, 'utf8');

console.log('=== slice 623200..625900 ===');
console.log(s.slice(623200, 625900));

console.log('\n=== 所有 \\bef\\b 出现（前 40 个，带左右各 70 字） ===');
const re = /\bef\b/g;
let m, c = 0;
while ((m = re.exec(s)) !== null && c < 40) {
  console.log(m.index + '  ' + JSON.stringify(s.slice(Math.max(0, m.index - 70), m.index + 70)));
  c++;
}
if (c === 0) console.log('(none)');

console.log('\n=== import 段是否绑定 ef ===');
const im = /\bimport\s*[\s\S]{0,400}?from/g;
let k = 0, c2 = 0;
while ((k = im.exec(s)) !== null && c2 < 12) {
  const seg = k[0];
  if (/\bef\b/.test(seg)) console.log('IMPORT WITH ef:', seg);
  c2++;
}
console.log('import 语句片段数:', c2);
