"use strict";

/**
 * better-sidebar —— Cyrene「侧栏工作台」插件
 *
 * 复刻对象：DSH-better-sidebar（https://github.com/omdsh-dev/DSH-better-sidebar）
 * 落地形态（v2）：**内嵌右侧栏**——把工作台注入到 Cyrene 的聊天窗口里。
 *   - 聊天窗右侧的固定侧栏；右侧常驻「工作台」按钮（展开/收起都在），快捷键 Ctrl+Shift+B
 *   - 文件树 / 编辑器 / Markdown 预览 / 管道终端 / Git 面板
 *   - 昔涟可调用的工具：开侧栏、把文件推到用户眼前、查 Git 状态、改配置
 *
 * 通道（两条路，同一套 handler）：
 *   - 内嵌侧栏：iframe → 本机 HTTP 桥（127.0.0.1 + session token）→ dispatchChannel
 *   - 宿主 IPC：plugin:better-sidebar:<channel>（保留）
 *
 * 诚实说明（不撒谎）：注入点依赖聊天窗**未公开**的 DOM（#cyrene-react-root）。
 * 客户端大版本升级后可能失效；失败会写进 panelStatus，不静默吞掉。
 * 宿主侧负责：文件系统读写、Git CLI、终端进程、注入与 HTTP 桥。
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const panel = require("./panel.cjs");

const PLUGIN_ID = "better-sidebar";
const VERSION = "2.2.0";

const MAX_TEXT_BYTES = 4 * 1024 * 1024; // 文本编辑上限
const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // 图片 / PDF 预览上限
const MAX_TERM_BUFFER = 512 * 1024; // 终端滚动缓冲上限
const SEARCH_LIMIT = 200;
const SEARCH_MAX_DEPTH = 8;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "dist",
  "build",
  ".next",
  ".cache",
  "$RECYCLE.BIN",
  "System Volume Information",
]);

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif", ".ico"]);

const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonc", ".json5", ".js", ".cjs", ".mjs", ".jsx",
  ".ts", ".tsx", ".css", ".scss", ".less", ".html", ".htm", ".xml", ".svg", ".vue", ".svelte",
  ".py", ".pyi", ".rb", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".php", ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1", ".psm1", ".sql", ".yml", ".yaml",
  ".toml", ".ini", ".cfg", ".conf", ".env", ".properties", ".gradle", ".rpy", ".lua", ".r",
  ".csv", ".tsv", ".log", ".gitignore", ".editorconfig", ".dockerignore", ".r", ".pl", ".dart", ".swift",
]);

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

/* ------------------------------------------------------------------ *
 * 全局状态
 * ------------------------------------------------------------------ */

let panelHost = null;
let pluginCtx = null;
let pendingOpen = null;

const DEFAULT_CONFIG = {
  root: "",
  recentRoots: [],
  wrap: true,
  fontSize: 13,
  tabSize: 2,
  panelWidth: 420,
  panelPort: 0,
  panelVisible: true,
  panelCollapsed: false,
  changeReport: true,
};
let memoryConfig = Object.assign({}, DEFAULT_CONFIG);
let configLoaded = false;

const terms = new Map(); // id -> term 记录
let termSeq = 0;

/* ------------------------------------------------------------------ *
 * 通用小工具
 * ------------------------------------------------------------------ */

function ok(obj) {
  return Object.assign({ ok: true }, obj || {});
}

function fail(error) {
  const msg = error && error.message ? error.message : String(error);
  return { ok: false, error: msg };
}

/** 包一层：把异常转成 {ok:false}，绝不让 IPC 抛出去 */
function guarded(fn) {
  return async function (...args) {
    try {
      const res = await fn.apply(null, args);
      if (res && typeof res === "object" && "ok" in res) return res;
      return ok(res && typeof res === "object" ? res : { value: res });
    } catch (error) {
      return fail(error);
    }
  };
}

