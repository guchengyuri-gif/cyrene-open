'use strict';
// check_scheduler.cjs — 校验「方案 C 调度器 + 拖拽 + 藿藿动作表」是否都在新 asar 里
//   直接对 out/app.asar 做内容级断言，不做与旧包的 diff 对比
//   （旧包是上一版 external-model 版，diff 会包含本轮全部改动，不适用）
const fs = require('fs');
const NEW = 'D:/ai/program/cyrene-furina/out/app.asar';

function openAsar(p) {
  const fd = fs.openSync(p, 'r');
  const hb = Buffer.alloc(8);
  fs.readSync(fd, hb, 0, 8, 0);
  const headerSize = hb.readUInt32LE(4);
  const region = Buffer.alloc(headerSize);
  fs.readSync(fd, region, 0, headerSize, 8);
  const s = region.toString('utf8');
  const root = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  const dataStart = 8 + headerSize;
  const map = new Map();
  (function walk(node, prefix) {
    const files = node.files || {};
    for (const nm of Object.keys(files)) {
      const v = files[nm];
      const p2 = prefix + '/' + nm;
      if (v.files) walk(v, p2);
      else map.set(p2, { size: v.size, offset: Number(v.offset), unpacked: !!v.unpacked });
    }
  })(root, '');
  return { fd, dataStart, map, fileSize: fs.statSync(p).size };
}
function readEntry(a, rel) {
  const e = a.map.get('/' + rel.replace(/^\//, ''));
  if (!e) return null;
  const b = Buffer.alloc(e.size);
  fs.readSync(a.fd, b, 0, e.size, a.dataStart + e.offset);
  return b;
}

let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };

const a = openAsar(NEW);
console.log('== 新 asar ==');
console.log('  size:', a.fileSize, '| entries:', a.map.size);

// 1) 藿藿动作表（main + preload 两份 live2d-actions.js 都要有）
console.log('\n== 1) 藿藿动作表 ==');
for (const rel of ['dist/main/shared/live2d-actions.js', 'dist/preload/shared/live2d-actions.js']) {
  const s = readEntry(a, rel).toString('utf8');
  ok(s.includes('huohuo: ['), rel + ': huohuo: 动作表存在');
  ok(s.includes('"motionName": "yaotou"'), rel + ': huohuo 歪头 motion');
  ok(s.includes('"motionName": "zhentou"'), rel + ': huohuo 点头 motion');
  ok(s.includes('"motionName": "keshui"'), rel + ': huohuo 流泪 motion');
  ok(s.includes('"motionName": "linghun"'), rel + ': huohuo 灵魂出窍 motion');
  ok(s.includes('"motionName": "qizi"'), rel + ': huohuo 拿旗子 motion');
  ok(s.includes('"name": "白眼"'), rel + ': huohuo 白眼 expression');
  ok(s.includes('"name": "黑脸"'), rel + ': huohuo 黑脸 expression');
  ok(s.includes('"name": "眼泪"'), rel + ': huohuo 眼泪 expression');
  ok(s.includes('"name": "抱枕"'), rel + ': huohuo 抱枕 expression');
  ok(s.includes('"name": "拿旗子"'), rel + ': huohuo 拿旗子 expression');
}

// 2) 渲染端拖拽脚本
console.log('\n== 2) 渲染端拖拽脚本 ==');
const html = readEntry(a, 'dist/renderer/index.html').toString('utf8');
ok(html.includes('live2d-canvas'), 'index.html: live2d-canvas 容器存在');
ok(html.includes('mousedown'), 'index.html: mousedown 监听已注入');
ok(html.includes('api.moveBy'), 'index.html: 调用 api.moveBy 相对移动');
ok(html.includes('api.setInteractive'), 'index.html: 调用 api.setInteractive 切穿透');
ok(html.includes('api.setDragging'), 'index.html: 调用 api.setDragging 拖拽态');
ok(html.includes('THRESHOLD'), 'index.html: 3px 阈值防误触');

// 3) 主进程 ActionScheduler
console.log('\n== 3) 主进程 ActionScheduler ==');
const dd = readEntry(a, 'dist/main/main/application/default-dependencies.js').toString('utf8');
ok(dd.includes('startLive2dActionScheduler'), 'default-deps: 调度器工厂函数存在');
ok(dd.includes('IDLE_MIN_MS'), 'default-deps: Idle 最小间隔常量');
ok(dd.includes('IDLE_MAX_MS'), 'default-deps: Idle 最大间隔常量');
ok(dd.includes('COOLDOWN_MS'), 'default-deps: 冷却常量');
ok(dd.includes('scheduleNext'), 'default-deps: scheduleNext 定时器管理');
ok(dd.includes('canFire'), 'default-deps: canFire 冷却去抖');
ok(dd.includes('shell.windowManager.sendToPetWindow(channelsModule.IPC.LIVE2D_PLAY_ACTION'), 'default-deps: 通过 sendToPetWindow 触发 LIVE2D_PLAY_ACTION');
ok(dd.includes('channelsModule.IPC.PET_MODEL_CHANGED'), 'default-deps: 监听 PET_MODEL_CHANGED 切换模型');
ok(dd.includes('a.alias !== "回正"'), 'default-deps: Idle 过滤掉"回正"');

// 4) IPC 通道完整性（拖拽依赖的 3 个 channel 必须在 ipc-channels 里）
console.log('\n== 4) IPC 通道完整性 ==');
const ch = readEntry(a, 'dist/main/shared/ipc-channels.js').toString('utf8');
ok(ch.includes('WINDOW_SET_INTERACTIVE: "window:set-interactive"'), 'ipc-channels: WINDOW_SET_INTERACTIVE');
ok(ch.includes('WINDOW_MOVE: "window:move"'), 'ipc-channels: WINDOW_MOVE');
ok(ch.includes('WINDOW_MOVE_TO: "window:move-to"'), 'ipc-channels: WINDOW_MOVE_TO');
ok(ch.includes('WINDOW_SET_DRAGGING: "window:set-dragging"'), 'ipc-channels: WINDOW_SET_DRAGGING');
ok(ch.includes('PET_MODEL_CHANGED: "pet:model-changed"'), 'ipc-channels: PET_MODEL_CHANGED');
ok(ch.includes('LIVE2D_PLAY_ACTION: "live2d:play-action"'), 'ipc-channels: LIVE2D_PLAY_ACTION');

// 5) preload 暴露拖拽 API（渲染端调的 window.cyrene.moveBy/setInteractive/setDragging）
console.log('\n== 5) preload 拖拽 API ==');
const preload = readEntry(a, 'dist/preload/preload/index.js').toString('utf8');
ok(preload.includes('moveBy:'), 'preload: moveBy API 已暴露');
ok(preload.includes('setInteractive:'), 'preload: setInteractive API 已暴露');
ok(preload.includes('setDragging:'), 'preload: setDragging API 已暴露');
ok(preload.includes('moveTo:'), 'preload: moveTo API 已暴露');

// 6) 藿藿 model3.json 在外部 pet-models 目录（不在 asar 内，直接读文件系统）
console.log('\n== 6) 藿藿 model3.json（外部文件）==');
const HH = 'C:/Users/ADMIN/AppData/Roaming/live2d-cyrene/pet-models/huohuo/Huohuo.model3.json';
if (fs.existsSync(HH)) {
  const hh = fs.readFileSync(HH, 'utf8');
  ok(hh.includes('"Motions"'), 'Huohuo.model3.json: FileReferences.Motions 已注册');
  ok(hh.includes('"Expressions"'), 'Huohuo.model3.json: FileReferences.Expressions 已注册');
  ok(hh.includes('yaotou.motion3.json'), 'Huohuo.model3.json: yaotou motion');
  ok(hh.includes('keshui.motion3.json'), 'Huohuo.model3.json: keshui motion');
  ok(hh.includes('linghun.motion3.json'), 'Huohuo.model3.json: linghun motion');
  ok(hh.includes('qizi.motion3.json'), 'Huohuo.model3.json: qizi motion');
  ok(hh.includes('白眼.exp3.json'), 'Huohuo.model3.json: 白眼 expression');
  ok(hh.includes('黑脸.exp3.json'), 'Huohuo.model3.json: 黑脸 expression');
  ok(hh.includes('眼泪.exp3.json'), 'Huohuo.model3.json: 眼泪 expression');
  ok(hh.includes('抱枕.exp3.json'), 'Huohuo.model3.json: 抱枕 expression');
  ok(hh.includes('拿旗子.exp3.json'), 'Huohuo.model3.json: 拿旗子 expression');
  ok(hh.includes('"Idle"'), 'Huohuo.model3.json: Groups.Idle 已指向"动作"组');
  ok(hh.includes('"Scene1 复制 复制"'), 'Huohuo.model3.json: Idle 指向 Scene1 复制 复制');
} else {
  ok(false, 'Huohuo.model3.json 不存在: ' + HH);
}

console.log('\n===== 校验结论:', fail ? 'FAIL ❌ (' + fail + ')' : 'PASS ✅', '=====');
fs.closeSync(a.fd);
process.exit(fail ? 1 : 0);
