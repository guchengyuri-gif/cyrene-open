'use strict';
// 从「现网安装版 app.asar」提取干净源（含多模型修复 + 卡顿补丁内容）到 work/src
const fs = require('fs');
const path = require('path');
const asar = require('D:/ai/program/_tmp_cyrene/remote_repo/node_modules/@electron/asar');

const SRC = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\resources\\app.asar';
const DEST = 'D:/ai/program/cyrene-furina/work/src';

if (fs.existsSync(DEST)) {
  console.log('[extract] 清理旧目录 ...');
  fs.rmSync(DEST, { recursive: true, force: true });
}
fs.mkdirSync(DEST, { recursive: true });

const t0 = Date.now();
asar.extractAll(SRC, DEST);
console.log('[extract] extractAll 完成，用时', ((Date.now() - t0) / 1000).toFixed(1), 's');

let n = 0, bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else { n++; bytes += fs.statSync(p).size; }
  }
})(DEST);
console.log('[extract] 文件数:', n, ' 字节:', bytes, '(' + (bytes / 1048576).toFixed(1) + ' MB)');

// 抽查关键文件存在
for (const rel of [
  'dist/main/main/orchestrator/task-runtime.js',
  'dist/main/main/tasks/task-session-store.js',
  'dist/main/shared/live2d-actions.js',
  'dist/preload/shared/live2d-actions.js',
  'dist/renderer/settings/index.html',
  'dist/renderer/models/cyrene/Cyrene.model3.json',
  'package.json',
]) {
  console.log('[check]', fs.existsSync(path.join(DEST, rel)) ? 'OK  ' : 'MISS', rel);
}