function isDirectorySync(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

function listDrives() {
  const out = [];
  for (let i = 65; i <= 90; i += 1) {
    const letter = String.fromCharCode(i) + ":";
    try {
      if (fs.existsSync(letter + "\\")) out.push(letter);
    } catch (_) {
      /* 忽略不可访问的盘符 */
    }
  }
  return out;
}

/** 判断一段 buffer 是否像二进制（含 NUL 字节即判非文本） */
function looksBinary(buf) {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 配置（优先用宿主 storage，拿不到就退化成内存态）
 * ------------------------------------------------------------------ */

async function ensureConfig(ctx) {
  if (configLoaded) return memoryConfig;
  const store = (ctx || pluginCtx || {}).storage;
  if (store && typeof store.get === "function") {
    try {
      const saved = await Promise.resolve(store.get("config"));
      if (saved && typeof saved === "object") {
        memoryConfig = Object.assign({}, DEFAULT_CONFIG, saved);
        if (!Array.isArray(memoryConfig.recentRoots)) memoryConfig.recentRoots = [];
      }
    } catch (_) {
      /* 读不到就用默认值 */
    }
  }
  configLoaded = true;
  return memoryConfig;
}

async function saveConfig(patch) {
  memoryConfig = Object.assign({}, memoryConfig, patch || {});
  const store = (pluginCtx || {}).storage;
  if (store && typeof store.set === "function") {
    try {
      await Promise.resolve(store.set("config", memoryConfig));
    } catch (_) {
      /* 存不进去不影响当前会话 */
    }
  }
  return memoryConfig;
}

/** 解析出可用的根目录：配置里的 → 最近的 → 用户主目录 */
function resolveRoot(cfg) {
  const candidates = [cfg.root].concat(Array.isArray(cfg.recentRoots) ? cfg.recentRoots : []).concat([os.homedir()]);
  for (const c of candidates) {
    if (c && typeof c === "string" && isDirectorySync(c)) return path.resolve(c);
  }
  return os.homedir();
}

async function rememberRoot(dir) {
  const cfg = await ensureConfig(null);
  const abs = path.resolve(dir);
  const recent = [abs].concat((cfg.recentRoots || []).filter((r) => r !== abs)).slice(0, 10);
  await saveConfig({ root: abs, recentRoots: recent });
  return abs;
}

/* ------------------------------------------------------------------ *
 * 文件系统
 * ------------------------------------------------------------------ */

async function listDir(dir) {
  const abs = path.resolve(String(dir || "").trim() || os.homedir());
  const st = await fsp.stat(abs);
  if (!st.isDirectory()) throw new Error("不是目录：" + abs);

  const dirents = await fsp.readdir(abs, { withFileTypes: true });
  const detailed = dirents.length <= 2000;
  const entries = [];

  for (const d of dirents) {
    const full = path.join(abs, d.name);
    const isSymlink = d.isSymbolicLink();
    let isDir = d.isDirectory();
    let broken = false;
    let size = 0;
    let mtime = 0;

    if (isSymlink) {
      try {
        const target = await fsp.stat(full);
        isDir = target.isDirectory();
        size = target.size;
        mtime = target.mtimeMs;
      } catch (_) {
        broken = true; // 失效软链接
      }
    } else if (detailed && !isDir) {
      try {
        const st2 = await fsp.stat(full);
        size = st2.size;
        mtime = st2.mtimeMs;
      } catch (_) {
        /* 权限等原因拿不到就算了 */
      }
    }

    entries.push({
      name: d.name,
      path: full,
      isDir,
      isSymlink,
      broken,
      size,
      mtime,
      ext: isDir ? "" : path.extname(d.name).toLowerCase(),
    });
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });

  const parent = path.dirname(abs);
  return { path: abs, parent: parent === abs ? null : parent, entries };
}

async function readForView(filePath) {
  const abs = path.resolve(String(filePath || "").trim());
  const st = await fsp.stat(abs);
  if (st.isDirectory()) throw new Error("这是一个目录，不是文件");

  const ext = path.extname(abs).toLowerCase();
  const base = { path: abs, name: path.basename(abs), ext, size: st.size, mtime: st.mtimeMs };

  if (IMAGE_EXT.has(ext) || ext === ".pdf") {
    if (st.size > MAX_MEDIA_BYTES) {
      return Object.assign(base, { kind: "binary", tooLarge: true, limit: MAX_MEDIA_BYTES });
    }
    const buf = await fsp.readFile(abs);
    const mime = MIME_BY_EXT[ext] || "application/octet-stream";
    return Object.assign(base, {
      kind: ext === ".pdf" ? "pdf" : "image",
      dataUrl: "data:" + mime + ";base64," + buf.toString("base64"),
    });
  }

  const isTextExt = TEXT_EXT.has(ext) || ext === "";
  if (!isTextExt && st.size > 1024 * 1024) {
    return Object.assign(base, { kind: "binary", tooLarge: true, limit: MAX_TEXT_BYTES });
  }

  const buf = await fsp.readFile(abs);
  if (!isTextExt && looksBinary(buf)) {
    return Object.assign(base, { kind: "binary" });
  }
  if (buf.length > MAX_TEXT_BYTES) {
    return Object.assign(base, {
      kind: "text",
      content: buf.slice(0, MAX_TEXT_BYTES).toString("utf8"),
      truncated: true,
      limit: MAX_TEXT_BYTES,
    });
  }
  return Object.assign(base, { kind: "text", content: buf.toString("utf8"), truncated: false });
}

async function writeTextFile(filePath, content) {
  const abs = path.resolve(String(filePath || "").trim());
  const dir = path.dirname(abs);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, "." + path.basename(abs) + "." + Date.now() + ".bs-tmp");
  try {
    await fsp.writeFile(tmp, String(content == null ? "" : content), "utf8");
    await fsp.rename(tmp, abs); // 原子替换
  } catch (error) {
    try {
      await fsp.rm(tmp, { force: true });
    } catch (_) {
      /* 清理失败无所谓 */
    }
    throw error;
  }
  const st = await fsp.stat(abs);
  return { path: abs, size: st.size, mtime: st.mtimeMs };
}

function assertSafeName(name, label) {
  const s = String(name || "").trim();
  if (!s) throw new Error(label + "不能为空");
  if (s.includes("/") || s.includes("\\") || s.includes("..")) {
    throw new Error(label + "不能包含路径分隔符或 ..");
  }
  return s;
}

async function createEntry(targetPath, kind) {
  const abs = path.resolve(String(targetPath || "").trim());
  if (fs.existsSync(abs)) throw new Error("已经存在：" + abs);
  if (kind === "dir") {
    await fsp.mkdir(abs, { recursive: false });
  } else {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, "", { encoding: "utf8", flag: "wx" });
  }
  return { path: abs };
}

