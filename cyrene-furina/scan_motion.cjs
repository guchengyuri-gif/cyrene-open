const fs = require('fs');
const rb = 'D:/ai/program/cyrene-furina/work/src/dist/renderer/assets/renderer-DtFVcmkW.js';
const s = fs.readFileSync(rb, 'utf8');

// 1. motionIndexMap 构建逻辑
console.log('=== motionIndexMap 出现位置 ===');
let idx = 0, c = 0;
while ((idx = s.indexOf('motionIndexMap', idx)) !== -1) {
  c++;
  console.log('--- @' + idx + ' (#' + c + ') ---');
  console.log(s.slice(Math.max(0, idx - 350), idx + 350).replace(/\n/g, ' '));
  idx += 14;
  if (c >= 6) break;
}

// 2. getMotionIndex / motionNames / MotionGroup 相关
console.log('=== getMotionIndex / motionNames 出现位置 ===');
for (const k of ['getMotionIndex', 'motionNames', 'MotionGroup', 'motionGroup']) {
  let i = 0, n = 0, first = -1;
  while ((i = s.indexOf(k, i)) !== -1) { if (first === -1) first = i; n++; i += k.length; }
  console.log('  ' + k + ': ' + n + (first >= 0 ? ' first@' + first : ''));
  if (first >= 0 && (k === 'getMotionIndex' || k === 'motionNames')) {
    console.log('    ' + s.slice(Math.max(0, first - 200), first + 300).replace(/\n/g, ' '));
  }
}
