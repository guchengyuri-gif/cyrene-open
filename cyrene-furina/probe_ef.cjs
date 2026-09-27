'use strict';
// 定位 ef() 的实现：hx() 返回的 modelPath 会经过它，必须确认它对「绝对 URL」是原样保留
const fs = require('fs');
const path = require('path');

const DIR = 'D:\\ai\\program\\cyrene-furina\\work\\src\\dist\\renderer\\assets';
const CAND = [
  'renderer-DtFVcmkW.js',
  'renderer-base-Cdn9HcKK.js',
  'index-CKzEDhDD.js',
  'settings-BVI_D-HL.js',
];

function firstHits(s, re, n) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(s)) !== null && out.length < n) out.push({ at: m.index, hit: m[0] });
  return out;
}

for (const f of CAND) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) { console.log('SKIP', f); continue; }
  const s = fs.readFileSync(p, 'utf8');
  console.log('\n########## ' + f + '  len=' + s.length);

  // 1) model3.json 相关（hx 的定义与使用）
  for (const h of firstHits(s, /models\/\$\{|model3\.json/g, 6)) {
    console.log('--- [' + h.hit + '] @' + h.at + ' ---');
    console.log(s.slice(Math.max(0, h.at - 300), h.at + 300).replace(/\r/g, ''));
  }

  // 2) ef 的定义形态
  const defs = [
    [/function\s+ef\s*\(/g, 'function ef('],
    [/\bef\s*=\s*function\s*\(/g, 'ef = function('],
    [/[,;{]\s*ef\s*=\s*[a-zA-Z_$]/g, 'ef = ident'],
    [/\bef\s*=\s*\(/g, 'ef = (...)'],
  ];
  for (const [re, label] of defs) {
    const hs = firstHits(s, re, 4);
    if (hs.length) {
      for (const h of hs) {
        console.log('--- [DEF ' + label + '] @' + h.at + ' ---');
        console.log(s.slice(Math.max(0, h.at - 200), h.at + 320).replace(/\r/g, ''));
      }
    } else {
      console.log('--- [DEF ' + label + '] none');
    }
  }
}
