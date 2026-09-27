"use strict";

// ===========================================================================
// harnessNovel (网文拆书重铸引擎) —— Cyrene 运行时插件入口
//
// 自包含约束：只使用 Node 内置模块与 electron，不 require 任何未打包的 npm 包。
//
// 职责：
//   1) 桥接本机已安装的 harnessNovel（PyPI 包）统一 CLI：python -m novel_cli <子命令>
//   2) 提供环境自检 / 模型配置 / 工作区管理 / 拆书导入 / 全流程执行 / 后台任务 / Web 工作台
//   3) 提供插件设置窗口（ui.html）：Python 路径、工作区根目录、模型与 API Key、Web 工作台开关
//
// 与 Cyrene 本体的关系：完全插件化，不改动 Cyrene 源码。
// 工作区根目录通过环境变量 HARNESS_NOVEL_HOME 注入，保证 CLI 与 Web 端看到同一批小说。
// ===========================================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

const CONFIG_KEY = "config";
const PLUGIN_ID = "harness-novel";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** harnessNovel 全部子命令（白名单，避免任意命令注入）。 */
const SUBCOMMANDS = [
  "config",
  "list",
  "init",
  "reference-resume",
  "novel-outline",
  "world-import",
  "world-build",
  "novel-name-synopsis",
  "story-design",
  "design-concept",
  "stage-design",
  "story-design-extend",
  "stage-insert",
  "mechanics-init",
  "volume-outline",
  "story-arcs",
  "chapter-outlines",
  "write",
  "web",
];

/** 三组模型角色 → .env 前缀。 */
const ENV_ROLES = {
  dataBuilder: {
    prefix: "DATA_BUILDER",
    label: "参考小说故事情节单元提取（init 拆书流程，建议 flash 模型）",
  },
  adaptiveBuilder: {
    prefix: "ADAPTIVE_BUILDER",
    label: "全书设计与舞台设计（建议 pro 模型）",
  },
  adaptiveLite: {
    prefix: "ADAPTIVE_BUILDER_LITE",
    label: "故事情节、逐章章纲、正文与轻量辅助任务（建议 flash 模型）",
  },
};

const DEFAULT_WORKSPACE_ROOT = "D:\\ai\\program\\my-novels";

const DEFAULT_CONFIG = {
  pythonPath: "",
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  webHost: "127.0.0.1",
  webPort: 8765,
  env: {
    dataBuilder: { model: "", baseUrl: "", apiKey: "" },
    adaptiveBuilder: { model: "", baseUrl: "", apiKey: "" },
    adaptiveLite: { model: "", baseUrl: "", apiKey: "" },
  },
};

// ---------------------------------------------------------------------------
// 运行时状态（模块级单例）
// ---------------------------------------------------------------------------

let ctxRef = null;
let pluginWin = null;
let webProc = null; // { pid, host, port, url, startedAt }
let pyCache = null;
const jobs = new Map(); // jobId -> job

// ---------------------------------------------------------------------------
// 配置读写
// ---------------------------------------------------------------------------

function normalizeConfig(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = Object.assign({}, DEFAULT_CONFIG);
  if (typeof src.pythonPath === "string") out.pythonPath = src.pythonPath.trim();
  if (typeof src.workspaceRoot === "string" && src.workspaceRoot.trim()) {
    out.workspaceRoot = src.workspaceRoot.trim();
  }
  if (typeof src.webHost === "string" && src.webHost.trim()) out.webHost = src.webHost.trim();
  const port = Number(src.webPort);
  if (Number.isFinite(port) && port > 0 && port < 65536) out.webPort = Math.floor(port);
  out.env = Object.assign({}, DEFAULT_CONFIG.env);
  if (src.env && typeof src.env === "object") {
    for (const role of Object.keys(ENV_ROLES)) {
      const v = src.env[role];
      if (v && typeof v === "object") {
        out.env[role] = {
          model: typeof v.model === "string" ? v.model.trim() : "",
          baseUrl: typeof v.baseUrl === "string" ? v.baseUrl.trim() : "",
          apiKey: typeof v.apiKey === "string" ? v.apiKey.trim() : "",
        };
      }
    }
  }
  return out;
}

function loadConfig() {
  if (!ctxRef) return normalizeConfig(null);
  let raw = null;
  try {
    raw = ctxRef.storage.get(CONFIG_KEY);
  } catch (_) {
    raw = null;
  }
  return normalizeConfig(raw);
}