async function renameEntry(targetPath, newName) {
  const abs = path.resolve(String(targetPath || "").trim());
  const name = assertSafeName(newName, "新名字");
  const dest = path.join(path.dirname(abs), name);
  if (dest === abs) return { path: abs };
  if (fs.existsSync(dest)) throw new Error("目标已存在：" + dest);
  await fsp.rename(abs, dest);
  return { path: dest, from: abs };
}

async function deleteEntry(targetPath) {
  const abs = path.resolve(String(targetPath || "").trim());
  if (path.dirname(abs) === abs) throw new Error("不允许删除盘符根目录");
  const st = await fsp.lstat(abs);

  let shell = null;
  try {
    shell = require("electron").shell;
  } catch (_) {
    shell = null;
  }

  if (shell && typeof shell.trashItem === "function") {
    try {
      await shell.trashItem(abs);
      return { path: abs, mode: "trash" };
    } catch (_) {
      /* 回收站不可用就退回彻底删除 */
    }
  }
  await fsp.rm(abs, { recursive: st.isDirectory(), force: true });
  return { path: abs, mode: "unlink" };
}

async function searchFiles(root, query) {
  const absRoot = path.resolve(String(root || "").trim() || os.homedir());
  const q = String(query || "").trim().toLowerCase();
  if (!q) return { matches: [], truncated: false };

  const matches = [];
  let truncated = false;
  const queue = [{ dir: absRoot, depth: 0 }];

  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > SEARCH_MAX_DEPTH) continue;
    let dirents;
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const d of dirents) {
      if (matches.length >= SEARCH_LIMIT) {
        truncated = true;
        break;
      }
      const full = path.join(dir, d.name);
      const isDir = d.isDirectory();
      if (d.name.toLowerCase().includes(q)) {
        let size = 0;
        if (!isDir) {
          try {
            size = (await fsp.stat(full)).size;
          } catch (_) {
            /* ignore */
          }
        }
        matches.push({ name: d.name, path: full, isDir, size });
      }
      if (isDir && !IGNORED_DIRS.has(d.name) && !d.name.startsWith(".")) {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
    if (matches.length >= SEARCH_LIMIT) break;
  }

  return { matches, truncated };
}

/* ------------------------------------------------------------------ *
 * 子进程 / Git
 * ------------------------------------------------------------------ */

function runCmd(cmd, args, options) {
  const opts = options || {};
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd || undefined,
        windowsHide: true,
        env: Object.assign({}, process.env, { GIT_PAGER: "cat", PYTHONIOENCODING: "utf-8" }),
      });
    } catch (error) {
      resolve({ code: -1, out: "", err: error.message });
      return;
    }

    let out = "";
    let err = "";
    let settled = false;
    const timeoutMs = opts.timeoutMs || 15000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch (_) {
        /* ignore */
      }
      resolve({ code: null, out: out, err: err + "\n[执行超时 " + timeoutMs + "ms]" });
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      out += d.toString("utf8");
      if (out.length > 4 * 1024 * 1024) out = out.slice(-2 * 1024 * 1024);
    });
    child.stderr.on("data", (d) => {
      err += d.toString("utf8");
      if (err.length > 1024 * 1024) err = err.slice(-512 * 1024);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, out: out, err: String(error.message || error) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code, out: out, err: err });
    });
  });
}

function describeGitStatus(x, y) {
  if (x === "?" && y === "?") return "未跟踪";
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "冲突";
  if (x === "R") return "重命名";
  if (x === "C") return "复制";
  if (x === "A") return "新增";
  if (x === "D" || y === "D") return "删除";
  if (x === "M" || y === "M") return "修改";
  if (x === "T") return "类型变更";
  return "变更";
}

async function gitStatus(dir) {
  const cwd = path.resolve(String(dir || "").trim() || os.homedir());
  const res = await runCmd("git", ["-C", cwd, "status", "--porcelain=v1", "--branch", "--untracked-files=all"], {
    timeoutMs: 20000,
  });

  if (res.code === -1) {
    return { isRepo: false, reason: "git-unavailable", detail: res.err.trim().slice(0, 300) };
  }
  if (res.code !== 0) {
    const notRepo = /not a git repository/i.test(res.err);
    return {
      isRepo: false,
      reason: notRepo ? "not-a-repo" : "git-error",
      detail: (res.err || res.out).trim().slice(0, 300),
    };
  }

  let branch = null;
  let upstream = null;
  let ahead = 0;
  let behind = 0;
  const files = [];

  for (const line of res.out.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("## ")) {
      const head = line.slice(3).trim();
      const m = head.match(/^([^\s.]+)(?:\.\.\.(\S+))?(?:\s*\[(.+)\])?$/);
      if (m) {
        branch = m[1];
        upstream = m[2] || null;
        if (m[3]) {
          const a = m[3].match(/ahead (\d+)/);
          const b = m[3].match(/behind (\d+)/);
          ahead = a ? Number(a[1]) : 0;
          behind = b ? Number(b[1]) : 0;
        }
      } else {
        branch = head;
      }
      continue;
    }
    const x = line[0];
    const y = line[1];
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    files.push({
      x: x,
      y: y,
      path: arrow >= 0 ? rest.slice(arrow + 4) : rest,
      origPath: arrow >= 0 ? rest.slice(0, arrow) : null,
      status: describeGitStatus(x, y),
    });
  }

  return { isRepo: true, branch: branch, upstream: upstream, ahead: ahead, behind: behind, files: files, cwd: cwd };
}

