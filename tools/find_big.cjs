const fs = require('fs'), p = require('path');
const roots = ['plugins', 'skills', 'prompts', 'cyrene-furina', 'tools', 'docs', 'config'];
const base0 = 'D:\\ai\\program\\cyrene-open';
let big = [];
for (const r of roots) {
  const base = p.join(base0, r);
  if (!fs.existsSync(base)) continue;
  (function walk(d) {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = p.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        let s = 0; try { s = fs.statSync(f).size; } catch {}
        if (s > 2e6) big.push([Math.round(s / 1048576) + 'MB', f.replace(base0 + '\\', '')]);
      }
    }
  })(base);
}
big.sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
big.slice(0, 30).forEach(b => console.log(b.join('  ')));
console.log('count over 2MB:', big.length);