function saveConfig(patch) {
  const merged = normalizeConfig(Object.assign({}, loadConfig(), patch || {}));
  if (patch && patch.env && typeof patch.env === "object") {
    const base = loadConfig();
    merged.env = Object.assign({}, base.env);
    for (const role of Object.keys(ENV_ROLES)) {
      const v = patch.env[role];
      if (v && typeof v === "object") {
        merged.env[role] = Object.assign({}, base.env[role], {
          model: typeof v.model === "string" ? v.model.trim() : base.env[role].model,
          baseUrl: typeof v.baseUrl === "string" ? v.baseUrl.trim() : base.env[role].baseUrl,
          apiKey: typeof v.apiKey === "string" ? v.apiKey.trim() : base.env[role].apiKey,
        });
      }
    }
  }
  try {
    ctxRef.storage.set(CONFIG_KEY, merged);
  } catch (err) {
    if (ctxRef) ctxRef.log("[harness-novel] 保存配置失败: " + err.message);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// ~/.harnessNovel/.env 读写（CLI 与 Web 端共同读取的全局配置）
// ---------------------------------------------------------------------------

function envFilePath() {
  return path.join(os.homedir(), ".harnessNovel", ".env");
}

function writeEnvFile(cfg) {
  const p = envFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const lines = ["# harnessNovel 全局配置（由 Cyrene · harnessNovel 插件生成 / 维护）"];
  for (const role of Object.keys(ENV_ROLES)) {
    const meta = ENV_ROLES[role];
    const v = (cfg.env && cfg.env[role]) || {};
    lines.push("");
    lines.push("# " + meta.label);
    lines.push(meta.prefix + "_MODEL=" + (v.model || ""));
    lines.push(meta.prefix + "_BASE_URL=" + (v.baseUrl || ""));
    lines.push(meta.prefix + "_API_KEY=" + (v.apiKey || ""));
  }
  lines.push("");
  fs.writeFileSync(p, lines.join("\n"), "utf8");
  return p;
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

// ---------------------------------------------------------------------------
// Python 与 harnessNovel 探测
// ---------------------------------------------------------------------------

function resolvePython(force) {
  const cfg = loadConfig();
  if (pyCache && !force && pyCache.requested === cfg.pythonPath) return pyCache;
  const probe = "import sys;print(sys.executable)";
  const candidates = [];
  if (cfg.pythonPath) candidates.push([cfg.pythonPath, []]);
  candidates.push(["py", ["-3"]]);
  candidates.push(["python", []]);
  candidates.push(["python3", []]);
  for (const entry of candidates) {
    const cmd = entry[0];
    const prefix = entry[1];
    try {
      const r = spawnSync(cmd, prefix.concat(["-c", probe]), {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000,
      });
      if (r.status === 0 && r.stdout && r.stdout.trim()) {
        const exe = r.stdout.trim().split(/\r?\n/).pop().trim();
        pyCache = { requested: cfg.pythonPath, cmd: exe, raw: cmd, prefix: [], source: cmd === cfg.pythonPath ? "用户指定" : "自动探测(" + cmd + ")" };
        return pyCache;
      }
    } catch (_) {
      /* 试下一个候选 */
    }
  }
  pyCache = { requested: cfg.pythonPath, cmd: null, raw: null, prefix: null, source: "未找到" };
  return pyCache;
}

function probePackage() {
  const py = resolvePython();
  if (!py || !py.cmd) return { installed: false, version: null, error: "未找到 Python 解释器" };
  const code = "import importlib.metadata as m;print(m.version('harnessNovel'))";
  try {
    const r = spawnSync(py.cmd, ["-c", code], { encoding: "utf8", windowsHide: true, timeout: 60000 });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      return { installed: true, version: r.stdout.trim(), error: null };
    }
    const msg = ((r.stderr || "") + (r.stdout || "")).trim().replace(/\s+/g, " ").slice(0, 300);
    return { installed: false, version: null, error: msg || "未检测到 harnessNovel 包" };
  } catch (err) {
    return { installed: false, version: null, error: String((err && err.message) || err) };
  }
}

function baseEnv(cfg) {
  const env = Object.assign({}, process.env);
  env.HARNESS_NOVEL_HOME = cfg.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONUTF8 = "1";
  for (const role of Object.keys(ENV_ROLES)) {
    const meta = ENV_ROLES[role];
    const v = (cfg.env && cfg.env[role]) || {};
    if (v.model) env[meta.prefix + "_MODEL"] = v.model;
    if (v.baseUrl) env[meta.prefix + "_BASE_URL"] = v.baseUrl;
    if (v.apiKey) env[meta.prefix + "_API_KEY"] = v.apiKey;
  }
  return env;
}

// ---------------------------------------------------------------------------
// 进程工具
// ---------------------------------------------------------------------------

function killTree(pid) {
  if (!pid) return;
  try {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, timeout: 15000 });
  } catch (_) {
    try {
      process.kill(pid);
    } catch (__) {
      /* ignore */
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runCli(cfg, args, opts) {
  return new Promise((resolve) => {
    const py = resolvePython();
    if (!py.cmd) {
      resolve({ ok: false, code: -1, stdout: "", stderr: "未找到可用的 Python 解释器，请在插件设置中指定 python.exe 路径。" });
      return;
    }
    const timeoutSec = Math.max(10, Number((opts && opts.timeoutSec) || 900));
    let child;
    try {
      child = spawn(py.cmd, ["-m", "novel_cli"].concat(args), {
        cwd: cfg.workspaceRoot,
        env: baseEnv(cfg),
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, code: -3, stdout: "", stderr: "启动失败：" + String((err && err.message) || err) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      killTree(child.pid);
      resolve({
        ok: false,
        code: -2,
        stdout,
        stderr: stderr + "\n[超时] 命令超过 " + timeoutSec + " 秒仍未结束，已终止。长任务请改用 background=true。",
        timedOut: true,
      });
    }, timeoutSec * 1000);
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, code: -3, stdout, stderr: String((err && err.message) || err) });
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code, stdout, stderr });
    });
  });
}

