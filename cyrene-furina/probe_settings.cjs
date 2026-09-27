'use strict';
// 精确提取设置页 pet-model 的 HTML 结构 与 JS 绑定逻辑
const fs = require('fs');
const path = require('path');

const SRC = 'D:\\ai\\program\\cyrene-furina\\work\\src\\dist\\renderer';
const HTML = path.join(SRC, 'settings', 'index.html');
const JS = path.join(SRC, 'assets', 'settings-BVI_D-HL.js');

function ctx(text, needle, before, after, maxHits) {
  const out = [];
  let i = -1, n = 0;
  while ((i = text.indexOf(needle, i + 1)) !== -1 && out.length < (maxHits || 6)) {
    out.push({ at: i, s: text.slice(Math.max(0, i - before), i + after) });
    n++;
  }
  return out;
}

console.log('========== index.html : pet-model ==========');
const html = fs.readFileSync(HTML, 'utf8');
for (const h of ctx(html, 'pet-model', 900, 1500, 4)) {
  console.log('--- @' + h.at + ' ---');
  console.log(h.s.replace(/\r/g, ''));
  console.log('');
}

console.log('========== settings.js : pet-model / petModel ==========');
const js = fs.readFileSync(JS, 'utf8');
console.log('length =', js.length);
for (const h of ctx(js, 'pet-model', 1200, 1200, 6)) {
  console.log('--- "pet-model" @' + h.at + ' ---');
  console.log(h.s);
  console.log('');
}
for (const h of ctx(js, 'petModel', 600, 900, 10)) {
  console.log('--- "petModel" @' + h.at + ' ---');
  console.log(h.s);
  console.log('');
}