async function gitDiff(dir, relPath) {
  const cwd = path.resolve(String(dir || "").trim() || os.homedir());
  const target = String(relPath || "").trim();
  const args = ["-C", cwd, "diff", "--no-color", "--unified=3"];
  if (target) args.push("--", target);

  let res = await runCmd("git", args, { timeoutMs: 20000 });
  if (res.code === 0 && !res.out.trim()) {
    const cached = await runCmd("git", args.concat(["--cached"]), { timeoutMs: 20000 });
    if (cached.code === 0 && cached.out.trim()) res = cached;
  }

  if (res.code !== 0) {
    return { diff: "", truncated: false, note: (res.err || "").trim().slice(0, 300) || "git diff 执行失败" };
  }
  if (!res.out.trim()) {
    return {
      diff: "",
      truncated: false,
      note: target
        ? "这个文件当前没有差异（可能是未跟踪的新文件，或已全部暂存/已提交）"
        : "工作区干净，没有未提交的差异",
    };
  }

  const max = 400 * 1024;
  if (res.out.length > max) {
    return { diff: res.out.slice(0, max), truncated: true };
  }
  return { diff: res.out, truncated: false };
}

/* ------------------------------------------------------------------ *
 * 终端（child_process + 轮询；不是真 PTY，交互式全屏程序不可用）
 * ------------------------------------------------------------------ */

function startTerm(cwd) {
  const shellPath = process.env.ComSpec || "cmd.exe";
  const dir = path.resolve(String(cwd || "").trim() || os.homedir());

  const child = spawn(shellPath, ["/Q", "/K", "chcp 65001>nul"], {
    cwd: dir,
    windowsHide: true,
    env: Object.assign({}, process.env, { PYTHONIOENCODING: "utf-8" }),
  });

  const id = "t" + (++termSeq);
  const term = { id: id, cwd: dir, child: child, buf: "", cursor: 0, running: true, exitCode: null };

  const push = (text) => {
    term.buf += text;
    if (term.buf.length > MAX_TERM_BUFFER) {
      const cut = term.buf.length - Math.floor(MAX_TERM_BUFFER / 2);
      term.buf = term.buf.slice(cut);
      term.cursor = Math.max(0, term.cursor - cut);
    }
  };

  child.stdout.on("data", (d) => push(d.toString("utf8")));
  child.stderr.on("data", (d) => push(d.toString("utf8")));
  child.on("error", (error) => {
    push("\r\n[终端启动失败：" + error.message + "]\r\n");
    term.running = false;
  });
  child.on("exit", (code) => {
    term.running = false;
    term.exitCode = code;
    push("\r\n[进程已退出，代码 " + code + "]\r\n");
  });

  terms.set(id, term);
  return term;
}

function writeTerm(id, data) {
  const term = terms.get(id);
  if (!term) throw new Error("终端不存在或已结束：" + id);
  if (!term.running) throw new Error("终端已经退出了，请点「重启终端」");
  const text = String(data == null ? "" : data);
  term.child.stdin.write(text.replace(/\r?\n$/, "") + "\r\n");
  return { id: id };
}

function pollTerm(id, cursor) {
  const term = terms.get(id);
  if (!term) return { gone: true, id: id };
  const from = Math.max(0, Math.min(Number(cursor) || 0, term.buf.length));
  const chunk = term.buf.slice(from);
  term.cursor = term.buf.length;
  return { id: id, chunk: chunk, cursor: term.buf.length, running: term.running, exitCode: term.exitCode };
}

function killTerm(id) {
  const term = terms.get(id);
  if (!term) return { killed: false };
  try {
    term.child.kill();
  } catch (_) {
    /* ignore */
  }
  terms.delete(id);
  return { killed: true };
}

function killAllTerms() {
  for (const id of Array.from(terms.keys())) killTerm(id);
}

/* ------------------------------------------------------------------ *
 * 内嵌侧栏（注入进 Cyrene 聊天窗）
 * ------------------------------------------------------------------ */

function ensurePanelHost() {
  if (panelHost) return panelHost;
  panelHost = panel.createPanelHost({
    log: (...args) => {
      if (pluginCtx && typeof pluginCtx.log === "function") pluginCtx.log(...args);
      else console.log(...args);
    },
    uiFile: path.join(__dirname, "ui.html"),
    // 单测注入点：允许用假 electron 跑通注入流程（生产环境恒为 undefined）
    electron: global.__BS_TEST_ELECTRON || undefined,
    getConfig: () => memoryConfig,
    dispatch: (channel, event, payload) => dispatchChannel(channel, event, payload),
    onStatus: async (status) => {
      try {
        const store = (pluginCtx || {}).storage;
        if (store && typeof store.set === "function") await Promise.resolve(store.set("panelStatus", status));
      } catch (_) {
        /* ignore */
      }
    },
  });
  return panelHost;
}

async function openPanel() {
  const host = ensurePanelHost();
  const cfg = await ensureConfig(null);
  if (cfg.panelCollapsed || cfg.panelVisible === false) {
    await saveConfig({ panelCollapsed: false, panelVisible: true });
  }
  return host.show();
}