function jobsDir(cfg) {
  const dir = path.join(cfg.workspaceRoot || DEFAULT_WORKSPACE_ROOT, ".harness-novel-jobs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function spawnBackground(cfg, args, label) {
  const py = resolvePython();
  if (!py.cmd) return { error: "未找到可用的 Python 解释器。" };
  const dir = jobsDir(cfg);
  const jobId = "job-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const logPath = path.join(dir, jobId + ".log");
  let fd;
  try {
    fd = fs.openSync(logPath, "a");
    fs.writeSync(fd, "[" + new Date().toISOString() + "] $ novel " + args.join(" ") + "\n");
  } catch (err) {
    return { error: "无法创建日志文件：" + String((err && err.message) || err) };
  }
  let child;
  try {
    child = spawn(py.cmd, ["-m", "novel_cli"].concat(args), {
      cwd: cfg.workspaceRoot,
      env: baseEnv(cfg),
      windowsHide: true,
      stdio: ["ignore", fd, fd],
    });
  } catch (err) {
    try { fs.closeSync(fd); } catch (_) {}
    return { error: "启动失败：" + String((err && err.message) || err) };
  }
  const job = {
    id: jobId,
    pid: child.pid,
    logPath,
    args: args.slice(),
    label: label || ("novel " + args.join(" ")),
    startedAt: Date.now(),
    status: "running",
    endedAt: null,
    exitCode: null,
  };
  jobs.set(jobId, job);
  child.on("close", (code) => {
    job.status = code === 0 ? "done" : "failed";
    job.exitCode = code;
    job.endedAt = Date.now();
    try { fs.closeSync(fd); } catch (_) {}
    notifyProgress();
  });
  child.on("error", (err) => {
    job.status = "failed";
    job.error = String((err && err.message) || err);
    job.endedAt = Date.now();
    notifyProgress();
  });
  return { job: job };
}

function tailFile(p, maxLines) {
  try {
    const text = fs.readFileSync(p, "utf8");
    const lines = text.split(/\r?\n/);
    const n = Math.max(1, Number(maxLines) || 80);
    return { text: lines.slice(-n).join("\n"), totalLines: lines.length };
  } catch (err) {
    return { text: "", totalLines: 0, error: String((err && err.message) || err) };
  }
}

// ---------------------------------------------------------------------------
// Web 工作台管理
// ---------------------------------------------------------------------------

function httpPing(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let req;
    try {
      req = http.request({ host: host, port: port, path: "/", method: "GET" }, (res) => {
        res.resume();
        finish(true);
      });
    } catch (_) {
      finish(false);
      return;
    }
    req.setTimeout(timeoutMs || 1500, () => {
      try { req.destroy(); } catch (_) {}
      finish(false);
    });
    req.on("error", () => finish(false));
    req.end();
  });
}

async function webStatus(cfg) {
  const host = cfg.webHost || "127.0.0.1";
  const port = Number(cfg.webPort || 8765);
  const up = await httpPing(host, port, 1500);
  if (!up && webProc && webProc.port === port) {
    // 进程记录还在但端口没响应，视为已退出
    webProc = null;
  }
  return { running: up, host: host, port: port, url: "http://" + host + ":" + port, pid: up && webProc ? webProc.pid : null };
}

async function startWeb(cfg) {
  const host = cfg.webHost || "127.0.0.1";
  const port = Number(cfg.webPort || 8765);
  const st = await webStatus(cfg);
  if (st.running) {
    webProc = webProc || { pid: null, host: host, port: port, url: st.url, startedAt: Date.now() };
    return { ok: true, already: true, url: st.url, port: port };
  }
  const py = resolvePython();
  if (!py.cmd) return { ok: false, error: "未找到可用的 Python 解释器，请在插件设置中指定 python.exe 路径。" };
  let child;
  try {
    child = spawn(py.cmd, ["-m", "novel_cli", "web", "--host", host, "--port", String(port)], {
      cwd: cfg.workspaceRoot,
      env: baseEnv(cfg),
      windowsHide: true,
      detached: false,
      stdio: "ignore",
    });
  } catch (err) {
    return { ok: false, error: "启动失败：" + String((err && err.message) || err) };
  }
  const started = { pid: child.pid, host: host, port: port, url: "http://" + host + ":" + port, startedAt: Date.now() };
  webProc = started;
  child.on("close", () => {
    if (webProc && webProc.pid === started.pid) webProc = null;
    notifyProgress();
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await httpPing(host, port, 1500)) {
      notifyProgress();
      return { ok: true, url: started.url, port: port, pid: started.pid };
    }
    await sleep(600);
  }
  killTree(child.pid);
  webProc = null;
  return { ok: false, error: "Web 工作台在 60 秒内未就绪。可能是端口被占用，或首次启动依赖安装较慢，可稍后在浏览器里手动访问 " + started.url };
}

