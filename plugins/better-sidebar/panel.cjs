"use strict";

/**
 * panel.cjs —— Cyrene「内嵌侧栏」宿主
 *
 * 把工作台以「右侧栏」的形态注入到 Cyrene 的聊天窗口里。
 *
 *   ┌ Cyrene 聊天窗（BrowserWindow, file://dist/renderer/react/index.html）
 *   │   ├─ #cyrene-react-root         ← 原生聊天区（挤压到左侧）
 *   │   └─ #cyrene-workbench-shell    ← 我们注入的侧栏（本文件负责）
 *   │         └─ <iframe src="http://127.0.0.1:<port>/">   ← 工作台本体（ui.html）
 *   └ 插件主进程
 *         ├─ HTTP 桥：/api/<channel> → 与 IPC 完全同一套 handler
 *         └─ webContents.executeJavaScript：注入 / 收回 / 查询诊断
 *
 * 通道说明（为什么不直接 IPC）：
 *   注入进聊天窗的脚本跑在页面主世界，聊天窗 preload 没有对插件开放的
 *   ipcRenderer 入口，所以渲染侧 → 主进程改走本机 HTTP（127.0.0.1 + session token）；
 *   主进程 → 渲染侧走 executeJavaScript；父文档 → iframe 走 postMessage。
 *
 * 诚实说明（不做隐瞒）：
 *   注入点依赖聊天窗**未公开的** DOM 结构（#cyrene-react-root）。
 *   客户端大版本升级后可能失效；所有失败都会写进 panelStatus，不静默吞掉。
 *   失败时的兜底是「独立窗口」，不会让用户彻底失去工作台。
 */

const http = require("node:http");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");

const SHELL_ID = "cyrene-workbench-shell";
const STYLE_ID = "cyrene-workbench-style";
const LAUNCHER_ID = "cyrene-workbench-launcher";
const HTML_CLASS = "cyrene-wb-on";
const ROOT_ID = "cyrene-react-root";
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * 侧栏宽度：仍然只留两档，但**按聊天窗实际宽度算比例**。
 * 起因（用户 2026-09-17）：「720 太窄了」——窗口 2560×1410 时 720 只占 28%，
 * 钉死像素必然偏窄；改成比例后，窗口多大两档就跟着多大。
 *   窄档 = 窗口宽 × 30%（下限 420 / 上限 1000）
 *   宽档 = 窗口宽 × 45%（下限 720 / 上限 1500）
 * 约束：宽档不能把聊天区压到 MIN_CHAT_WIDTH 以下；两档至少差 MIN_TIER_GAP。
 * ------------------------------------------------------------------ */

const WIDTH_RATIOS = [0.3, 0.45];
const WIDTH_CLAMPS = [
  [420, 1000],
  [720, 1500],
];
const MIN_CHAT_WIDTH = 480;
const MIN_TIER_GAP = 160;
const REF_WIDTH = 1440; // 拿不到窗口宽度时的参考值（→ 432 / 720，与旧版行为接近）
const HOTKEY = "Ctrl+Shift+B";