async function shutdownPanel() {
  if (!panelHost) return;
  const host = panelHost;
  panelHost = null;
  try {
    await host.shutdown();
  } catch (_) {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * 插件入口
 * ------------------------------------------------------------------ */

const TOOL_OPEN = PLUGIN_ID + "_open";
const TOOL_REVEAL = PLUGIN_ID + "_reveal";
const TOOL_GIT = PLUGIN_ID + "_git_status";
const TOOL_CONFIG = PLUGIN_ID + "_config";
const TOOL_PANEL = PLUGIN_ID + "_panel";

/* ------------------------------------------------------------------ *
 * 通道层：宿主 IPC 与内嵌侧栏的 HTTP 桥共用同一套 handler
 * ------------------------------------------------------------------ */

const channelHandlers = new Map();

function registerChannel(name, handler) {
  channelHandlers.set(name, handler);
  if (pluginCtx && typeof pluginCtx.registerIpc === "function") {
    pluginCtx.registerIpc(name, handler);
  }
}

async function dispatchChannel(name, event, payload) {
  const handler = channelHandlers.get(name);
  if (!handler) return { ok: false, error: "E_UNKNOWN_CHANNEL: " + name };
  return handler(event, payload);
}

function renderPanelStatus(status) {
  const s = status || {};
  const lines = [];
  const tierW = s.width || panel.PANEL_WIDTHS[0];
  const tierName = s.tierNames && s.tierNames[s.tier] ? s.tierNames[s.tier] : "";
  const ratioText =
    Math.round((panel.WIDTH_RATIOS[0] || 0.3) * 100) +
    "% / " +
    Math.round((panel.WIDTH_RATIOS[1] || 0.45) * 100) +
    "%";
  lines.push(
    "侧栏状态：" +
      (s.collapsed ? "已收起（右侧常驻「工作台」按钮仍在）" : "已展开") +
      " · 宽度 " +
      tierW +
      " px" +
      (tierName ? "（" + tierName + "档）" : "") +
      " · 两档 " +
      (s.widths || panel.PANEL_WIDTHS).join(" / ") +
      " px（按聊天窗宽 " +
      (s.winWidth || "?") +
      " px 的 " +
      ratioText +
      " 算，窗口缩放自动重算）"
  );
  lines.push(
    "打开方式：右侧常驻「工作台」按钮（单击切换 · 右键切宽度）· 快捷键 " +
      panel.HOTKEY +
      " · 或直接跟昔涟说「打开工作台」"
  );
  lines.push("HTTP 桥：" + (s.port ? "http://127.0.0.1:" + s.port + "/" : "未启动"));
  if (s.at) lines.push("最近一次操作：" + s.at);
  const wins = s.windows || [];
  if (!wins.length) {
    lines.push("注入目标：当前没有找到聊天窗口（打开聊天窗后会自动贴上去）");
  }
  for (const w of wins) {
    const r = w.result || {};
    lines.push(
      "注入：" +
        (w.ok ? "成功" : "失败") +
        " · 窗口「" +
        (w.title || r.title || "?") +
        "」" +
        (r.rootFound === false ? " · ⚠ 没找到 #cyrene-react-root" : "") +
        (r.mode ? " · 挤压方式 " + r.mode : "") +
        (r.rect ? " · 聊天区 " + r.rect.w + "×" + r.rect.h : "") +
        (r.viewport ? " · 窗口 " + r.viewport.w + "×" + r.viewport.h : "") +
        (w.error || r.error ? " · 错误：" + String(w.error || r.error).slice(0, 300) : "")
    );
  }
  return lines.join("\n");
}

module.exports = {
  async register(ctx) {
    pluginCtx = ctx;
    await ensureConfig(ctx);

    /* ---------------- 工具 1：打开工作台 ---------------- */

    ctx.registerTool({
      id: TOOL_OPEN,
      name: "打开侧栏工作台",
      description:
        "在 Cyrene 聊天窗右侧展开「侧栏工作台」内嵌侧栏——文件树 + 代码/Markdown 编辑器 + 终端 + Git 面板。" +
        "当用户说「打开工作台」「打开侧栏」「打开 better sidebar」「把侧栏放出来」「我想在客户端里看文件/改文件/跑命令/看 git」时使用。" +
        "可选参数 root：要打开的根目录绝对路径。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "根目录绝对路径，例如 D:\\ai\\program（可选）" },
        },
        required: [],
      },
      async execute(args) {
        const a = args || {};
        let switched = false;
        if (a.root && String(a.root).trim() && isDirectorySync(String(a.root).trim())) {
          await rememberRoot(String(a.root).trim());
          switched = true;
        }
        const status = await openPanel();
        const cfg = await ensureConfig(null);
        const attached = (status.windows || []).filter((w) => w.ok).length;
        return (
          "内嵌侧栏已经在聊天窗右侧展开啦♪\n根目录：" +
          resolveRoot(cfg) +
          (switched ? "（已按你给的位置切过去）" : "（沿用上次的根目录，可在侧栏里改）") +
          (attached
            ? ""
            : "\n（这会儿没找到聊天窗口——人家先把桥架好了，你把聊天窗打开，侧栏会自己贴上去）")
        );
      },
    });

    /* ---------------- 工具 2：把文件推到用户眼前 ---------------- */

    ctx.registerTool({
      id: TOOL_REVEAL,
      name: "在工作台里打开文件",
      description:
        "把某个文件（或目录）送到聊天窗右侧的「侧栏工作台」里打开：文件会新开一个编辑标签，" +
        "目录会被设为工作台根目录。需要让用户亲眼看某个文件、一起改稿、看图片或看日志时使用。" +
        "参数 path 必填（绝对路径）；mode 可选：open=在侧栏里打开（默认）、system=用系统默认程序打开、locate=在文件管理器中定位。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "要打开的文件或目录的绝对路径" },
          mode: {
            type: "string",
            description: "open（默认，在工作台里打开）/ system（系统默认程序）/ locate（在文件管理器中定位）",
          },
        },
        required: ["path"],
      },
      async execute(args) {
        const a = args || {};
        const raw = String(a.path || "").trim();
        if (!raw) return "需要给我一个文件路径哦。";
        const abs = path.resolve(raw);
        const exists = fs.existsSync(abs);
        if (!exists) return "找不到这个路径：" + abs;

        const mode = String(a.mode || "open").toLowerCase();
        const electron = require("electron");

        if (mode === "system") {
          const err = await electron.shell.openPath(abs);
          return err ? "系统打开失败：" + err : "已经用系统默认程序打开：" + abs;
        }
        if (mode === "locate") {
          electron.shell.showItemInFolder(abs);
          return "已经在文件管理器里定位到：" + abs;
        }

        const st = await fsp.stat(abs);
        if (st.isDirectory()) {
          await rememberRoot(abs);
          pendingOpen = null;
          await openPanel();
          return "已经把工作台的根目录切到：" + abs;
        }

        const cfg = await ensureConfig(null);
        const currentRoot = resolveRoot(cfg);
        const inside = abs.toLowerCase().startsWith(currentRoot.toLowerCase() + path.sep.toLowerCase()) ||
          abs.toLowerCase().startsWith(currentRoot.toLowerCase() + "\\");
        if (!inside) await rememberRoot(path.dirname(abs));
        pendingOpen = abs;
        await openPanel();
        return "已经在侧栏工作台里打开：" + abs;
      },
    });

    /* ---------------- 工具 3：Git 状态速览 ---------------- */

    ctx.registerTool({
      id: TOOL_GIT,
      name: "查看 Git 状态",
      description:
        "查某个目录的 Git 状态：当前分支、落后/领先、变更文件清单（中文状态）。" +
        "用户问「这个仓库改了什么」「有什么没提交」「分支是什么」时使用，不需要开工作台窗口。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "仓库目录绝对路径（可选，默认工作台当前根目录）" },
        },
        required: [],
      },
      async execute(args) {
        const a = args || {};
        const cfg = await ensureConfig(null);
        const dir = a.root && String(a.root).trim() ? String(a.root).trim() : resolveRoot(cfg);
        const res = await gitStatus(dir);

        if (!res.isRepo) {
          if (res.reason === "not-a-repo") return dir + " 不是 Git 仓库。";
          if (res.reason === "git-unavailable") return "这台机器上没找到可用的 git 命令：" + (res.detail || "");
          return "读取 Git 状态失败：" + (res.detail || "未知原因");
        }

        const lines = [];
        lines.push("目录：" + res.cwd);
        lines.push(
          "分支：" +
            (res.branch || "（未知）") +
            (res.upstream ? " → " + res.upstream : "") +
            (res.ahead ? " · 领先 " + res.ahead : "") +
            (res.behind ? " · 落后 " + res.behind : "")
        );
        if (!res.files.length) {
          lines.push("工作区干净，没有未提交的变更。");
        } else {
          lines.push("变更 " + res.files.length + " 项：");
          for (const f of res.files.slice(0, 50)) {
            lines.push("  [" + f.status + "] " + f.path);
          }
          if (res.files.length > 50) lines.push("  …（还有 " + (res.files.length - 50) + " 项）");
        }
        return lines.join("\n");
      },
    });

    /* ---------------- 工具 4：配置 ---------------- */

    ctx.registerTool({
      id: TOOL_CONFIG,
      name: "工作台配置",
      description:
        "读/写「侧栏工作台」插件的配置（根目录、最近根目录列表、字号、自动换行、" +
        "内嵌侧栏的宽度 panelWidth、固定端口 panelPort、是否展开 panelVisible/panelCollapsed、" +
        "是否在回复里附改动清单 changeReport）。" +
        "用户想改工作台默认打开的目录、调整侧栏宽度，或问工作台现在配置是什么时使用。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: "get=读取；set=写入" },
          patch: {
            type: "object",
            description: "action=set 时要写入的字段，如 {\"root\":\"D:\\\\ai\\\\program\"}",
          },
        },
        required: ["action"],
      },
      async execute(args) {
        const a = args || {};
        const action = String(a.action || "get").toLowerCase();
        if (action === "set") {
          const next = await saveConfig(a.patch || {});
          return "配置已更新：\n" + renderConfig(next);
        }
        return "当前配置：\n" + renderConfig(await ensureConfig(null));
      },
    });

    /* ---------------- 工具 5：内嵌侧栏控制 ---------------- */

    ctx.registerTool({
      id: TOOL_PANEL,
      name: "内嵌侧栏控制",
      description:
        "控制注入在 Cyrene 聊天窗右侧的「侧栏工作台」：show=展开、hide=收起（右侧留常驻按钮）、" +
        "toggle=翻转、width=在窄 / 宽两档间切换（两档不写死像素，按聊天窗宽度的 30% / 45% 算，窗口缩放自动重算）、" +
        "status=看注入诊断（找到哪几个聊天窗口、注入是否成功、聊天区实际尺寸、失败原因）。" +
        "用户说「侧栏收起来」「把侧栏放出来」「侧栏宽一点」「侧栏怎么没出来」时使用。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: "show / hide / toggle / width / status（默认 status）" },
        },
        required: [],
      },
      async execute(args) {
        const action = String((args && args.action) || "status").toLowerCase();
        const host = ensurePanelHost();
        let status;
        if (action === "show") {
          await saveConfig({ panelVisible: true, panelCollapsed: false });
          status = await host.show();
        } else if (action === "hide") {
          // 收起 ≠ 摘下：panelVisible 保持 true，右侧留个小把手随时能展开
          await saveConfig({ panelVisible: true, panelCollapsed: true });
          status = await host.hide();
        } else if (action === "toggle") {
          const cfg = await ensureConfig(null);
          const wantShow = !!cfg.panelCollapsed || cfg.panelVisible === false;
          status = wantShow ? await host.show() : await host.hide();
          await saveConfig({ panelVisible: true, panelCollapsed: !wantShow });
        } else if (action === "width") {
          const cfg = await ensureConfig(null);
          await saveConfig({ panelWidth: panel.nextPanelWidth(cfg.panelWidth, host.winWidth()) });
          status = await host.show();
        } else {
          status = await host.status();
        }
        return renderPanelStatus(status);
      },
    });

    /* ---------------- 通道：IPC 与内嵌侧栏的 HTTP 桥共用 ---------------- */

    registerChannel(
      "status",
      guarded(async () => {
        const cfg = await ensureConfig(null);
        const git = await runCmd("git", ["--version"], { timeoutMs: 5000 });
        return {
          version: VERSION,
          platform: process.platform,
          home: os.homedir(),
          root: resolveRoot(cfg),
          drives: listDrives(),
          gitAvailable: git.code === 0,
          gitVersion: git.code === 0 ? git.out.trim() : null,
          terminalMode: "pipe",
        };
      })
    );

    registerChannel(
      "config-get",
      guarded(async () => {
        return { config: await ensureConfig(null) };
      })
    );

    registerChannel(
      "config-set",
      guarded(async (_event, patch) => {
        const next = await saveConfig(patch || {});
        return { config: next };
      })
    );

    registerChannel(
      "list",
      guarded(async (_event, dir) => listDir(dir))
    );

    registerChannel(
      "read",
      guarded(async (_event, filePath) => readForView(filePath))
    );

    registerChannel(
      "write",
      guarded(async (_event, payload) => {
        const p = payload || {};
        return writeTextFile(p.path, p.content);
      })
    );

    registerChannel(
      "create",
      guarded(async (_event, payload) => {
        const p = payload || {};
        return createEntry(p.path, p.kind === "dir" ? "dir" : "file");
      })
    );

    registerChannel(
      "rename",
      guarded(async (_event, payload) => {
        const p = payload || {};
        return renameEntry(p.path, p.newName);
      })
    );

    registerChannel(
      "delete",
      guarded(async (_event, target) => deleteEntry(target))
    );

    registerChannel(
      "reveal",
      guarded(async (_event, target) => {
        const abs = path.resolve(String(target || ""));
        require("electron").shell.showItemInFolder(abs);
        return { path: abs };
      })
    );

    registerChannel(
      "open-external",
      guarded(async (_event, target) => {
        const abs = path.resolve(String(target || ""));
        const err = await require("electron").shell.openPath(abs);
        if (err) throw new Error(err);
        return { path: abs };
      })
    );

    registerChannel(
      "search",
      guarded(async (_event, payload) => {
        const p = payload || {};
        return searchFiles(p.root, p.query);
      })
    );

    registerChannel(
      "git-status",
      guarded(async (_event, dir) => gitStatus(dir))
    );

    registerChannel(
      "git-diff",
      guarded(async (_event, payload) => {
        const p = payload || {};
        return gitDiff(p.dir, p.path);
      })
    );

    registerChannel(
      "pick-dir",
      guarded(async () => {
        const { dialog, BrowserWindow } = require("electron");
        const parent = win && !win.isDestroyed() ? win : BrowserWindow.getFocusedWindow() || undefined;
        const res = await dialog.showOpenDialog(parent, {
          title: "选择工作台根目录",
          properties: ["openDirectory", "createDirectory"],
        });
        if (res.canceled || !res.filePaths || !res.filePaths.length) return { canceled: true, path: null };
        const picked = res.filePaths[0];
        await rememberRoot(picked);
        return { path: picked };
      })
    );

    registerChannel(
      "win-action",
      guarded(async (event, payload) => {
        const { BrowserWindow } = require("electron");
        const target = BrowserWindow.fromWebContents(event.sender);
        if (!target || target.isDestroyed()) return { action: "noop" };
        const action = String((payload && payload.action) || "").toLowerCase();
        if (action === "minimize") target.minimize();
        else if (action === "maximize") {
          if (target.isMaximized()) target.unmaximize();
          else target.maximize();
        } else if (action === "close") target.close();
        return { action: action };
      })
    );

    registerChannel(
      "pending-open",
      guarded(async () => {
        const cfg = await ensureConfig(null);
        const target = pendingOpen;
        pendingOpen = null;
        return { path: target, root: resolveRoot(cfg) };
      })
    );

    registerChannel(
      "term-start",
      guarded(async (_event, cwd) => {
        const cfg = await ensureConfig(null);
        const dir = cwd && String(cwd).trim() ? String(cwd).trim() : resolveRoot(cfg);
        const term = startTerm(isDirectorySync(dir) ? dir : os.homedir());
        return { id: term.id, cwd: term.cwd, mode: "pipe" };
      })
    );

    registerChannel(
      "term-write",
      guarded(async (_event, payload) => {
        const p = payload || {};
        return writeTerm(p.id, p.data);
      })
    );

    registerChannel(
      "term-poll",
      guarded(async (_event, payload) => {
        const p = payload || {};
        return pollTerm(p.id, p.cursor);
      })
    );

    registerChannel(
      "term-kill",
      guarded(async (_event, id) => killTerm(id))
    );

    registerChannel(
      "panel-hide",
      guarded(async () => {
        await saveConfig({ panelVisible: true, panelCollapsed: true });
        return (await ensurePanelHost().hide()) || { ok: true };
      })
    );

    registerChannel(
      "panel-show",
      guarded(async () => {
        await saveConfig({ panelVisible: true, panelCollapsed: false });
        return (await ensurePanelHost().show()) || { ok: true };
      })
    );

    // 常驻「工作台」按钮 / Ctrl+Shift+B 走这里：展开 ↔ 收起
    registerChannel(
      "panel-toggle",
      guarded(async () => {
        const cfg = await ensureConfig(null);
        const wantShow = !!cfg.panelCollapsed || cfg.panelVisible === false;
        await saveConfig({ panelVisible: true, panelCollapsed: !wantShow });
        const status = wantShow ? await ensurePanelHost().show() : await ensurePanelHost().hide();
        return status || { ok: true };
      })
    );

    registerChannel(
      "panel-width",
      guarded(async (_event, payload) => {
        const cfg = await ensureConfig(null);
        const asked = Number((payload && payload.width) || 0);
        // 只两档：给了具体宽度就吸附到最近档，没给就在两档间切
        const ww = ensurePanelHost().winWidth();
        const next = asked > 0 ? panel.normalizePanelWidth(asked, ww) : panel.nextPanelWidth(cfg.panelWidth, ww);
        await saveConfig({ panelWidth: next });
        const status = await ensurePanelHost().show();
        return Object.assign({ width: next, widths: panel.widthsFor(ww), winWidth: ww }, status);
      })
    );

    registerChannel(
      "panel-reload",
      guarded(async () => (await ensurePanelHost().refresh()) || { ok: true })
    );

    registerChannel(
      "panel-status",
      guarded(async () => ensurePanelHost().status())
    );

    /* ---------------- 动态上下文：改动清单规则（用户 2026-09-17 要求） ---------------- */

    ctx.registerPromptProvider({
      id: "change-report",
      modes: ["chat", "work", "code", "learn"],
      async provide({ signal }) {
        if (signal && signal.aborted) return "";
        try {
          const cfg = await ensureConfig(null);
          if (cfg.changeReport === false) return "";
        } catch (_) {
          /* 配置读不到也照常提醒 */
        }
        return (
          "【侧栏工作台】用户要求（2026-09-17 起长期有效）：只要这一轮改动了工作区里的文件，" +
          "回复结尾必须附一节「本次改动」，用表格列出：文件（绝对路径）/ 操作 / 说明；" +
          "没有改动就不要写这一节。清单里的文件用户会直接在右侧侧栏工作台里打开，所以路径必须能直接打开。"
        );
      },
    });

    /* ---------------- 清理托管 ---------------- */

    ctx.onDispose(() => {
      killAllTerms();
      shutdownPanel();
    });

    /* ---------------- 启动内嵌侧栏 ---------------- */

    ensurePanelHost();
    try {
      const boot = await ensurePanelHost().start();
      ctx.log(
        "侧栏工作台插件已就绪（v" +
          VERSION +
          " · 内嵌侧栏 " +
          (boot && boot.port ? "http://127.0.0.1:" + boot.port : "未启动") +
          "）"
      );
    } catch (error) {
      ctx.log("内嵌侧栏启动失败（工具仍可用）：" + ((error && error.message) || error));
    }
  },

  async unregister() {
    killAllTerms();
    await shutdownPanel();
    pluginCtx = null;
    configLoaded = false;
  },

  async open() {
    await openPanel();
  },
};

