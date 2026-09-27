'use strict';
// 把 work/src 重新打包成新的 app.asar
const fs = require('fs');
const asar = require('D:/ai/program/_tmp_cyrene/remote_repo/node_modules/@electron/asar');

const SRC = 'D:/ai/program/cyrene-furina/work/src';
const OUTDIR = 'D:/ai/program/cyrene-furina/out';
const OUT = OUTDIR + '/app.asar';

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  if (fs.existsSync(OUT)) fs.rmSync(OUT);
  const t0 = Date.now();
  await asar.createPackage(SRC, OUT);
  console.log('[pack] 完成，用时', ((Date.now() - t0) / 1000).toFixed(1), 's');
  console.log('[pack] 输出:', OUT);
  console.log('[pack] 大小:', fs.statSync(OUT).size);
})().catch((e) => { console.error('[pack] 失败:', e); process.exit(1); });
