'use strict';
const fs = require('fs');
const F = 'D:/ai/program/cyrene-furina/work/src/dist/renderer/assets/renderer-DtFVcmkW.js';
const s = fs.readFileSync(F, 'utf8');
function find(tok, before, after, max, label) {
  let i = 0, c = 0;
  while ((i = s.indexOf(tok, i)) >= 0 && c < max) {
    console.log('\n===== [' + (label || tok) + '] @' + i + ' =====');
    console.log(s.slice(Math.max(0, i - before), i + after));
    i += tok.length; c++;
  }
  if (c === 0) console.log('\n===== [' + (label || tok) + '] NONE =====');
}
find('ef=', 220, 220, 6, 'ef=');
find('const ef', 100, 300, 3);
find('new URL(', 200, 200, 4, 'new URL(');
find('location.href', 250, 250, 4, 'location.href');
find('isAbsolute', 200, 260, 3);
find('cyrene-model', 200, 200, 2, 'cyrene-model');
