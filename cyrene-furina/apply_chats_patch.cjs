'use strict';
/* 把 09-15 的 chats-store 补丁等长写回指定 app.asar（默认目标 = 待部署新包）
 * 用法:
 *   node apply_chats_patch.cjs [asar路径]            → 写入 v2
 *   node apply_chats_patch.cjs [asar路径] --revert   → 还原为原件
 * 等长覆写：不改 header、不动 asar 体积，其余文件字节不动。
 */
const fs = require('fs');
const crypto = require('crypto');

const argv = process.argv.slice(2);
const ASAR = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'D:/ai/program/cyrene-furina/out/app.asar';
const REVERT = argv.includes('--revert');
const HERE = 'D:/ai/program/cyrene-asar-patch/perf-patch-20260915';
const TARGET = 'dist/main/main/chats/chats-store.js';
const BACKUP_DIR = 'D:/ai/program/cyrene-furina/backup';
const EXPECT_SIZE = 22314;

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const ORIG = fs.readFileSync(HERE + '/chats-store.orig.js');
const V1 = fs.readFileSync(HERE + '/chats-store.v1.js');
const V2 = fs.readFileSync(HERE + '/chats-store.patched.js');
for (const [n, b] of [['orig', ORIG], ['v1', V1], ['v2', V2]]) {
  if (b.length !== EXPECT_SIZE) { console.error(`!! ${n} 长度 ${b.length} != ${EXPECT_SIZE}`); process.exit(2); }
}
console.log('asar :', ASAR);
console.log('orig md5:', md5(ORIG));
console.log('v1   md5:', md5(V1));
console.log('v2   md5:', md5(V2));

const fd = fs.openSync(ASAR, 'r+');
const hb = Buffer.alloc(8);
fs.readSync(fd, hb, 0, 8, 0);
const headerSize = hb.readUInt32LE(4);
const region = Buffer.alloc(headerSize);
fs.readSync(fd, region, 0, headerSize, 8);
const s = region.toString('utf8');
const root = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
let node = root;
for (const part of TARGET.split('/')) node = node.files[part];
const off = 8 + headerSize + Number(node.offset);
const size = Number(node.size);
console.log('offset:', off, 'size:', size);
if (size !== EXPECT_SIZE) { console.error('!! asar 内该文件长度变了，可能应用已升级，中止'); fs.closeSync(fd); process.exit(2); }

const before = Buffer.alloc(size);
fs.readSync(fd, before, 0, size, off);
console.log('区域现值 md5:', md5(before));

const want = REVERT ? ORIG : V2;
const wantName = REVERT ? 'orig' : 'v2';
if (before.equals(want)) { console.log(`★ 已经是 ${wantName}，无需写入。`); fs.closeSync(fd); process.exit(0); }
if (![ORIG, V1, V2].some((b) => b.equals(before))) {
  console.error('!! 现值不属于已知的 orig/v1/v2，中止'); fs.closeSync(fd); process.exit(2);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const bak = BACKUP_DIR + '/chats-store.region-before-' + md5(before).slice(0, 8) + '.js';
fs.writeFileSync(bak, before);
console.log('原区段已备份:', bak);

fs.writeSync(fd, want, 0, want.length, off);
fs.fsyncSync(fd);

const after = Buffer.alloc(size);
fs.readSync(fd, after, 0, size, off);
const total = fs.statSync(ASAR).size;
fs.closeSync(fd);
console.log('写入后 md5:', md5(after), '| 等于目标:', after.equals(want));
console.log('asar 总大小:', total, '(等长覆写，应为原值)');
console.log(after.equals(want) ? `★ 写入成功（→ ${wantName}）` : '!! 校验失败');
process.exit(after.equals(want) ? 0 : 1);
