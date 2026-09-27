'use strict';
const fs = require('fs');
const F = 'D:/ai/program/cyrene-furina/work/src/dist/preload/preload/index.js';
const s = fs.readFileSync(F, 'utf8');
console.log('len', s.length);
let i = 0, c = 0;
while ((i = s.indexOf('exposeInMainWorld', i)) >= 0 && c < 10) {
  console.log('\n===== exposeInMainWorld @' + i + ' =====');
  console.log(s.slice(Math.max(0, i - 100), i + 1600));
  i += 10; c++;
}
console.log('\n--- probe tokens ---');
for (const t of ['contextBridge', 'require("fs")', "require('fs')", 'readdir', 'ipcRenderer.invoke', 'MODEL', 'PET_MODEL']) {
  const n = s.split(t).length - 1;
  console.log(t, '=>', n);
}
