'use strict';
// 确认 Live2D 封装类 Yv 如何使用 modelPath（查找其 loadModel / from 调用）
const fs = require('fs');
const D = 'D:\\ai\\program\\cyrene-furina\\work\\src\\dist\\renderer\\assets';
const F = D + '\\renderer-DtFVcmkW.js';
const s = fs.readFileSync(F, 'utf8');
console.log('file len', s.length);

function scan(src, kw, label, before, after, max) {
  console.log('\n===== ' + label + ' :: ' + kw + ' =====');
  let i = -1, c = 0;
  while ((i = src.indexOf(kw, i + 1)) >= 0 && c < (max || 8)) {
    console.log('@' + i + ' :: ' + JSON.stringify(src.slice(Math.max(0, i - (before || 150)), i + (after || 250))));
    c++;
  }
  if (!c) console.log('(none)');
}

scan(s, 'modelPath', 'renderer bundle', 200, 320, 6);
scan(s, 'live2dFactory', 'renderer bundle', 120, 200, 4);

// Yv 类定义：搜 'Yv=' 与 'class Yv'
for (const kw of ['Yv=', 'class Yv', 'Yv extends']) {
  let i = s.indexOf(kw);
  console.log('\n[Yv] ' + kw + ' @' + i + (i >= 0 ? ' :: ' + JSON.stringify(s.slice(Math.max(0, i - 200), i + 700)) : ''));
}

// 谁引用了 Live2D 核心包（cubism）
scan(s, 'Cubism4', 'renderer bundle', 80, 180, 3);
