// 修复藿藿表情：中文 exp3 文件名 -> ASCII，规避 cyrene-model 协议对中文 URL 的加载失败
const fs = require('fs');
const path = require('path');
const d = 'C:/Users/ADMIN/AppData/Roaming/live2d-cyrene/pet-models/huohuo/';

const map = {
  '白眼': 'baiyan',
  '抱枕': 'baozhen',
  '黑脸': 'heilian',
  '拿旗子': 'naqizi',
  '眼泪': 'yanlei',
};

// 1. 备份原始 model3（含中文 File 引用）
const model3Path = path.join(d, 'Huohuo.model3.json');
const bakPath = path.join(d, 'Huohuo.model3.json.bak-chinese-expr');
if (!fs.existsSync(bakPath)) {
  fs.copyFileSync(model3Path, bakPath);
  console.log('backup created:', bakPath);
} else {
  console.log('backup exists:', bakPath);
}

// 2. 复制中文 exp3 -> ASCII 文件名
for (const [cn, en] of Object.entries(map)) {
  const src = path.join(d, cn + '.exp3.json');
  const dst = path.join(d, en + '.exp3.json');
  if (!fs.existsSync(src)) {
    console.log('SKIP (src missing):', cn);
    continue;
  }
  fs.copyFileSync(src, dst);
  console.log('copied:', cn, '->', en, 'exists:', fs.existsSync(dst));
}

// 3. 更新 model3.json Expressions 的 File 为 ASCII
const m = JSON.parse(fs.readFileSync(model3Path, 'utf8'));
for (const e of m.FileReferences.Expressions) {
  const en = map[e.Name];
  if (en) {
    e.File = en + '.exp3.json';
  }
}
fs.writeFileSync(model3Path, JSON.stringify(m, null, 2), 'utf8');
console.log('--- updated model3 Expressions:');
console.log(JSON.stringify(m.FileReferences.Expressions, null, 2));
console.log('DONE');
