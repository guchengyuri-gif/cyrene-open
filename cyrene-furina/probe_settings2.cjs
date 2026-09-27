'use strict';
// 定位「桌宠模型」改变后如何保存：setPetModel 调用点 + us(select) 的所有用法
const fs = require('fs');

const JS = 'D:\\ai\\program\\cyrene-furina\\work\\src\\dist\\renderer\\assets\\settings-BVI_D-HL.js';
const PRELOAD = 'D:\\ai\\program\\cyrene-furina\\work\\src\\dist\\preload\\preload\\index.js';

function hits(file, needle, before, after, max, label) {
  const s = fs.readFileSync(file, 'utf8');
  console.log('\n##### ' + (label || needle) + ' @ ' + file.split('\\').pop() + ' (len ' + s.length + ')');
  let i = -1, c = 0;
  while ((i = s.indexOf(needle, i + 1)) !== -1 && c < max) {
    console.log('--- @' + i + ' ---');
    console.log(s.slice(Math.max(0, i - before), i + after).replace(/\\r/g, ''));
    c++;
  }
  if (c === 0) console.log('  (none)');
}

hits(JS, 'setPetModel', 400, 400, 6);
hits(JS, 'us.value', 300, 300, 8, 'us.value');
hits(JS, '"pet-model"', 200, 400, 4, 'us listener?');
hits(JS, 'petModel:', 300, 300, 6, 'petModel: (save payload)');
hits(JS, 'appearance-form', 300, 500, 4);
hits(PRELOAD, 'setPetModel', 300, 400, 4, 'preload setPetModel');
