'use strict';
/* deploy.cjs — 把新 app.asar 部署到 Cyrene（先备份，再复制，再校验）
 * 由 deploy.bat 调用（bat 里已 chcp 65001，中文可正常显示）。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const NEW = 'D:/ai/program/cyrene-furina/out/app.asar';
const RES = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\resources';
const TARGET = path.join(RES, 'app.asar');
const BAKDIR = 'D:/ai/program/cyrene-furina/backup';
const BAK = path.join(BAKDIR, 'app.asar.before-furina');

function sha256(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  const b = Buffer.alloc(8 * 1024 * 1024);
  let n;
  while ((n = fs.readSync(fd, b, 0, b.length, null)) > 0) h.update(b.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}
function cyreneRunning() {
  try {
    const out = execFileSync('tasklist', ['/fi', 'imagename eq Cyrene.exe', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    return /Cyrene\.exe/i.test(out);
  } catch (e) { return false; }
}

console.log('=== Cyrene + 芙宁娜 模型 · 部署 ===\n');
if (!fs.existsSync(NEW)) { console.log('[错误] 找不到新包：' + NEW); process.exit(1); }
console.log('新包 : ' + NEW);
console.log('大小 : ' + fs.statSync(NEW).size);

if (cyreneRunning()) {
  console.log('\n[中止] Cyrene 正在运行。');
  console.log('请先在托盘图标上右键 → 退出（完全退出），再重新运行本脚本。');
  process.exit(2);
}
console.log('进程 : Cyrene 未运行 ✓');

fs.mkdirSync(BAKDIR, { recursive: true });
if (!fs.existsSync(BAK)) {
  console.log('\n备份 : 现网 app.asar → ' + BAK);
  fs.copyFileSync(TARGET, BAK);
} else {
  console.log('\n备份 : 已存在，跳过（' + BAK + '）');
}
console.log('备份大小 : ' + fs.statSync(BAK).size);

console.log('\n复制 : 新包 → ' + TARGET);
fs.copyFileSync(NEW, TARGET);

const a = sha256(NEW);
const b = sha256(TARGET);
console.log('\n新包 sha256 : ' + a);
console.log('写入 sha256 : ' + b);
if (a !== b) {
  console.log('\n[错误] 校验失败，写入内容不一致！请运行 rollback.bat 回滚。');
  process.exit(1);
}
console.log('\n✅ 部署完成，校验一致。');
console.log('下一步：启动 Cyrene → 设置 → 桌宠模型 → 选择「芙宁娜」。');