function clampNum(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** 聊天窗宽度 → [窄档, 宽档]（px）。非法输入回落参考宽度 */
function widthsFor(winWidth) {
  const w = Number(winWidth) > 0 ? Number(winWidth) : REF_WIDTH;
  const tiers = WIDTH_RATIOS.map((ratio, i) => clampNum(Math.round(w * ratio), WIDTH_CLAMPS[i][0], WIDTH_CLAMPS[i][1]));
  const maxWide = Math.max(WIDTH_CLAMPS[0][0], w - MIN_CHAT_WIDTH);
  if (tiers[1] > maxWide) tiers[1] = maxWide;
  if (tiers[1] < tiers[0] + MIN_TIER_GAP) tiers[1] = tiers[0] + MIN_TIER_GAP;
  return tiers;
}

/** 拿不到窗口宽度时的静态兜底（只用于展示，不用于实际注入） */
const PANEL_WIDTHS = widthsFor(REF_WIDTH);

/** 选中的 px 落在第几档（按最近匹配） */
function panelTier(value, winWidth) {
  const tiers = widthsFor(winWidth);
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  let best = 0;
  for (let i = 1; i < tiers.length; i += 1) {
    if (Math.abs(tiers[i] - n) < Math.abs(tiers[best] - n)) best = i;
  }
  return best;
}

/** 任意宽度 → 吸附到最近的一档；非法值回落第一档 */
function normalizePanelWidth(value, winWidth) {
  return widthsFor(winWidth)[panelTier(value, winWidth)];
}

/** 两档之间循环 */
function nextPanelWidth(value, winWidth) {
  const tiers = widthsFor(winWidth);
  return tiers[(panelTier(value, winWidth) + 1) % tiers.length];
}

/* ------------------------------------------------------------------ *
 * 注入样式（父文档侧）
 * ------------------------------------------------------------------ */

const PANEL_CSS = [
  ".cyrene-wb-shell{position:fixed;top:0;right:0;bottom:0;width:var(--cyrene-wb-w,420px);",
  "z-index:2147483600;display:flex;flex-direction:column;background:#17121d;",
  "border-left:1px solid rgba(247,168,207,.3);box-shadow:-14px 0 34px rgba(0,0,0,.5)}",
  ".cyrene-wb-shell.collapsed{display:none}",
  ".cyrene-wb-drag{flex:0 0 9px;height:9px;-webkit-app-region:drag;cursor:ns-resize;",
  "background:linear-gradient(180deg,rgba(247,168,207,.4),rgba(247,168,207,0))}",
  ".cyrene-wb-bar{flex:0 0 30px;height:30px;display:flex;align-items:center;gap:4px;",
  "padding:0 6px 0 10px;background:#1f1a27;border-bottom:1px solid rgba(247,168,207,.18);",
  "color:#ffd9e8;font:12px/1.5 'Microsoft YaHei','PingFang SC',system-ui,sans-serif;user-select:none}",
  ".cyrene-wb-title{font-weight:600;letter-spacing:.5px}",
  ".cyrene-wb-spacer{flex:1 1 auto}",
  ".cyrene-wb-btn{border:1px solid rgba(247,168,207,.22);background:#17121d;color:#f3eaf5;",
  "border-radius:6px;padding:1px 7px;font-size:12px;line-height:1.3;cursor:pointer}",
  ".cyrene-wb-btn:hover{background:rgba(247,168,207,.16)}",
  ".cyrene-wb-frame{flex:1 1 auto;width:100%;border:0;background:#17121d;display:block}",
  /* 常驻入口：展开 / 收起都在；展开时贴在侧栏左缘 */
  ".cyrene-wb-launcher{position:fixed;right:var(--cyrene-wb-w,420px);top:50%;",
  "transform:translateY(-50%);z-index:2147483601;writing-mode:vertical-rl;padding:16px 7px;",
  "border-radius:8px 0 0 8px;cursor:pointer;user-select:none;",
  "background:linear-gradient(135deg,#ffd9e8,#f7a8cf);color:#3a1f2e;",
  "font:600 12px/1 'Microsoft YaHei',sans-serif;letter-spacing:2px;",
  "box-shadow:-6px 0 18px rgba(0,0,0,.45);transition:right .18s ease,filter .15s ease}",
  ".cyrene-wb-launcher:hover{filter:brightness(1.08)}",
  ".cyrene-wb-shell.collapsed + .cyrene-wb-launcher{right:0}",
].join("");

/* ------------------------------------------------------------------ *
 * 注入脚本（会被序列化后塞进聊天窗执行，必须自包含）
 * ------------------------------------------------------------------ */

function injectFn(cfg) {
  return (async function () {
    var W = cfg.width;
    var PORT = cfg.port;
    var COLLAPSED = !!cfg.collapsed;
    var HOTKEY = cfg.hotkey || "Ctrl+Shift+B";
    var SHELL = "cyrene-workbench-shell";
    var STYLE = "cyrene-workbench-style";
    var LAUNCH = "cyrene-workbench-launcher";
    var ROOT = "cyrene-react-root";
    var diag = { ok: true, at: Date.now(), steps: [] };

    function byId(id) {
      return document.getElementById(id);
    }
    function drop(id) {
      var el = byId(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    function post(kind) {
      try {
        var f = document.querySelector("#" + SHELL + " iframe");
        if (f && f.contentWindow) f.contentWindow.postMessage({ bs: kind }, "*");
      } catch (e) {
        diag.steps.push("post-failed:" + String(e));
      }
    }

    try {
      var root = byId(ROOT);
      diag.rootFound = !!root;
      var target = root || document.body;

      var saved = window.__cyreneWbSaved;
      if (!saved) {
        saved = window.__cyreneWbSaved = { inline: null, squeezed: false };
      }

      function squeeze() {
        if (!saved.inline) {
          saved.inline = {
            width: target.style.width,
            right: target.style.right,
            maxWidth: target.style.maxWidth,
            position: target.style.position,
          };
        }
        var cs = getComputedStyle(target);
        diag.position = cs.position;
        if (cs.position === "fixed" || cs.position === "absolute") {
          target.style.setProperty("right", W + "px", "important");
          diag.mode = "inset-right";
        } else {
          target.style.setProperty("width", "calc(100% - " + W + "px)", "important");
          target.style.setProperty("max-width", "none", "important");
          diag.mode = "width";
        }
        saved.squeezed = true;
        document.documentElement.style.setProperty("--cyrene-wb-w", W + "px");
      }

      function unsqueeze() {
        target.style.removeProperty("right");
        target.style.removeProperty("width");
        target.style.removeProperty("max-width");
        var st = saved.inline;
        if (st) {
          if (st.width) target.style.setProperty("width", st.width);
          if (st.right) target.style.setProperty("right", st.right);
          if (st.maxWidth) target.style.setProperty("max-width", st.maxWidth);
        }
        saved.squeezed = false;
      }

      var style = byId(STYLE);
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE;
        document.head.appendChild(style);
      }
      style.textContent = cfg.css;

      var shell = byId(SHELL);
      var created = false;

      if (!shell) {
        created = true;
        document.documentElement.classList.add("cyrene-wb-on");
        shell = document.createElement("div");
        shell.id = SHELL;
        shell.className = "cyrene-wb-shell";

        var drag = document.createElement("div");
        drag.className = "cyrene-wb-drag";
        drag.title = "按住这里可以拖动窗口";

        var bar = document.createElement("div");
        bar.className = "cyrene-wb-bar";
        var title = document.createElement("span");
        title.className = "cyrene-wb-title";
        title.textContent = "侧栏工作台";
        var spacer = document.createElement("span");
        spacer.className = "cyrene-wb-spacer";
        bar.appendChild(title);
        bar.appendChild(spacer);

        function mkBtn(label, tip, kind) {
          var b = document.createElement("button");
          b.className = "cyrene-wb-btn";
          b.textContent = label;
          b.title = tip;
          b.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            post(kind);
          });
          return b;
        }
        bar.appendChild(mkBtn("\u21d4", "切换侧栏宽度", "width"));
        bar.appendChild(mkBtn("\u27f3", "重载工作台", "reload"));
        bar.appendChild(mkBtn("\u00bb", "收起侧栏", "hide"));

        var frame = document.createElement("iframe");
        frame.className = "cyrene-wb-frame";
        frame.setAttribute("allow", "clipboard-read; clipboard-write");
        frame.setAttribute("src", "http://127.0.0.1:" + PORT + "/");

        shell.appendChild(drag);
        shell.appendChild(bar);
        shell.appendChild(frame);

        var launcher = document.createElement("div");
        launcher.id = LAUNCH;
        launcher.className = "cyrene-wb-launcher";
        launcher.textContent = "工作台";
        launcher.addEventListener("click", function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          post("toggle");
        });
        launcher.addEventListener("contextmenu", function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          post("width");
        });

        document.body.appendChild(shell);
        document.body.appendChild(launcher);
        diag.steps.push("created");
      } else {
        diag.steps.push("reused");
        var f2 = shell.querySelector("iframe");
        if (f2) {
          var want = "http://127.0.0.1:" + PORT + "/";
          if (f2.getAttribute("src") !== want) f2.setAttribute("src", want);
        }
      }

      if (COLLAPSED) {
        shell.classList.add("collapsed");
        unsqueeze();
        diag.visible = false;
      } else {
        shell.classList.remove("collapsed");
        squeeze();
        diag.visible = true;
      }

      /* 常驻入口：不用去侧栏边缘找小把手，按钮一直在 */
      var launcherEl = byId(LAUNCH);
      if (launcherEl) {
        launcherEl.title =
          (COLLAPSED ? "展开" : "收起") +
          "侧栏工作台（单击切换 · 右键切宽度 · " + HOTKEY + "）";
        launcherEl.setAttribute("data-cyrene-wb-state", COLLAPSED ? "collapsed" : "open");
      }

      /* 键盘入口：Ctrl+Shift+B 切换显示（仅在聊天窗聚焦时生效，不抢全局快捷键） */
      if (!window.__cyreneWbOnKey && typeof document.addEventListener === "function") {
        window.__cyreneWbOnKey = function (ev) {
          if (!ev || !ev.ctrlKey || !ev.shiftKey || ev.altKey || ev.metaKey) return;
          var key = String(ev.key || "").toLowerCase();
          if (key !== "b" && String(ev.code || "") !== "KeyB") return;
          if (ev.preventDefault) ev.preventDefault();
          if (ev.stopPropagation) ev.stopPropagation();
          post("toggle");
        };
        document.addEventListener("keydown", window.__cyreneWbOnKey, true);
        diag.steps.push("hotkey-bound");
      }

      await new Promise(function (r) {
        setTimeout(r, 140);
      });

      var rect = target.getBoundingClientRect();
      diag.rect = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
      diag.viewport = { w: window.innerWidth, h: window.innerHeight };
      diag.url = String(location.href);
      diag.title = String(document.title);
      diag.created = created;
      diag.widths = cfg.widths || [W];
      diag.tier = cfg.tier;
      diag.winWidth = cfg.winWidth;
      diag.hotkey = HOTKEY;
      diag.launcher = !!byId(LAUNCH);

      window.__cyreneWorkbench = {
        at: Date.now(),
        read: function () {
          return diag;
        },
        post: post,
      };
      return diag;
    } catch (e) {
      return { ok: false, error: String((e && e.stack) || e) };
    }
  })();
}