function renderConfig(cfg) {
  const c = cfg || {};
  return (
    "- 根目录：" + (c.root || "（未设置，回落到用户主目录）") + "\n" +
    "- 最近根目录：" + ((c.recentRoots || []).length ? (c.recentRoots || []).join(", ") : "（无）") + "\n" +
    "- 字号：" + (c.fontSize || 13) + " px\n" +
    "- 自动换行：" + (c.wrap === false ? "关" : "开") + "\n" +
    "- 缩进：" + (c.tabSize || 2) + " 空格\n" +
    "- 侧栏位置：Cyrene 聊天窗右侧（内嵌注入）\n" +
    "- 侧栏宽度：偏好档 " + (c.panelWidth || panel.REF_WIDTH) + " px（两档不写死像素：窄 " +
      Math.round((panel.WIDTH_RATIOS[0] || 0.3) * 100) + "% / 宽 " +
      Math.round((panel.WIDTH_RATIOS[1] || 0.45) * 100) + "%；当前聊天窗 " +
      (panelHost ? panelHost.winWidth() : panel.REF_WIDTH) + " px → 两档 " +
      panel.widthsFor(panelHost ? panelHost.winWidth() : null).join(" / ") + " px）\n" +
    "- 侧栏状态：" + (c.panelCollapsed ? "收起（右侧留小把手）" : "展开") +
      "（panelVisible=" + (c.panelVisible === false ? "false" : "true") + "）"
  );
}
