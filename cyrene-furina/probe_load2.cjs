'use strict';
const fs = require('fs');
const F = 'D:/ai/program/cyrene-furina/work/src/dist/renderer/assets/renderer-DtFVcmkW.js';
const s = fs.readFileSync(F, 'utf8');
function find(tok, before, after, max) {
  let i = 0, c = 0;
  while ((i = s.indexOf(tok, i)) >= 0 && c < max) {
    console.log('\n===== [' + tok + '] @' + i + ' =====');
    console.log(s.slice(Math.max(0, i - before), i + after));
    i += tok.length; c++;
  }
  if (c === 0) console.log('\n===== [' + tok + '] NONE =====');
}
find('function ef', 200, 500, 3);
find('XMLHttpRequest', 250, 250, 4);
find('class Yv', 100, 400, 3);
find('modelPath', 300, 300, 6);
find('live2dFactory', 200, 300, 4);
