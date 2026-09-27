'use strict';
/* install_model.cjs — 把 Live2D 模型装进 Cyrene 的外部模型目录
 *
 * 用法：node install_model.cjs "<模型目录>" [模型ID]
 *
 *   · 模型ID 只能是 [A-Za-z0-9_-]（渲染层会把其它字符过滤掉），省略时由目录名推断
 *   · 安装位置：%APPDATA%\live2d-cyrene\pet-models\<模型ID>\
 *   · 会自动把 model3.json 重命名为 <ID首字母大写>.model3.json（这是 Cyrene 的硬规则）
 *
 * 装好后：Cyrene 设置 → 桌宠模型 → 填 <模型ID> → 立即生效，无需重启。
 */
const fs = require('fs');
const path = require('path');

const PETROOT = path.join(process.env.APPDATA || '', 'live2d-cyrene', 'pet-models');
const src = process.argv[2];
let id = process.argv[3];

function rootModel3(dir) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.model3.json')) return f;
    }
  } catch { /* ignore */ }
  return null;
}

if (!src) {
  console.log('用法: node install_model.cjs "<模型目录>" [模型ID]');
  console.log('示例: node install_model.cjs "D:\\models\\miku" miku');
  console.log('\n安装位置: ' + PETROOT);
  process.exit(1);
}
if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
  console.log('[错误] 不是有效目录: ' + src);
  process.exit(1);
}

// 定位模型根（兼容「解压后多包一层目录」）
let modelRoot = src;
let m3 = rootModel3(src);
if (!m3) {
  for (const d of fs.readdirSync(src, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const sub = path.join(src, d.name);
    const f = rootModel3(sub);
    if (f) { modelRoot = sub; m3 = f; break; }
  }
}
if (!m3) {
  console.log('[错误] 在目录里找不到 *.model3.json（模型根目录需要直接包含它）');
  console.log('  已检查: ' + src);
  process.exit(1);
}

// 推断 / 校验 ID
if (!id) id = path.basename(modelRoot);
const cleaned = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
if (!cleaned) {
  console.log('[错误] 模型 ID 推断失败（"' + id + '" 里没有可用字符），请显式指定，例如：');
  console.log('  node install_model.cjs "' + src + '" mymodel');
  process.exit(1);
}
if (cleaned !== id) {
  console.log('[注意] 模型 ID "' + id + '" 含非法字符，已按 Cyrene 规则改为 "' + cleaned + '"');
  id = cleaned;
}

const cap = id.charAt(0).toUpperCase() + id.slice(1);
const targetM3 = cap + '.model3.json';
const dest = path.join(PETROOT, id);

console.log('=== 安装 Live2D 模型 ===');
console.log('源目录   : ' + modelRoot);
console.log('model3   : ' + m3);
console.log('模型 ID  : ' + id);
console.log('目标目录 : ' + dest);
console.log('期望文件名: ' + targetM3);

if (dest.toLowerCase() === path.resolve(modelRoot).toLowerCase()) {
  console.log('\n[跳过] 源目录已经是目标目录。');
  process.exit(0);
}

fs.mkdirSync(PETROOT, { recursive: true });
if (fs.existsSync(dest)) {
  const bak = dest + '_bak_' + new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  console.log('\n[提示] 目标已存在，旧版本先改名为: ' + path.basename(bak));
  fs.renameSync(dest, bak);
}

console.log('\n复制中…');
fs.cpSync(modelRoot, dest, { recursive: true });

// 重命名 model3.json
let renamed = false;
if (path.join(dest, m3) !== path.join(dest, targetM3)) {
  fs.renameSync(path.join(dest, m3), path.join(dest, targetM3));
  renamed = true;
}
console.log('[复制] 完成');
if (renamed) console.log('[改名] ' + m3 + ' → ' + targetM3);

// 结果自检
const files = fs.readdirSync(dest);
console.log('\n目录内容 (' + files.length + ' 项): ' + files.slice(0, 12).join(', ') + (files.length > 12 ? ' …' : ''));
if (!fs.existsSync(path.join(dest, targetM3))) {
  console.log('\n[警告] 没找到 ' + targetM3 + '，Cyrene 可能加载不了这个模型。');
  process.exit(1);
}

console.log('\n✅ 安装完成。');
console.log('下一步：打开 Cyrene → 设置 → 桌宠模型 → 填入 "' + id + '"（回车确认）→ 桌宠立即重载。');
