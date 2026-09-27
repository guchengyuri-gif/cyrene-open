'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/ai/program/cyrene-furina/work/src/dist/main';
const TOKENS = ['webPreferences', 'contextIsolation', 'webSecurity', 'loadFile', 'loadURL', 'sandbox:', 'registerFileProtocol', 'protocol.handle', 'setWindowOpenHandler', 'nodeIntegration', 'allowRunningInsecureContent'];
const hits = {};
for (const t of TOKENS) hits[t] = [];
function walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) {
      let s;
      try { s = fs.readFileSync(p, 'utf8'); } catch (err) { continue; }
      for (const t of TOKENS) {
        let i = s.indexOf(t);
        while (i >= 0 && hits[t].length < 12) {
          const line = s.slice(Math.max(0, i - 120), i + 160).replace(/\n/g, ' ');
          hits[t].push(path.relative(ROOT, p) + ' @' + i + ' :: ' + line);
          i = s.indexOf(t, i + t.length);
        }
      }
    }
  }
}
walk(ROOT);
for (const t of TOKENS) {
  console.log('\n########## ' + t + ' (' + hits[t].length + ') ##########');
  for (const h of hits[t]) console.log(h);
}
