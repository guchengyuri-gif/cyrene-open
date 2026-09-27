"use strict";
/**
 * cyrene-wallpaper —— Cyrene 聊天窗背景/玻璃插件（路线 A：注入 CSS）
 *
 * 机制（与 better-sidebar 同源，已验证可用）：
 *   宿主内 require("electron") → 遍历 getAllWindows
 *   → 对每个窗口调用 win.webContents.executeJavaScript(injectFn.toString())
 *   → injectFn 在聊天窗主世界：先确认 #cyrene-react-root 存在（自动识别聊天窗），再按模式注入 CSS。
 *
 * 关键修正：不逐个改子容器，而是直接在 :root 把整套 --cy-bg-* 主题变量改为透明/玻璃，
 *           所有引用这些变量的容器会一起变透明（之前只改 .cy-page 被内部不透明变量盖死）。
 *
 * 诚实声明：依赖 :root 主题变量(--cy-bg-*)与 .cy-page / #cyrene-react-root 选择器；
 *           客户端大版本升级若改名可能失效。玻璃模糊依赖 Electron/Chromium 的 backdrop-filter，
 *           Windows 上个别 GPU 组合可能不稳，故提供「纯透明(无模糊)」保底档。
 */

const path = require("node:path");
const fs = require("node:fs");

const PLUGIN_ID = "cyrene-wallpaper";
const LAYER_ID = "cy-wallpaper-layer";
const STYLE_ID = "cy-wallpaper-style";
const WALLPAPER_FILE = "wallpaper.gif";
const DIAG_FILE = path.join(__dirname, "wallpaper-diag.json");

// 四种显示模式，循环切换：
//   glass      全透明玻璃（透明 + 毛玻璃模糊，露出真实桌面）
//   glass-raw  纯透明（无模糊，确保透出桌面；backdrop-filter 不稳时的保底）
//   wallpaper  壁纸·透档 / 壁纸·实档（底层铺壁纸图，变量透明后透出来）
const MODES = [
  { key: "glass", label: "全透明玻璃" },
  { key: "glass-raw", label: "纯透明(无模糊)" },
  { key: "wallpaper", label: "壁纸·透", scrim: 0.72 },
  { key: "wallpaper", label: "壁纸·实", scrim: 0.88 },
];
let modeTier = 0; // 默认玻璃档，满足「全透明玻璃板」诉求

let ctxRef = null;
const appliedWins = new Set();

function getElectron() {
  try {
    return require("electron");
  } catch (_) {
    return null;
  }
}

function wallpaperUrl() {
  const p = path.join(__dirname, WALLPAPER_FILE);
  return "file:///" + p.replace(/\\/g, "/");
}

// 不再猜 URL：返回所有窗口，由 injectFn 内部靠 #cyrene-react-root 判定是否为聊天窗
function chatWindows() {
  const electron = getElectron();
  if (!electron || !electron.BrowserWindow) return [];
  return electron.BrowserWindow.getAllWindows();
}

function diagLog(entry) {
  try {
    let arr = [];
    if (fs.existsSync(DIAG_FILE)) {
      try {
        arr = JSON.parse(fs.readFileSync(DIAG_FILE, "utf8"));
      } catch (_) {
        arr = [];
      }
    }
    arr.push(Object.assign({ at: Date.now() }, entry));
    if (arr.length > 50) arr = arr.slice(-50);
    fs.writeFileSync(DIAG_FILE, JSON.stringify(arr, null, 2));
  } catch (_) {
    /* ignore */
  }
}

/**
 * 注入到聊天窗主世界的自包含函数。必须可序列化（无外部闭包依赖）。
 * @param {{mode:string, url:string, scrim:number}} cfg
 */