function stopWeb() {
  let killed = false;
  if (webProc && webProc.pid) {
    killTree(webProc.pid);
    killed = true;
  }
  webProc = null;
  return killed;
}

// ---------------------------------------------------------------------------
// 输出格式化
// ---------------------------------------------------------------------------

function clip(text, max) {
  const t = (text || "").trim();
  const limit = max || 6000;
  if (t.length <= limit) return t;
  return t.slice(0, limit) + "\n...(输出较长已截断，完整内容可用后台任务日志查看)";
}

function formatRunResult(res, args) {
  const head = res.ok ? "✅ 执行成功" : "❌ 执行失败";
  const parts = [head + "：`novel " + args.join(" ") + "`"];
  if (typeof res.code === "number") parts.push("退出码：" + res.code);
  if (res.stdout && res.stdout.trim()) parts.push("```\n" + clip(res.stdout, 6000) + "\n```");
  if (res.stderr && res.stderr.trim()) parts.push("stderr：\n```\n" + clip(res.stderr, 3000) + "\n```");
  if (!res.stdout.trim() && !res.stderr.trim()) parts.push("(无输出)");
  return parts.join("\n\n");
}

function listWorkspaceSummary(cfg) {
  const root = cfg.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  if (!fs.existsSync(root)) return { root: root, exists: false, items: [] };
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    return { root: root, exists: true, items: [], error: String((err && err.message) || err) };
  }
  const items = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    const dir = path.join(root, e.name);
    let chapters = 0;
    let hasDesign = false;
    let hasReference = false;
    try {
      const fsDir = path.join(dir, "file_system");
      if (fs.existsSync(fsDir)) {
        const walk = (d) => {
          for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            if (f.isDirectory()) walk(path.join(d, f.name));
            else if (/\.(md|txt)$/i.test(f.name)) {
              const rel = path.relative(fsDir, path.join(d, f.name));
              if (/chapter|正文|章节/i.test(rel)) chapters += 1;
              if (/design|outline|设计|大纲/i.test(rel)) hasDesign = true;
            }
          }
        };
        walk(fsDir);
      }
      hasReference = fs.existsSync(path.join(dir, "reference"));
    } catch (_) {
      /* ignore */
    }
    items.push({
      name: e.name,
      path: dir,
      chapterFiles: chapters,
      hasDesign: hasDesign,
      hasReference: hasReference,
      mtime: safeMtime(dir),
    });
  }
  items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return { root: root, exists: true, items: items };
}

function safeMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function notifyProgress() {
  if (!pluginWin || pluginWin.isDestroyed()) return;
  try {
    pluginWin.webContents.send("plugin:" + PLUGIN_ID + ":progress", buildState());
  } catch (_) {
    /* ignore */
  }
}

function buildState() {
  const cfg = loadConfig();
  const py = resolvePython();
  const pkg = probePackage();
  const ws = listWorkspaceSummary(cfg);
  const web = {
    running: !!(webProc && webProc.pid),
    url: "http://" + (cfg.webHost || "127.0.0.1") + ":" + Number(cfg.webPort || 8765),
  };
  const jobList = Array.from(jobs.values()).map((j) => ({
    id: j.id,
    label: j.label,
    status: j.status,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    logPath: j.logPath,
  }));
  return {
    config: {
      pythonPath: cfg.pythonPath,
      workspaceRoot: cfg.workspaceRoot,
      webHost: cfg.webHost,
      webPort: cfg.webPort,
    },
    env: {
      dataBuilder: {
        model: cfg.env.dataBuilder.model,
        baseUrl: cfg.env.dataBuilder.baseUrl,
        apiKeyMasked: maskKey(cfg.env.dataBuilder.apiKey),
        hasKey: !!cfg.env.dataBuilder.apiKey,
      },
      adaptiveBuilder: {
        model: cfg.env.adaptiveBuilder.model,
        baseUrl: cfg.env.adaptiveBuilder.baseUrl,
        apiKeyMasked: maskKey(cfg.env.adaptiveBuilder.apiKey),
        hasKey: !!cfg.env.adaptiveBuilder.apiKey,
      },
      adaptiveLite: {
        model: cfg.env.adaptiveLite.model,
        baseUrl: cfg.env.adaptiveLite.baseUrl,
        apiKeyMasked: maskKey(cfg.env.adaptiveLite.apiKey),
        hasKey: !!cfg.env.adaptiveLite.apiKey,
      },
    },
    envFilePath: envFilePath(),
    envFileExists: fs.existsSync(envFilePath()),
    python: { path: py.cmd, source: py.source },
    package: pkg,
    workspace: ws,
    web: web,
    jobs: jobList,
  };
}

// ---------------------------------------------------------------------------
// 插件导出
// ---------------------------------------------------------------------------

