const fs = require('fs');
const f = 'D:/ai/program/cyrene-furina/work/src/dist/renderer/assets/renderer-DtFVcmkW.js';
const s = fs.readFileSync(f, 'utf8');

// 1. 找出所有 "live2d:xxx" 形式的 channel 字符串（渲染端监听的）
const channels = new Set();
let re = /"live2d:[a-z\-]+"/g;
let m;
while ((m = re.exec(s)) !== null) channels.add(m[0]);
console.log('=== renderer 中所有 live2d: 开头的字符串字面量 ===');
for (const c of [...channels].sort()) console.log('  ' + c);

// 2. 找出所有 .on("xxx" 监听注册（channel 名字面量）
const onChannels = new Set();
re = /\.on\("([^"]{2,60})"/g;
while ((m = re.exec(s)) !== null) onChannels.add(m[1]);
console.log('=== renderer 中 .on("...") 监听的 channel 名（前40）===');
for (const c of [...onChannels].filter(x => !x.includes(' ')).sort().slice(0, 40)) console.log('  ' + c);

// 3. playAction 函数体上下文
console.log('=== playAction 出现位置 ===');
let idx = 0;
while ((idx = s.indexOf('playAction', idx)) !== -1) {
  console.log('--- @' + idx + ' ---');
  console.log(s.slice(Math.max(0, idx - 250), idx + 400).replace(/\n/g, ' '));
  idx += 10;
  if (idx > s.length) break;
}

// 4. setExpression 上下文（第一个）
console.log('=== setExpression 第一个上下文 ===');
const si = s.indexOf('setExpression');
console.log(s.slice(Math.max(0, si - 300), si + 300).replace(/\n/g, ' '));

// 5. 找 model 加载相关的 url 处理（pet-models / external / userData）
console.log('=== pet-models / huohuo / external / userData 出现位置 ===');
for (const k of ['pet-models', 'huohuo', 'Huohuo', 'petModels', 'userData']) {
  let i = 0, c = 0, first = -1;
  while ((i = s.indexOf(k, i)) !== -1) { if (first === -1) first = i; c++; i += k.length; }
  console.log('  ' + k + ': ' + c + (first >= 0 ? ' first@' + first : ''));
  if (first >= 0 && (k === 'pet-models' || k === 'userData')) {
    console.log('    ctx: ' + s.slice(Math.max(0, first - 200), first + 250).replace(/\n/g, ' '));
  }
}
