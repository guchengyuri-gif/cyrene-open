const fs = require('fs');
const rb = 'D:/ai/program/cyrene-furina/work/src/dist/renderer/assets/renderer-DtFVcmkW.js';
const s = fs.readFileSync(rb, 'utf8');

// 找 model3.json 的 URL 是怎么来的（加载源）
for (const k of ['modelSource', 'modelUrl', 'getPetModel', 'PET_MODEL_CHANGED', 'petModel', 'modelPath', 'models/', '.model3', 'setModel', 'loadModel']) {
  let i = 0, c = 0, first = -1; const pos = [];
  while ((i = s.indexOf(k, i)) !== -1) { if (first === -1) first = i; if (c < 6) pos.push(i); c++; i += k.length; }
  console.log('### ' + k + ': ' + c + (first >= 0 ? ' first@' + first : ''));
  for (const p of pos.slice(0, 3)) {
    console.log('   --- @' + p + ' ---');
    console.log('   ' + s.slice(Math.max(0, p - 180), p + 260).replace(/\n/g, ' '));
  }
}
