'use strict';
const fs = require('fs');
const F = 'D:/ai/program/cyrene-asar-extract/dist/renderer/assets/renderer-DtFVcmkW.js';
const s = fs.readFileSync(F, 'utf8');
const TOKENS = ['motionIndexMap', 'startRandomMotion', 'motionManager', 'idle', 'AutoBreath', 'expressionName', 'function ef', 'webpackJsonp'];
for (const tok of TOKENS) {
  let idx = 0, c = 0;
  while ((idx = s.indexOf(tok, idx)) >= 0 && c < 2) {
    console.log('\n===== [' + tok + '] @' + idx + ' =====');
    console.log(s.slice(Math.max(0, idx - 420), idx + 420));
    idx += tok.length; c++;
  }
  if (c === 0) console.log('\n===== [' + tok + '] : none =====');
}
