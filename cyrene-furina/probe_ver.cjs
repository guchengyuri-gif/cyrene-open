'use strict';
// 探测 Cyrene 实际使用的 Electron 版本（决定 file:// 宽松策略是否可靠）
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\Cyrene.exe';

function tryRun(label, fn) {
  try { console.log(label, '=', fn()); }
  catch (e) { console.log(label, 'ERR:', e.message.split('\n')[0]); }
}

tryRun('Cyrene.exe ProductVersion', () =>
  execFileSync('powershell', ['-NoProfile', '-Command',
    `(Get-Item '${EXE}').VersionInfo.ProductVersion`], { encoding: 'utf8' }).trim());

tryRun('Cyrene.exe FileVersion', () =>
  execFileSync('powershell', ['-NoProfile', '-Command',
    `(Get-Item '${EXE}').VersionInfo.FileVersion`], { encoding: 'utf8' }).trim());

// 源码仓库里的 electron 依赖版本
const repoPkg = 'D:\\ai\\program\\_tmp_cyrene\\remote_repo\\package.json';
tryRun('remote_repo devDependencies.electron', () => {
  const p = JSON.parse(fs.readFileSync(repoPkg, 'utf8'));
  const d = Object.assign({}, p.dependencies, p.devDependencies);
  return JSON.stringify({ electron: d.electron, electronBuilder: d['electron-builder'] });
});

// asar 内是否有 electron 版本线索
tryRun('install electron dist version', () => {
  const v = path.join(path.dirname(EXE), 'resources', 'default_app.asar');
  return fs.existsSync(v) ? 'default_app.asar exists' : 'no default_app.asar';
});
