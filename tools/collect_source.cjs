// 一次性拷贝脚本：从本机 Cyrene 安装目录与用户数据目录收集开源内容
// 排除规则：
//  - 目录：node_modules, dist, build, .git, .playwright-mcp, __pycache__, .cache, cache, .venv, venv
//  - 文件：*.log, *.lock, package-lock.json, *.png, *.jpg, *.jpeg, *.gif, *.webp, *.mp3, *.mp4, *.wav, *.ogg,
//          *.asar, *.bak*, *.exe, *.dll, *.bin, *.dat, *.pak, *.mo, *.msi, *.zip, *.7z, *.rar
//  - 内容含密钥嫌疑的文件（mcp-servers.json、*-settings.json 等不拷，只拷 .example）
// 用法：node tools/collect_source.cjs
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..');
const PLUGINS = 'C:\\Users\\ADMIN\\AppData\\Roaming\\live2d-cyrene\\plugins';
const SKILLS_USER = 'C:\\Users\\ADMIN\\AppData\\Roaming\\live2d-cyrene\\skills';
const PROMPTS = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\prompts';
const SKILLS_APP = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\skills';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.playwright-mcp', '__pycache__', '.cache', 'cache', '.venv', 'venv']);
const SKIP_EXT = new Set(['.log', '.lock', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.mp4', '.wav', '.ogg', '.asar', '.exe', '.dll', '.bin', '.dat', '.pak', '.mo', '.msi', '.zip', '.7z', '.rar', '.bak', '.tmp', '.sqlite', '.sqlite3', '.db']);
const SKIP_NAMES = new Set(['package-lock.json', '.DS_Store', 'Thumbs.db']);

let copied = 0, bytes = 0;
const skippedFiles = [];

function shouldCopyFile(name) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot >= 0 && SKIP_EXT.has(lower.slice(dot))) return false;
  if (SKIP_NAMES.has(lower)) return false;
  if (lower.includes('.bak')) return false;
  return true;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (err) {
    console.log('  !! 无法读取目录（跳过）：', src, err.code);
    return;
  }
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name.toLowerCase())) { skippedFiles.push(s + '/ (dir)'); continue; }
      copyTree(s, d);
    } else if (e.isFile()) {
      if (!shouldCopyFile(e.name)) { skippedFiles.push(s + ' (' + e.name + ')'); continue; }
      fs.copyFileSync(s, d);
      copied++;
      bytes += fs.statSync(s).size;
    }
  }
}

function collect(src, dest, onlyDirs) {
  for (const name of fs.readdirSync(src, { withFileTypes: true })) {
    if (!name.isDirectory) continue;
    if (onlyDirs && !onlyDirs.includes(name.name)) continue;
    copyTree(path.join(src, name.name), path.join(dest, name.name));
  }
}

console.log('== plugins ==');
collect(PLUGINS, path.join(OUT, 'plugins'));
console.log('== skills (user) ==');
collect(SKILLS_USER, path.join(OUT, 'skills'));
console.log('== prompts (app) ==');
copyTree(PROMPTS, path.join(OUT, 'prompts'));
console.log('== skills (app built-in) ==');
copyTree(SKILLS_APP, path.join(OUT, 'skills'));
console.log('== furina scaffolding ==');
copyTree('D:\\ai\\program\\cyrene-furina', path.join(OUT, 'cyrene-furina'));

console.log('COPIED', copied, 'files,', Math.round(bytes / 1024 / 10) / 100, 'MB');
console.log('SKIPPED', skippedFiles.length, 'items, 前 20 条：');
skippedFiles.slice(0, 20).forEach(s => console.log('  -', s));