module.exports = {
  async register(ctx) {
    ctxRef = ctx;
    ctx.log("注册 harnessNovel 网文拆书重铸引擎插件...");

    // ---------------- 工具 1：环境自检 ----------------
    ctx.registerTool({
      id: "harness-novel_doctor",
      name: "harnessNovel 环境自检",
      description:
        "检查 harnessNovel 运行环境：Python 解释器、harnessNovel 包版本、全局配置文件 ~/.harnessNovel/.env、工作区根目录与已有工作区列表。用户问「拆书引擎能跑吗」「harnessNovel 装好了没」「有哪些小说工作区」时使用。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const cfg = loadConfig();
        const py = resolvePython(true);
        const pkg = probePackage();
        const ws = listWorkspaceSummary(cfg);
        const lines = ["## harnessNovel 环境自检", ""];
        lines.push("- Python：" + (py.cmd ? "`" + py.cmd + "`（" + py.source + "）" : "**未找到**，请在插件设置中指定 python.exe"));
        lines.push("- harnessNovel 包：" + (pkg.installed ? "已安装 v" + pkg.version : "**未安装**" + (pkg.error ? "（" + pkg.error + "）" : "")));
        lines.push("- 全局配置：" + envFilePath() + (fs.existsSync(envFilePath()) ? "（已存在）" : "（不存在，可用 harness-novel_config 初始化）"));
        for (const role of Object.keys(ENV_ROLES)) {
          const v = cfg.env[role];
          lines.push("  - " + ENV_ROLES[role].prefix + "：" + (v.model ? v.model : "(未设置模型)") + " / " + (v.baseUrl ? v.baseUrl : "(未设置地址)") + " / " + (v.apiKey ? maskKey(v.apiKey) : "(未设置 Key)"));
        }
        lines.push("- 工作区根目录：`" + ws.root + "`" + (ws.exists ? "" : "（目录尚不存在，首次 init 时会自动创建）"));
        lines.push("- 已有工作区：" + (ws.items.length ? "" : "无"));
        ws.items.forEach((it) => {
          lines.push("  - " + it.name + " | 参考书拆解：" + (it.hasReference ? "有" : "无") + " | 设计文档：" + (it.hasDesign ? "有" : "无") + " | 正文/章节文件：" + it.chapterFiles);
        });
        if (!pkg.installed) {
          lines.push("");
          lines.push("安装命令：`" + (py.cmd || "python") + " -m pip install harnessNovel`");
        }
        return lines.join("\n");
      },
    });

    // ---------------- 工具 2：模型与全局配置 ----------------
    ctx.registerTool({
      id: "harness-novel_config",
      name: "读写信笺与全局配置",
      description:
        "读取或写入 harnessNovel 的全局配置：Python 路径、工作区根目录、Web 端口，以及三组模型（拆书 / 全书设计 / 正文生成）的 model、baseUrl、apiKey。写回后会同步刷新 ~/.harnessNovel/.env。action=get 只读，action=set 写入 patch 里给出的字段。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set"], description: "get=读取当前配置；set=写入（只传需要修改的字段）" },
          patch: {
            type: "object",
            description:
              '要写入的配置片段。示例：{"workspaceRoot":"D:\\\\ai\\\\program\\\\my-novels","pythonPath":"C:\\\\...\\\\python.exe","webPort":8765,"env":{"dataBuilder":{"model":"deepseek-v4-flash","baseUrl":"https://api.deepseek.com","apiKey":"sk-xxx"},"adaptiveBuilder":{"model":"deepseek-v4-pro","baseUrl":"https://api.deepseek.com","apiKey":"sk-xxx"},"adaptiveLite":{"model":"deepseek-v4-flash","baseUrl":"https://api.deepseek.com","apiKey":"sk-xxx"}}}',
          },
        },
        required: ["action"],
      },
      async execute(params) {
        const action = String(params.action || "get");
        if (action === "set") {
          if (!params.patch || typeof params.patch !== "object") {
            return "需要提供 patch 对象（要修改的配置字段）。";
          }
          const next = saveConfig(params.patch);
          let envPath = null;
          try {
            envPath = writeEnvFile(next);
          } catch (err) {
            return "配置已保存，但写入 .env 失败：" + String((err && err.message) || err);
          }
          pyCache = null; // Python 路径可能已变化
          notifyProgress();
          return [
            "✅ 配置已更新",
            "- Python：" + (next.pythonPath || "(自动探测)"),
            "- 工作区根目录：`" + next.workspaceRoot + "`",
            "- Web 工作台：http://" + next.webHost + ":" + next.webPort,
            "- .env 已写入：" + envPath,
            "",
            "提示：Web 工作台若正在运行，需重启后才会应用新的工作区根目录。",
          ].join("\n");
        }
        const cfg = loadConfig();
        const lines = ["## 当前 harnessNovel 配置", ""];
        lines.push("- Python 路径：" + (cfg.pythonPath || "(自动探测)"));
        lines.push("- 工作区根目录：`" + cfg.workspaceRoot + "`");
        lines.push("- Web 工作台：http://" + cfg.webHost + ":" + cfg.webPort);
        lines.push("- .env 文件：" + envFilePath() + (fs.existsSync(envFilePath()) ? "（存在）" : "（不存在）"));
        for (const role of Object.keys(ENV_ROLES)) {
          const v = cfg.env[role];
          lines.push("- " + ENV_ROLES[role].prefix + "：模型 " + (v.model || "(空)") + " | 地址 " + (v.baseUrl || "(空)") + " | Key " + (v.apiKey ? maskKey(v.apiKey) : "(空)"));
        }
        return lines.join("\n");
      },
    });

    // ---------------- 工具 3：工作区列表 ----------------
    ctx.registerTool({
      id: "harness-novel_workspaces",
      name: "列出小说工作区",
      description:
        "列出 harnessNovel 工作区根目录下的所有小说工作区，并统计各自是否已导入参考书、是否已有全书设计文档、已生成多少正文/章节文件。用户问「我的小说进度」「有哪些书在工作区」时使用。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const cfg = loadConfig();
        const ws = listWorkspaceSummary(cfg);
        if (!ws.exists) {
          return "工作区根目录 `" + ws.root + "` 还不存在。可以先运行 harness-novel_init 创建第一本小说的工程。";
        }
        if (!ws.items.length) {
          return "工作区根目录 `" + ws.root + "` 下暂无小说工作区。用 harness-novel_init 创建一本吧♪";
        }
        const lines = ["## 小说工作区（根目录：`" + ws.root + "`）", ""];
        lines.push("| 工作区 | 参考书拆解 | 全书设计 | 正文/章节文件 | 最近改动 |");
        lines.push("| --- | --- | --- | --- | --- |");
        ws.items.forEach((it) => {
          const t = it.mtime ? new Date(it.mtime).toLocaleString("zh-CN") : "-";
          lines.push("| " + it.name + " | " + (it.hasReference ? "✅" : "—") + " | " + (it.hasDesign ? "✅" : "—") + " | " + it.chapterFiles + " | " + t + " |");
        });
        lines.push("");
        lines.push("路径：" + ws.items.map((i) => "`" + i.path + "`").join("、"));
        return lines.join("\n");
      },
    });

    // ---------------- 工具 4：创建工作区 / 拆书 ----------------
    ctx.registerTool({
      id: "harness-novel_init",
      name: "创建工作区并拆解参考书",
      description:
        "创建一本新小说的 harnessNovel 工作区。可传入参考小说 txt/md 路径，创建后立即启动「拆书」逆向工程：提取故事情节单元、节奏与行文指纹（这一步会消耗较多 API 额度，建议先用 maxChapters 限制章数试跑）。",
      enabled: true,
      risk: "shell",
      effectKind: "external_side_effect",
      inputSchema: {
        type: "object",
        properties: {
          workspace: { type: "string", description: "工作区名称（即小说项目名，建议与书名一致）" },
          txt: { type: "string", description: "参考小说文件路径（.txt / .md），可选；不传则只创建空工作区" },
          maxChapters: { type: "integer", description: "只拆解参考书的前 N 章，可选（默认整本，首次试跑建议 30~50）" },
          batchSize: { type: "integer", description: "每次读取章节数，用于识别故事情节单元，默认 20" },
          noAnalyze: { type: "boolean", description: "true=仅导入参考小说，不立即开始拆解" },
          background: { type: "boolean", description: "true=后台执行（拆书耗时较长时推荐），返回任务 id 与日志路径" },
        },
        required: ["workspace"],
      },
      async execute(params) {
        const cfg = loadConfig();
        const args = ["init", String(params.workspace)];
        if (params.txt) args.push("--txt", String(params.txt));
        if (params.maxChapters) args.push("--max-chapters", String(Math.floor(Number(params.maxChapters))));
        if (params.batchSize) args.push("--batch-size", String(Math.floor(Number(params.batchSize))));
        if (params.noAnalyze) args.push("--no-analyze");
        if (params.background) {
          const r = spawnBackground(cfg, args, "拆书：" + params.workspace);
          if (r.error) return "❌ " + r.error;
          notifyProgress();
          return [
            "🚀 拆书任务已在后台启动",
            "- 任务 id：`" + r.job.id + "`",
            "- 命令：`novel " + args.join(" ") + "`",
            "- 日志：" + r.job.logPath,
            "",
            "拆解一本长篇参考书可能需要较长时间，可用 harness-novel_jobs 查看进度。",
          ].join("\n");
        }
        const res = await runCli(cfg, args, { timeoutSec: 1800 });
        notifyProgress();
        return formatRunResult(res, args);
      },
    });

    // ---------------- 工具 5：执行全流程子命令 ----------------
    ctx.registerTool({
      id: "harness-novel_run",
      name: "执行 harnessNovel 子命令",
      description:
        "执行 harnessNovel 的任意流程子命令。常用：novel-outline(核心玩法/长线/舞台路线图)、world-import(导入题材资料)、design-concept(粗略大纲与世界观)、stage-design(舞台路线图)、mechanics-init(机制层)、volume-outline(卷纲)、story-arcs(故事情节单元)、chapter-outlines(逐章章纲)、write(串行生成正文)、reference-resume(继续拆书)、novel-name-synopsis(书名与简介)。长任务建议 background=true。",
      enabled: true,
      risk: "shell",
      effectKind: "external_side_effect",
      inputSchema: {
        type: "object",
        properties: {
          subcommand: { type: "string", description: "子命令名，如 write / chapter-outlines / volume-outline / stage-design / novel-outline" },
          workspace: { type: "string", description: "目标工作区名称" },
          args: {
            type: "array",
            items: { type: "string" },
            description:
              '追加参数（不含子命令与工作区名）。例如 write 用 ["--volume","1","--max","10"]；world-import 需要在 args 里放资料路径 ["D:\\\\资料\\\\设定.md","--build"]。',
          },
          background: { type: "boolean", description: "true=后台执行并写日志（长任务推荐）" },
          timeoutSec: { type: "integer", description: "前台执行超时秒数，默认 900" },
        },
        required: ["subcommand", "workspace"],
      },
      async execute(params) {
        const cfg = loadConfig();
        const sub = String(params.subcommand || "").trim();
        if (SUBCOMMANDS.indexOf(sub) === -1) {
          return "❌ 不支持的子命令 `" + sub + "`。可用：" + SUBCOMMANDS.join(" / ");
        }
        if (sub === "web") {
          return "启动 Web 工作台请使用 harness-novel_web 工具（action=start）。";
        }
        if (sub === "config") {
          return "初始化全局配置请使用 harness-novel_config 工具（action=set）。";
        }
        const extra = Array.isArray(params.args) ? params.args.map((a) => String(a)) : [];
        const args = [sub, String(params.workspace)].concat(extra);
        if (params.background) {
          const r = spawnBackground(cfg, args, sub + "：" + params.workspace);
          if (r.error) return "❌ " + r.error;
          notifyProgress();
          return [
            "🚀 任务已在后台启动",
            "- 任务 id：`" + r.job.id + "`",
            "- 命令：`novel " + args.join(" ") + "`",
            "- 日志：" + r.job.logPath,
            "",
            "随时用 harness-novel_jobs 查看状态或读取日志。",
          ].join("\n");
        }
        const res = await runCli(cfg, args, { timeoutSec: params.timeoutSec });
        notifyProgress();
        return formatRunResult(res, args);
      },
    });

    // ---------------- 工具 6：后台任务管理 ----------------
    ctx.registerTool({
      id: "harness-novel_jobs",
      name: "后台任务状态与日志",
      description: "管理由本插件启动的 harnessNovel 后台任务：列出任务、读取日志尾部、终止任务。用户问「拆书跑完了吗」「正文写到哪了」时使用。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "log", "stop"], description: "list=列出任务；log=读取某任务日志；stop=终止任务" },
          jobId: { type: "string", description: "任务 id（list 输出中有）" },
          tailLines: { type: "integer", description: "读取日志末尾行数，默认 80" },
        },
        required: ["action"],
      },
      async execute(params) {
        const action = String(params.action || "list");
        if (action === "list") {
          if (!jobs.size) return "当前没有由本插件启动的后台任务。";
          const lines = ["## 后台任务", "", "| 任务 id | 说明 | 状态 | 启动时间 | 日志 |", "| --- | --- | --- | --- | --- |"];
          for (const j of jobs.values()) {
            lines.push(
              "| `" + j.id + "` | " + j.label + " | " + j.status + (j.exitCode !== null && j.exitCode !== undefined ? "(" + j.exitCode + ")" : "") + " | " + new Date(j.startedAt).toLocaleString("zh-CN") + " | `" + j.logPath + "` |"
            );
          }
          return lines.join("\n");
        }
        const jobId = String(params.jobId || "");
        const job = jobs.get(jobId);
        if (!job) return "未找到任务 `" + jobId + "`，可先用 action=list 查看。";
        if (action === "log") {
          const t = tailFile(job.logPath, params.tailLines || 80);
          if (t.error) return "读取日志失败：" + t.error;
          return ["## 任务 `" + job.id + "` 日志（末尾，共 " + t.totalLines + " 行）", "- 状态：" + job.status, "- 文件：" + job.logPath, "", "```", t.text, "```"].join("\n");
        }
        if (action === "stop") {
          if (job.status !== "running") return "任务 `" + job.id + "` 当前状态为 " + job.status + "，无需终止。";
          killTree(job.pid);
          job.status = "stopped";
          job.endedAt = Date.now();
          notifyProgress();
          return "🛑 已终止任务 `" + job.id + "`。";
        }
        return "未知 action：" + action;
      },
    });

    // ---------------- 工具 7：Web 工作台 ----------------
    ctx.registerTool({
      id: "harness-novel_web",
      name: "Web 工作台开关",
      description:
        "启动 / 停止 / 查询 harnessNovel 本地可视化工作台（默认 http://127.0.0.1:8765）。工作台支持多轮对话式调节全书设计、舞台、故事情节、章纲与正文。action=open 会用默认浏览器打开。",
      enabled: true,
      risk: "shell",
      effectKind: "external_side_effect",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "stop", "status", "open"], description: "start=启动；stop=停止；status=查询；open=在浏览器打开" },
          openBrowser: { type: "boolean", description: "start 时顺带用默认浏览器打开，默认 false" },
        },
        required: ["action"],
      },
      async execute(params) {
        const cfg = loadConfig();
        const action = String(params.action || "status");
        if (action === "status") {
          const st = await webStatus(cfg);
          return st.running
            ? "Web 工作台正在运行：" + st.url + (st.pid ? "（pid " + st.pid + "）" : "")
            : "Web 工作台未运行。可用 action=start 启动。";
        }
        if (action === "start") {
          const r = await startWeb(cfg);
          if (!r.ok) return "❌ " + r.error;
          if (params.openBrowser) openExternal(r.url);
          return (r.already ? "Web 工作台已在运行：" : "✅ Web 工作台已启动：") + r.url;
        }
        if (action === "stop") {
          const killed = stopWeb();
          notifyProgress();
          return killed ? "🛑 Web 工作台已停止。" : "Web 工作台当前未由本插件运行（若在其他终端启动，请在那里关闭）。";
        }
        if (action === "open") {
          const st = await webStatus(cfg);
          let url = st.url;
          if (!st.running) {
            const r = await startWeb(cfg);
            if (!r.ok) return "❌ " + r.error;
            url = r.url;
          }
          openExternal(url);
          return "已在默认浏览器打开：" + url;
        }
        return "未知 action：" + action;
      },
    });

    // ---------------- IPC：供设置窗口调用 ----------------
    ctx.registerIpc("getState", async () => buildState());

    ctx.registerIpc("saveConfig", async (patch) => {
      const next = saveConfig(patch && typeof patch === "object" ? patch : {});
      const p = writeEnvFile(next);
      pyCache = null;
      notifyProgress();
      return { ok: true, envPath: p, state: buildState() };
    });

    ctx.registerIpc("startWeb", async () => {
      const r = await startWeb(loadConfig());
      notifyProgress();
      return r;
    });

    ctx.registerIpc("stopWeb", async () => {
      const killed = stopWeb();
      notifyProgress();
      return { ok: true, killed: killed, state: buildState() };
    });

    ctx.registerIpc("openWeb", async () => {
      const cfg = loadConfig();
      const st = await webStatus(cfg);
      let url = st.url;
      if (!st.running) {
        const r = await startWeb(cfg);
        if (!r.ok) return r;
        url = r.url;
      }
      openExternal(url);
      return { ok: true, url: url };
    });

    ctx.registerIpc("openFolder", async (target) => {
      const cfg = loadConfig();
      let dir = cfg.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
      if (target === "env") dir = path.dirname(envFilePath());
      if (target === "jobs") dir = jobsDir(cfg);
      try {
        require("electron").shell.openPath(dir);
        return { ok: true, dir: dir };
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
      }
    });

    ctx.registerIpc("installPackage", async () => {
      const py = resolvePython(true);
      if (!py.cmd) return { ok: false, error: "未找到 Python 解释器。" };
      const r = spawnSync(py.cmd, ["-m", "pip", "install", "harnessNovel"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 600000,
      });
      pyCache = null;
      notifyProgress();
      if (r.status === 0) return { ok: true, output: clip(r.stdout || "", 3000) };
      return { ok: false, error: clip((r.stderr || "") + (r.stdout || ""), 3000) };
    });

    ctx.registerIpc("tailJob", async (jobId) => {
      const job = jobs.get(String(jobId || ""));
      if (!job) return { ok: false, error: "未找到任务" };
      const t = tailFile(job.logPath, 120);
      return { ok: true, status: job.status, logPath: job.logPath, text: t.text };
    });

    if (typeof ctx.onDispose === "function") ctx.onDispose(() => {
      stopWeb();
      if (pluginWin && !pluginWin.isDestroyed()) pluginWin.close();
      pluginWin = null;
      ctxRef = null;
    });

    ctx.log("harnessNovel 插件已注册完成");
  },

  async open() {
    if (pluginWin && !pluginWin.isDestroyed()) {
      pluginWin.focus();
      return;
    }
    const { BrowserWindow } = require("electron");
    pluginWin = new BrowserWindow({
      width: 720,
      height: 780,
      minWidth: 600,
      minHeight: 600,
      autoHideMenuBar: true,
      backgroundColor: "#fff7fb",
      title: "harnessNovel · 网文拆书重铸引擎",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
    pluginWin.on("closed", () => {
      pluginWin = null;
    });
    await pluginWin.loadFile(path.join(__dirname, "ui.html"));
  },

  async unregister() {
    stopWeb();
    if (pluginWin && !pluginWin.isDestroyed()) pluginWin.close();
    pluginWin = null;
    ctxRef = null;
  },
};

function openExternal(url) {
  try {
    require("electron").shell.openExternal(url);
  } catch (_) {
    /* ignore */
  }
}