function uninjectFn() {
  return (function () {
    var diag = { ok: true };
    function drop(id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    try {
      drop("cyrene-workbench-shell");
      drop("cyrene-workbench-style");
      drop("cyrene-workbench-launcher");
      document.documentElement.classList.remove("cyrene-wb-on");
      document.documentElement.style.removeProperty("--cyrene-wb-w");
      var target = document.getElementById("cyrene-react-root") || document.body;
      target.style.removeProperty("right");
      target.style.removeProperty("width");
      target.style.removeProperty("max-width");
      var saved = window.__cyreneWbSaved;
      if (saved && saved.inline) {
        var st = saved.inline;
        if (st.width) target.style.setProperty("width", st.width);
        if (st.right) target.style.setProperty("right", st.right);
        if (st.maxWidth) target.style.setProperty("max-width", st.maxWidth);
      }
      try {
        if (window.__cyreneWbOnKey) document.removeEventListener("keydown", window.__cyreneWbOnKey, true);
      } catch (_) {
        /* ignore */
      }
      window.__cyreneWbOnKey = null;
      window.__cyreneWbSaved = null;
      delete window.__cyreneWorkbench;
      return diag;
    } catch (e) {
      return { ok: false, error: String((e && e.stack) || e) };
    }
  })();
}

/* ------------------------------------------------------------------ *
 * 宿主
 * ------------------------------------------------------------------ */

/** executeJavaScript 的等待上限：空壳窗口（页面尚未 load）上调它会永久挂起。 */
const EXEC_TIMEOUT_MS = 5000;

/**
 * 给可能永不 resolve 的 promise 加一道上限，避免宿主启动被单次注入拖死。
 * 竞速中落败的一侧挂上空 catch，防止「未处理的拒绝」。
 */
function withTimeout(promise, ms, label) {
  const p = Promise.resolve(promise);
  p.catch(function () {
    /* ignore */
  });
  let timer = null;
  return Promise.race([
    p,
    new Promise(function (_, reject) {
      timer = setTimeout(function () {
        reject(new Error(label || "timeout"));
      }, ms);
    }),
  ]).finally(function () {
    if (timer) clearTimeout(timer);
  });
}

function createPanelHost(options) {
  const deps = options || {};
  const log = deps.log || function () {};
  const uiFile = deps.uiFile;

  let server = null;
  let port = 0;
  let token = "";
  let starting = null;
  let injectSeq = 0;
  const injected = new Map(); // webContentsId -> { url, at }
  let hooksInstalled = false;

  function getElectron() {
    if (deps.electron) return deps.electron;
    return require("electron");
  }

  function logSafe(level, ...args) {
    try {
      log("[" + level + "]", ...args);
    } catch (_) {
      /* ignore */
    }
  }

  /* ---------------- HTTP 桥 ---------------- */

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error("请求体过大"));
          try {
            req.destroy();
          } catch (_) {
            /* ignore */
          }
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  function sendJson(res, code, obj) {
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    res.writeHead(code, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": body.length,
    });
    res.end(body);
  }

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url || "/", "http://127.0.0.1");
    } catch (_) {
      return sendJson(res, 400, { ok: false, error: "BAD_URL" });
    }
    const pathname = url.pathname;

    if (req.method === "GET" && (pathname === "/" || pathname === "/ui.html" || pathname === "/index.html")) {
      try {
        let html = await fsp.readFile(uiFile, "utf8");
        const boot =
          "<script>window.__BS_BRIDGE__=" +
          JSON.stringify({ port: port, token: token, embedded: true }) +
          ";</script>";
        if (html.indexOf("</head>") >= 0) html = html.replace("</head>", boot + "\n</head>");
        else html = boot + html;
        const buf = Buffer.from(html, "utf8");
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-length": buf.length,
        });
        res.end(buf);
      } catch (error) {
        sendJson(res, 500, { ok: false, error: "UI_READ_FAILED: " + String(error && error.message) });
      }
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, { ok: true, port: port, clients: injected.size });
    }

    if (pathname.indexOf("/api/") === 0) {
      const channel = decodeURIComponent(pathname.slice(5));
      if (!token || req.headers["x-bs-token"] !== token) {
        return sendJson(res, 401, { ok: false, error: "E_BAD_TOKEN" });
      }
      let payload = null;
      try {
        const raw = await readBody(req);
        payload = raw ? JSON.parse(raw) : null;
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: "BAD_BODY: " + String(error && error.message) });
      }
      let result;
      try {
        result = await deps.dispatch(channel, { sender: null, bridge: true }, payload);
      } catch (error) {
        result = { ok: false, error: String((error && error.message) || error) };
      }
      injectSeq += 1;
      return sendJson(res, 200, result === undefined ? { ok: true } : result);
    }

    sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
  }

  async function ensureServer() {
    if (server && server.listening) return { port: port, token: token };
    if (starting) return starting;
    starting = (async () => {
      const cfg = (deps.getConfig && deps.getConfig()) || {};
      const want = Number(cfg.panelPort) > 0 ? Number(cfg.panelPort) : 0;
      token = crypto.randomBytes(18).toString("hex");
      const srv = http.createServer((req, res) => {
        handle(req, res).catch((error) => {
          try {
            sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
          } catch (_) {
            /* ignore */
          }
        });
      });
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          srv.removeListener("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          srv.removeListener("error", onError);
          resolve();
        };
        srv.once("error", onError);
        srv.once("listening", onListening);
        srv.listen(want, "127.0.0.1");
      });
      server = srv;
      port = srv.address().port;
      logSafe("panel", "HTTP 桥已启动：http://127.0.0.1:" + port);
      return { port: port, token: token };
    })().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function stopServer() {
    if (!server) return;
    const srv = server;
    server = null;
    port = 0;
    await new Promise((resolve) => {
      try {
        srv.close(() => resolve());
      } catch (_) {
        resolve();
      }
      setTimeout(resolve, 1200);
    });
  }

  /* ---------------- 目标窗口 ---------------- */

  function allWindows() {
    const electron = getElectron();
    return (electron.BrowserWindow.getAllWindows() || []).filter((w) => {
      try {
        return w && !w.isDestroyed();
      } catch (_) {
        return false;
      }
    });
  }

  function isChatWindow(w) {
    try {
      const url = (w.webContents && w.webContents.getURL && w.webContents.getURL()) || "";
      if (/[\\/]react[\\/]/i.test(url) || /[\\/]react[\\/]index\.html/i.test(url)) return true;
      if (/localhost:\d+\/react/i.test(url)) return true;
      const title = (w.getTitle && w.getTitle()) || "";
      if (title.indexOf("聊天") >= 0) return true;
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function chatWindows() {
    return allWindows().filter(isChatWindow);
  }

  /** 主聊天窗（拿窗口宽度用第一个） */
  function primaryWin() {
    const wins = chatWindows();
    return wins.length ? wins[0] : null;
  }

  /* ---------------- 注入 / 收回 ---------------- */

  function cfgNow() {
    return (deps.getConfig && deps.getConfig()) || {};
  }

  /** 聊天窗的实际内容宽度（拿不到就回落参考宽度） */
  function windowWidth(w) {
    try {
      const win = w || primaryWin();
      if (win && typeof win.getContentBounds === "function") {
        const b = win.getContentBounds();
        if (b && b.width > 0) return b.width;
      }
      if (win && typeof win.getBounds === "function") {
        const b = win.getBounds();
        if (b && b.width > 0) return b.width;
      }
    } catch (_) {
      /* 没有 Electron / 没有窗口时回落参考宽度 */
    }
    return REF_WIDTH;
  }

  function width() {
    return normalizePanelWidth(cfgNow().panelWidth, windowWidth(null));
  }

  function collapsed() {
    const cfg = (deps.getConfig && deps.getConfig()) || {};
    return cfg.panelCollapsed === true;
  }

  async function report(extra) {
    const winW = windowWidth(null);
    const tiers = widthsFor(winW);
    const tier = panelTier(cfgNow().panelWidth, winW);
    const status = Object.assign(
      {
        at: new Date().toISOString(),
        port: port,
        token: token ? token.slice(0, 6) + "…" : "",
        winWidth: winW,
        width: tiers[tier],
        widths: tiers,
        tier: tier,
        tierNames: ["窄", "宽"],
        ratios: WIDTH_RATIOS.slice(),
        hotkey: HOTKEY,
        collapsed: collapsed(),
        windows: [],
      },
      extra || {}
    );
    if (deps.onStatus) {
      try {
        await deps.onStatus(status);
      } catch (_) {
        /* ignore */
      }
    }
    return status;
  }

  async function applyTo(w, mode) {
    const electron = getElectron();
    const winW = windowWidth(w);
    const tiers = widthsFor(winW);
    const tier = panelTier(cfgNow().panelWidth, winW);
    const payload = {
      width: tiers[tier],
      widths: tiers,
      tier: tier,
      winWidth: winW,
      hotkey: HOTKEY,
      port: port,
      collapsed: collapsed(),
      css: PANEL_CSS,
    };
    const source = "(" + injectFn.toString() + ")(" + JSON.stringify(payload) + ")";
    const script = mode === "off" ? "(" + uninjectFn.toString() + ")()" : source;
    const info = {
      id: (w.webContents && w.webContents.id) || -1,
      title: (w.getTitle && w.getTitle()) || "",
      ok: false,
    };
    try {
      info.result = await withTimeout(
        w.webContents.executeJavaScript(script, true),
        EXEC_TIMEOUT_MS,
        "executeJavaScript timeout"
      );
      info.ok = !!(info.result && info.result.ok);
    } catch (error) {
      info.error = String((error && error.message) || error);
    }
    if (info.ok && mode !== "off") {
      injected.set(info.id, { at: Date.now(), url: info.title });
      ensureResizeHook(w);
    }
    if (mode === "off") injected.delete(info.id);
    return info;
  }

  /* 聊天窗被拉伸 / 缩小 → 两档按新宽度重算，并重新注入（去抖 200ms） */
  const resizeHooked = new Set();
  const resizeTimers = new Map();

  function ensureResizeHook(w) {
    if (typeof w.on !== "function") return;
    const id = (w.webContents && w.webContents.id) || -1;
    if (resizeHooked.has(id)) return;
    resizeHooked.add(id);
    w.on("resize", () => {
      if (cfgNow().panelVisible === false) return;
      if (!injected.has(id)) return;
      const old = resizeTimers.get(id);
      if (old) clearTimeout(old);
      resizeTimers.set(
        id,
        setTimeout(() => {
          resizeTimers.delete(id);
          applyTo(w, "on").catch(() => {});
        }, 200)
      );
    });
    w.on("closed", () => {
      resizeHooked.delete(id);
      injected.delete(id);
      const t = resizeTimers.get(id);
      if (t) clearTimeout(t);
      resizeTimers.delete(id);
    });
  }

  async function injectAll(mode) {
    await ensureServer();
    const wins = chatWindows();
    const details = [];
    for (const w of wins) {
      details.push(await applyTo(w, mode));
    }
    if (!wins.length) logSafe("panel", "当前没有找到聊天窗口（先打开聊天窗口，侧栏会自己贴上去）");
    return report({ mode: mode || "on", windows: details });
  }

  async function show() {
    return injectAll("on");
  }

  /**
   * 收起：不摘掉侧栏，只按 config.panelCollapsed 折叠成右侧小把手——
   * iframe 留在 DOM 里（状态不丢），随时能展开回来。
   */
  async function hide() {
    return injectAll("on");
  }

  async function refresh() {
    return injectAll("on");
  }

  async function status() {
    const details = [];
    for (const w of chatWindows()) {
      const info = { id: (w.webContents && w.webContents.id) || -1, title: (w.getTitle && w.getTitle()) || "" };
      try {
        info.result = await w.webContents.executeJavaScript(
          "(window.__cyreneWorkbench && window.__cyreneWorkbench.read && window.__cyreneWorkbench.read()) || null",
          true
        );
        info.ok = !!(info.result && info.result.ok);
      } catch (error) {
        info.error = String((error && error.message) || error);
      }
      details.push(info);
    }
    return report({ mode: "status", windows: details });
  }

  /** 监听新窗口 / 页面重载，让侧栏在聊天窗重建后自动回来 */
  function installWindowHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;
    const electron = getElectron();
    if (!electron.app || !electron.app.on) return;
    electron.app.on("browser-window-created", (_event, win) => {
      try {
        win.webContents.on("did-finish-load", () => {
          const cfg = (deps.getConfig && deps.getConfig()) || {};
          if (cfg.panelVisible === false) return;
          if (!isChatWindow(win)) return;
          setTimeout(() => {
            applyTo(win, "on")
              .then((info) => report({ mode: "auto-reinject", windows: [info] }))
              .catch(() => {});
          }, 600);
        });
      } catch (_) {
        /* ignore */
      }
    });
  }

  /** 页面是否真的加载了：空壳聊天窗（插件启动时页面还没 load）没有文档。 */
  function isPageLoaded(w) {
    try {
      const url = (w.webContents && w.webContents.getURL && w.webContents.getURL()) || "";
      return !!url && url !== "about:blank";
    } catch (_) {
      return false;
    }
  }

  /**
   * 插件启动早于聊天页 load（宿主的顺序是 plugins → chat.load）：
   * 对「已经存在但页面还没加载」的聊天窗补挂 did-finish-load，
   * 页面就绪后再注入。否则 start() 会卡在不返回的 executeJavaScript 上。
   */
  function armExistingWindows() {
    for (const w of allWindows()) {
      if (!isChatWindow(w) || isPageLoaded(w)) continue;
      try {
        w.webContents.once("did-finish-load", () => {
          if (cfgNow().panelVisible === false) return;
          setTimeout(() => {
            applyTo(w, "on")
              .then((info) => report({ mode: "auto-reinject", windows: [info] }))
              .catch(() => {});
          }, 600);
        });
      } catch (_) {
        /* ignore */
      }
    }
  }

  async function start() {
    installWindowHooks();
    armExistingWindows();
    await ensureServer();
    const cfg = (deps.getConfig && deps.getConfig()) || {};
    if (cfg.panelVisible !== false) {
      // 只注入页面已经加载完的聊天窗；空壳窗口交给 did-finish-load，
      // 绝不能在启动期 await 一个页面还没 load 的 webContents。
      const wins = chatWindows().filter(isPageLoaded);
      const details = [];
      for (const w of wins) details.push(await applyTo(w, "on"));
      return report({ mode: "on", windows: details });
    }
    return report({ mode: "idle" });
  }

  async function shutdown() {
    try {
      // 只在桥真的起过时才去收回，避免关停阶段反而把服务拉起来
      if (server) {
        for (const w of chatWindows()) await applyTo(w, "off");
      }
    } catch (_) {
      /* ignore */
    }
    injected.clear();
    await stopServer();
  }

  return {
    start: start,
    show: show,
    hide: hide,
    toggle: async () => ((deps.getConfig && deps.getConfig()) || {}).panelCollapsed
      ? show()
      : hide(),
    refresh: refresh,
    status: status,
    shutdown: shutdown,
    winWidth: () => windowWidth(null),
    widths: () => widthsFor(windowWidth(null)),
    port: () => port,
    token: () => token,
    uiUrl: () => (port ? "http://127.0.0.1:" + port + "/" : null),
  };
}

module.exports = {
  createPanelHost,
  PANEL_CSS,
  PANEL_WIDTHS,
  WIDTH_RATIOS,
  REF_WIDTH,
  widthsFor,
  panelTier,
  HOTKEY,
  normalizePanelWidth,
  nextPanelWidth,
  SHELL_ID,
  STYLE_ID,
  LAUNCHER_ID,
  HTML_CLASS,
  ROOT_ID,
  injectFn,
  uninjectFn,
};
