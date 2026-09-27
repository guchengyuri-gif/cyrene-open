'use strict';
// 组装 furina 模型 → 注入 work/src → 改设置页 + 两张动作表
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VTS = 'D:/下载/芙宁娜免费模型/芙宁娜免费模型/芙宁娜（vts）';
const STAGE = 'D:/ai/program/cyrene-furina/stage/furina';
const TREE = 'D:/ai/program/cyrene-furina/work/src';
const TARGET = path.join(TREE, 'dist/renderer/models/furina');

/* ---------- 1) 组装 stage ---------- */
fs.rmSync(path.dirname(STAGE), { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'furina.8192'), { recursive: true });
fs.mkdirSync(path.join(STAGE, 'motions'), { recursive: true });
fs.mkdirSync(path.join(STAGE, 'expressions'), { recursive: true });

function cp(a, b) { fs.copyFileSync(a, b); console.log('[cp]', path.basename(b).padEnd(28), fs.statSync(b).size); }
cp(path.join(VTS, '芙宁娜.moc3'), path.join(STAGE, 'furina.moc3'));
cp(path.join(VTS, '芙宁娜.physics3.json'), path.join(STAGE, 'furina.physics3.json'));
cp(path.join(VTS, '芙宁娜.cdi3.json'), path.join(STAGE, 'furina.cdi3.json'));
cp(path.join(VTS, '芙宁娜.8192', 'texture_00.png'), path.join(STAGE, 'furina.8192', 'texture_00.png'));

const motionFiles = fs.readdirSync(path.join(VTS, 'motions')).filter((f) => f.endsWith('.motion3.json')).sort();
for (const f of motionFiles) cp(path.join(VTS, 'motions', f), path.join(STAGE, 'motions', f));
const exprFiles = fs.readdirSync(path.join(VTS, 'expressions')).filter((f) => f.endsWith('.exp3.json')).sort();
for (const f of exprFiles) cp(path.join(VTS, 'expressions', f), path.join(STAGE, 'expressions', f));

const mocHead = (p) => { const b = fs.readFileSync(p).subarray(0, 8); return b.toString('latin1', 0, 4) + ' v' + b.readUInt32LE(4); };
console.log('[moc3] furina :', mocHead(path.join(STAGE, 'furina.moc3')));
console.log('[moc3] cyrene :', mocHead(path.join(TREE, 'dist/renderer/models/cyrene/model.moc3')));

/* ---------- 2) Furina.model3.json ---------- */
const doc = {
  Version: 3,
  FileReferences: {
    Moc: 'furina.moc3',
    Textures: ['furina.8192/texture_00.png'],
    Physics: 'furina.physics3.json',
    DisplayInfo: 'furina.cdi3.json',
    Motions: {
      Idle: [{ Name: '待机', File: 'motions/待机动画.motion3.json', FadeInTime: 1, FadeOutTime: 1 }],
      Tap: [
        { Name: '摊手', File: 'motions/摊手动画.motion3.json', FadeInTime: 0.3 },
        { Name: '变芒', File: 'motions/变芒.motion3.json', FadeInTime: 0.3 },
        { Name: '变荒', File: 'motions/变荒.motion3.json', FadeInTime: 0.3 },
      ],
    },
    Expressions: exprFiles.map((f) => ({ Name: f.replace(/\.exp3\.json$/, ''), File: 'expressions/' + f })),
  },
  Groups: [
    { Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthForm', 'ParamMouthOpenY'] },
    { Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamEyeROpen'] },
  ],
};
fs.writeFileSync(path.join(STAGE, 'Furina.model3.json'), JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log('[write] Furina.model3.json  expressions =', doc.FileReferences.Expressions.length,
  ' motions groups =', Object.keys(doc.FileReferences.Motions).join('/'));

/* ---------- 3) 注入 work/src ---------- */
fs.rmSync(TARGET, { recursive: true, force: true });
fs.cpSync(STAGE, TARGET, { recursive: true });
console.log('[inject] ->', TARGET);

/* ---------- 4) 设置页加选项 ---------- */
const SETTINGS = path.join(TREE, 'dist/renderer/settings/index.html');
let html = fs.readFileSync(SETTINGS, 'utf8');
if (html.includes('value="furina"')) {
  console.log('[settings] 已含 furina，跳过');
} else {
  const k = 'id="pet-model"';
  const i = html.indexOf(k);
  if (i < 0) throw new Error('settings: 找不到 id="pet-model"');
  const j = html.indexOf('</option>', i);
  if (j < 0) throw new Error('settings: 在 pet-model 后找不到 </option>');
  const at = j + '</option>'.length;
  html = html.slice(0, at) + '\n                  <option value="furina">芙宁娜</option>' + html.slice(at);
  fs.writeFileSync(SETTINGS, html, 'utf8');
  console.log('[settings] 已插入 value="furina" 选项');
}

/* ---------- 5) live2d-actions.js ×2 ---------- */
const FURINA_ACTIONS = [
  { alias: '回正', description: '回到待机姿态', target: { kind: 'motion', group: 'Idle', motionName: '待机' } },
  { alias: '眨眨眼', description: '俏皮地眨一只眼睛', target: { kind: 'expression', name: '星星' } },
  { alias: '可爱一下', description: '害羞地装可爱', target: { kind: 'expression', name: '小脸红' } },
  { alias: '笑一笑', description: '对着你微笑', target: { kind: 'expression', name: '猫猫嘴' } },
  { alias: '戴墨镜', description: '戴帽子耍个帅', target: { kind: 'expression', name: '帽子' } },
  { alias: '问号', description: '头顶冒出一个问号', target: { kind: 'expression', name: '汗' } },
  { alias: '闪闪发光', description: '身上闪出光芒', target: { kind: 'expression', name: '呆毛电风扇' } },
  { alias: '星星眼', description: '眼睛变成星星形状', target: { kind: 'expression', name: '星星' } },
  { alias: '圈圈眼', description: '晕乎乎地摊手', target: { kind: 'motion', group: 'Tap', motionName: '摊手' } },
  { alias: '开心眼', description: '弯弯的笑眼', target: { kind: 'expression', name: '大聪明' } },
];
for (const rel of ['dist/main/shared/live2d-actions.js', 'dist/preload/shared/live2d-actions.js']) {
  const p = path.join(TREE, rel);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('furina:')) { console.log('[actions] 已含 furina，跳过', rel); continue; }
  const key = 'cyrene: exports.LIVE2D_ACTIONS,';
  const n = s.split(key).length - 1;
  if (n !== 1) throw new Error(rel + ': cyrene 表定位失败，命中 ' + n);
  const block = '\n    furina: ' + JSON.stringify(FURINA_ACTIONS, null, 4).split('\n').join('\n    ') + ',';
  s = s.replace(key, key + block);
  fs.writeFileSync(p, s, 'utf8');
  execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
  console.log('[actions] 已加入 furina 表并通过 node --check:', rel);
}
console.log('[done] 注入完成');