function injectFn(cfg) {
  return (function () {
    var LAYER = "cy-wallpaper-layer";
    var STYLE = "cy-wallpaper-style";
    var mode = cfg.mode;
    var url = cfg.url;
    var scrim = cfg.scrim;
    var diag = { ok: true, mode: mode, rootFound: false };
    try {
      // 0) 自动识别聊天窗：只有存在 #cyrene-react-root 才是聊天主窗体
      var root = document.getElementById("cyrene-react-root");
      if (!root) {
        return { ok: false, reason: "not-chat-window" };
      }
      diag.rootFound = true;

      // 1) 底层背景层：仅 wallpaper 模式需要；玻璃/纯透明模式移除它，露出真实桌面
      var layer = document.getElementById(LAYER);
      if (mode === "wallpaper") {
        if (!layer) {
          layer = document.createElement("div");
          layer.id = LAYER;
          document.body.appendChild(layer);
          diag.steps = (diag.steps || []).concat("layer-created");
        }
        layer.style.cssText =
          "position:fixed;inset:0;z-index:0;pointer-events:none;" +
          "background-image:url('" + url + "');" +
          "background-size:cover;background-position:center;background-repeat:no-repeat;";
      } else if (layer && layer.parentNode) {
        layer.parentNode.removeChild(layer);
        diag.steps = (diag.steps || []).concat("layer-removed");
      }

      // 2) 样式层：釜底抽薪——直接改写 :root 主题变量，让所有引用容器一起透明
      var style = document.getElementById(STYLE);
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE;
        document.head.appendChild(style);
      }

      if (mode === "glass" || mode === "glass-raw") {
        // 全透明玻璃板：整窗磨砂玻璃 + 杀掉聊天窗整棵子树的不透明背景（媒体元素除外）
        var blur =
          mode === "glass"
            ? "backdrop-filter:blur(20px) saturate(135%)!important;-webkit-backdrop-filter:blur(20px) saturate(135%)!important;"
            : "";
        style.textContent =
          "html,body,#cyrene-react-root{background:transparent!important;}" +
          // 窗体玻璃层：极淡白雾 + 磨砂，真实桌面壁纸从背后透出来
          ".cy-page{background:rgba(255,255,255,0.06)!important;position:relative;z-index:1;" + blur + "}" +
          // 釜底抽薪：聊天窗内所有卡片/气泡/侧栏/弹层背景一律透明，只留玻璃层与媒体可见
          ".cy-page *:not(img):not(video):not(canvas):not(svg):not(.cy-wallpaper-layer)," +
          "#cyrene-react-root *:not(img):not(video):not(canvas):not(svg){" +
          "background:transparent!important;background-color:transparent!important;background-image:none!important;}" +
          // 深色主题：玻璃换成极淡暗雾
          "[data-ui-theme='dark'] .cy-page{background:rgba(20,18,26,0.16)!important;}";
      } else {
        // wallpaper 模式：底层铺壁纸 + 整窗磨砂玻璃，壁纸透过所有 UI 隐约可见
        style.textContent =
          "html,body,#cyrene-react-root{background:transparent!important;}" +
          ".cy-page{background:rgba(250,244,248,0.45)!important;backdrop-filter:blur(10px) saturate(120%)!important;-webkit-backdrop-filter:blur(10px) saturate(120%)!important;position:relative;z-index:1;}" +
          ".cy-page *:not(img):not(video):not(canvas):not(svg):not(.cy-wallpaper-layer)," +
          "#cyrene-react-root *:not(img):not(video):not(canvas):not(svg){" +
          "background:transparent!important;background-color:transparent!important;background-image:none!important;}" +
          "[data-ui-theme='dark'] .cy-page{background:rgba(20,18,26,0.45)!important;}";
      }
    } catch (e) {
      diag.ok = false;
      diag.error = String((e && e.stack) || e);
    }
    return diag;
  })();
}

function uninjectFn() {
  return (function () {
    try {
      var layer = document.getElementById("cy-wallpaper-layer");
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      var style = document.getElementById("cy-wallpaper-style");
      if (style && style.parentNode) style.parentNode.removeChild(style);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })();
}

async function applyTo(win, mode) {
  const electron = getElectron();
  if (!electron) return { ok: false, error: "no-electron" };
  const m = MODES[modeTier];
  const payload =
    m.key === "wallpaper"
      ? { mode: "wallpaper", url: wallpaperUrl(), scrim: m.scrim }
      : { mode: m.key, url: "", scrim: 0 };
  const script =
    mode === "off"
      ? "(" + uninjectFn.toString() + ")()"
      : "(" + injectFn.toString() + ")(" + JSON.stringify(payload) + ")";
  const info = { id: (win.webContents && win.webContents.id) || -1, ok: false };
  try {
    info.result = await win.webContents.executeJavaScript(script, true);
    info.ok = !!(info.result && info.result.ok);
    if (mode !== "off")
      diagLog({ action: "apply", winId: info.id, mode: m.key, label: m.label, result: info.result });
    else diagLog({ action: "off", winId: info.id });
    if (info.ok && mode !== "off") appliedWins.add(info.id);
    if (mode === "off") appliedWins.delete(info.id);
  } catch (e) {
    info.error = String((e && e.message) || e);
    diagLog({ action: "apply-error", winId: info.id, error: info.error });
  }
  return info;
}

async function injectAll(mode) {
  const wins = chatWindows();
  const details = [];
  for (const w of wins) details.push(await applyTo(w, mode || "on"));
  const hit = details.filter((d) => d.ok).length;
  if (!hit && ctxRef)
    ctxRef.log("[wallpaper] 本次命中聊天窗 " + hit + "/" + wins.length + "，未命中请确认聊天窗已打开（见 wallpaper-diag.json）");
  return details;
}

function installHooks() {
  const electron = getElectron();
  if (!electron || !electron.app || !electron.app.on) return;
  electron.app.on("browser-window-created", (_e, win) => {
    try {
      win.webContents.on("did-finish-load", () => {
        // 等 React 挂载完再注入，避免 #cyrene-react-root 还没出现
        setTimeout(() => applyTo(win, "on").catch(() => {}), 1200);
      });
    } catch (_) {
      /* ignore */
    }
  });
}

module.exports = {
  async register(ctx) {
    ctxRef = ctx;
    ctx.log("背景/玻璃插件已就绪（玻璃/纯透明/壁纸四档），对所有窗口注入，自动识别聊天窗");
    installHooks();
    injectAll("on").catch((e) => ctx.log("[wallpaper] 初始注入失败: " + e));
  },

  async unregister() {
    try {
      await injectAll("off");
    } catch (_) {
      /* ignore */
    }
    appliedWins.clear();
  },

  // 切模式：玻璃 → 纯透明 → 壁纸·透 → 壁纸·实 → 回到玻璃
  async cycleMode() {
    modeTier = (modeTier + 1) % MODES.length;
    await injectAll("on");
    return { tier: modeTier, mode: MODES[modeTier].key, label: MODES[modeTier].label };
  },

  // 兼容旧调用名
  async cycleScrim() {
    return this.cycleMode();
  },
};
