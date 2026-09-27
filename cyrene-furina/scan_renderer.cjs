const fs = require('fs');
const files = [
  'D:/ai/program/cyrene-furina/work/src/dist/renderer/assets/renderer-DtFVcmkW.js',
  'D:/ai/program/cyrene-furina/work/src/dist/renderer/assets/index-CKzEDhDD.js'
];
const keys = [
  'startMotion', 'motionName', 'play-action', 'LIVE2D_PLAY_ACTION',
  'setExpression', 'playExpression', 'Live2DTarget', 'playAction',
  'model3', 'Motions', 'Expressions', 'live2d:play-action',
  'onLive2dPlayAction', 'motion(' , 'expression(', 'getModelActions'
];
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('MISSING: ' + f); continue; }
  const s = fs.readFileSync(f, 'utf8');
  console.log('=== ' + f.split('/').pop() + ' size=' + s.length + ' ===');
  for (const k of keys) {
    let i = 0, c = 0, first = -1;
    while ((i = s.indexOf(k, i)) !== -1) { if (first === -1) first = i; c++; i += k.length; }
    console.log('  ' + k + ': ' + c + (first >= 0 ? ' first@' + first : ''));
  }
}
// 额外：在 renderer 里找 live2d 相关的 chunk 引用
const s = fs.readFileSync(files[0], 'utf8');
const live2dIdx = [];
let i = 0;
while ((i = s.indexOf('live2d', i)) !== -1) { live2dIdx.push(i); i += 6; }
console.log('=== renderer js 中 live2d 出现位置共 ' + live2dIdx.length + ' 处 ===');
for (const idx of live2dIdx.slice(0, 10)) {
  console.log('--- @' + idx + ' ---');
  console.log(s.slice(Math.max(0, idx - 120), idx + 200).replace(/\n/g, ' '));
}
