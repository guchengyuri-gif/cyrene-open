'use strict';
const fs = require('fs');
const crypto = require('crypto');

function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16); }
const M = 'D:/ai/program/cyrene-asar-extract/dist/main/shared/live2d-actions.js';
const P = 'D:/ai/program/cyrene-asar-extract/dist/preload/shared/live2d-actions.js';
console.log('live2d-actions  main  sha:', sha(M));
console.log('live2d-actions  preload sha:', sha(P));
console.log('identical?', sha(M) === sha(P));

const F = 'D:/ai/program/cyrene-asar-extract/dist/renderer/assets/renderer-DtFVcmkW.js';
const s = fs.readFileSync(F, 'utf8');
console.log('\nrenderer bundle length:', s.length);
const TOKENS = ['model3.json', 'petModel', 'Tick3', 'LIVE2D_MODEL_ACTIONS', '.motion(', '.expression(', 'Idle'];
for (const tok of TOKENS) {
  let idx = 0, c = 0;
  while ((idx = s.indexOf(tok, idx)) >= 0 && c < 3) {
    console.log('\n===== [' + tok + '] @' + idx + ' =====');
    console.log(s.slice(Math.max(0, idx - 320), idx + 320));
    idx += tok.length; c++;
  }
  if (c === 0) console.log('\n===== [' + tok + '] : none =====');
}
