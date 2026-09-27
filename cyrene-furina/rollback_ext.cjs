'use strict';
/* rollback_ext.cjs — 回滚到「外部模型目录改造」部署前的 app.asar（= 芙宁娜包） */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BAK = 'D:/ai/program/cyrene-furina/backup/app.asar.before-external-model';
const RES = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\resources';
const TARGET = path.join(RES, 'app.asar');

function cyreneRunning() {
  try {
    const out = execFileSync('tasklist', ['/fi', 'imagename eq Cyrene.exe', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    return /Cyrene\.exe/i.test(out);
  } catch { return false; }
}

console.log('=== Cyrene app.asar · 回滚（撤销外部模型目录改造）===\n');
if (!fs.existsSync(BAK)) { console.log('[错误] 找不到备份：' + BAK); process.exit(1); }
if (cyreneRunning()) {
  console.log('[中止] Cyrene 正在运行，请先完全退出再运行本脚本。');
  process.exit(2);
}
console.log('备份 : ' + BAK + '  (' + fs.statSync(BAK).size + ')');
fs.copyFileSync(BAK, TARGET);
console.log('已回滚 → ' + TARGET + '  (' + fs.statSync(TARGET).size + ')');
console.log('\n✅ 回滚完成。启动 Cyrene 即可回到改造前状态。');
console.log('注意：外部模型目录 pet-models 不会被删除，可保留备用。');
