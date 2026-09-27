'use strict';
const crypto = require('crypto');
const fs = require('fs');
const files = process.argv.slice(2);
let i = 0;
(function next() {
  if (i >= files.length) return;
  const p = files[i++];
  if (!fs.existsSync(p)) { console.log('MISSING  ' + p); return next(); }
  const h = crypto.createHash('sha256');
  const st = fs.statSync(p);
  const s = fs.createReadStream(p);
  s.on('data', (d) => h.update(d));
  s.on('end', () => { console.log(h.digest('hex') + '  ' + st.size + '  ' + p); next(); });
  s.on('error', (e) => { console.log('ERR ' + e.message + ' ' + p); next(); });
})();
