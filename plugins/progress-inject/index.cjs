"use strict";

/**
 * progress-inject —— Cyrene 插件（apiVersion 1）
 *
 * 解决的问题：Cyrene 没有「新开对话」事件，但会话上下文在换对话时会清零，
 * 长项目（gal / 小说）的进度只能靠记忆或手动翻旧对话恢复。
 *
 * 做法：
 *   1. 后台定时扫描若干根目录，找出所有 PROGRESS.md（默认 60 秒一次，不占用对话轮次）；
 *   2. 注册一个 prompt provider，在每轮对话开始时：
 *        - 用户这句话里出现了某个项目的 keywords → 注入该文件的全文；
 *        - 没命中且当前是 work / learn / code 模式 → 只注入一份简短索引；
 *        - 没命中且是 chat 模式 → 注入空字符串（不打扰闲聊）。
 *   3. 注册三个工具：查看已登记文件、把进度写回项目根目录、手动同步到版本库；
 *   4. PROGRESS.md 一旦变化（工具写入，或外部被改），自动 git add + commit 该文件；
 *      只有当所在仓库已配置上游分支（@{u}）时才 push —— 没有远程的仓库只做本地提交；
 *   5. 没有自己远程仓库的项目，还会把 PROGRESS.md 复制一份发布到「共享进度库」
 *      （默认 https://github.com/guchengyuri-gif/project，库内按项目名分文件夹）。
 *   6. 进度文件被工具写入、或被外部改动时，弹一个 Windows 桌面通知气泡
 *      （不占用对话轮次；可用配置关掉，见 DEFAULT_CONFIG 的 notify* 项）。
 *
 * Git 约定（与用户确认过，属于硬约束）：
 *   - 永远只提交 PROGRESS.md 这一个文件，绝不 add / commit 项目里的其他内容；
 *   - 没有远程上游的仓库不会往任何地方上传。
 *
 * 设计约束（来自插件规范）：
 *   - prompt provider 单项配额 2 秒 / 16000 字符 —— 所以扫描在后台做，provide() 只读内存缓存；
 *   - 工具 id 必须以 progress-inject_ 开头；
 *   - 定时器 / 后台任务用 ctx.onDispose 登记兜底清理，unregister() 可重复调用。
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

// 想换扫描范围，改这里即可（支持多个根目录）。
const DEFAULT_CONFIG = {
  roots: ["D:\\ai\\program"],
  fileName: "PROGRESS.md",
  // 扫描时按文件名 glob 匹配（大小写不敏感）。
  // 同一项目目录里可以有多个进度文件，例如 PROGRESS.md（主进度）+ PROGRESS_feishu.md（专题备忘）。
  // 注意：文件名只是「候选」；真正决定是否登记的是文件里有没有 `> keywords:` 行。
  filePatterns: ["PROGRESS.md", "PROGRESS_*.md", "PROGRESS-*.md"],
  maxDepth: 3,          // 相对根目录的最大下探层数
  refreshSeconds: 60,   // 后台重扫间隔
  maxIndexChars: 1500,  // 索引模式下最多注入多少字符
  maxFullChars: 6000,   // 单个项目全文模式最多注入多少字符
  maxProviderChars: 16000, // 整体上限（框架硬上限也是 16000）

  // —— Git 自动同步（只提交 PROGRESS.md 这一个文件）——
  gitEnabled: true,        // false = 只写文件，完全不碰版本库
  gitAutoSync: true,       // 后台扫描发现 PROGRESS.md 变化时自动提交
  gitSyncOnStart: true,    // 插件启动时把「尚未提交的进度」也同步一次
  gitPush: true,           // 仅对已配置上游分支（@{u}）的仓库生效
  gitTimeoutMs: 15000,     // 单条 git 命令超时
  gitPushTimeoutMs: 40000, // push 单独放宽（网络慢时更从容）
  gitCommitPrefix: "chore(progress): ",

  // —— 共享进度库：把「没有自己远程仓库」的项目进度统一发布到一个公共仓库 ——
  // 规则：有自己远程上游（@{u}）的项目仍回自己的仓库；其余项目把 PROGRESS.md 复制到
  //       <sharedDir>/<项目名>/PROGRESS.md 后提交并推送。只搬进度文件，不碰项目正文。
  sharedEnabled: true,
  sharedRepo: "https://github.com/guchengyuri-gif/project.git",
  sharedBranch: "main",
  sharedDir: "",            // 留空 = <roots[0]>/.progress-hub（点开头，扫描会自动跳过）
  sharedSkip: [],           // 需要排除的项目目录名（小写比较）
  sharedReadme: true,       // 在共享库根目录维护一份 README.md 总览
  sharedSlugs: {},          // 目录名 -> 共享库内的文件夹名（不配则自动推导）
  gitFallbackName: "ADMIN", // 仓库没有提交身份时的兜底（本机全局 git 身份是空的）
  gitFallbackEmail: "3465608670@qq.com",

  // —— 桌面通知：进度文件被写入 / 被改动时，弹一个 Windows 通知气泡 ——
  // 只认「已经见过、mtime 又变了」的文件；插件启动时的首次发现不算变化，不通知，
  // 否则每次开插件都会刷一串气泡。
  notifyEnabled: true,       // 总开关
  notifyOnWrite: true,       // progress-inject_write 成功写入后通知
  notifyOnChange: true,      // 后台扫描发现进度文件被（外部）改动时通知
  notifySound: false,        // 是否带提示音
  notifyMinIntervalMs: 4000, // 同一文件的冷却时间，避免「写入 + 扫描」双触发弹两次
};

// 扫描时跳过的目录名（小写比较）
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "build", "out", "output",
  "__pycache__", ".venv", "venv", "env", ".next", ".nuxt", ".cache",
  "cache", "code cache", "gpucache", "logs", "tmp", "temp", "temps",
  ".idea", ".vscode", "coverage", "target", "vendor", "templates",
]);

/* ------------------------------------------------------------------ */
/* 模块状态                                                            */
/* ------------------------------------------------------------------ */

let cfg = { ...DEFAULT_CONFIG };
let snapshot = { files: [], at: 0 }; // { files: ParsedFile[], at: number }
let timer = null;
let refreshing = null;
let stopped = false;
let hostCtx = null;

// Git 相关状态
let repoRootCache = new Map(); // 目录 -> 仓库根（只缓存命中结果，这样之后 git init 也能被识别）
let lastSeen = new Map();      // PROGRESS.md 绝对路径 -> mtimeMs
let gitTasks = new Map();      // PROGRESS.md 绝对路径 -> 正在进行的同步 Promise（并发调用复用同一个）
let hubChain = Promise.resolve(); // 共享库操作的串行队列：多个项目同时发布时避免抢 .git/index.lock

// 桌面通知状态
const notifyLast = new Map(); // PROGRESS.md 绝对路径 -> 上次弹通知的时间戳（冷却用）

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function log(message) {
  try {
    if (hostCtx) hostCtx.log("[progress-inject] " + message);
  } catch (_) { /* 日志失败不影响主流程 */ }
}

function clip(text, limit, tailRatio) {
  if (typeof text !== "string") return "";
  if (!Number.isFinite(limit) || limit <= 0) return text;
  if (text.length <= limit) return text;

  // tailRatio > 0 时改用「保头 + 保尾、只省略中间」。
  // PROGRESS.md 的「关键约定 / 待决」通常在文件尾部，从头一刀切会让最重要的约束先消失。
  const ratio =
    Number.isFinite(tailRatio) && tailRatio > 0 && tailRatio < 1 ? tailRatio : 0;
  if (ratio === 0) return text.slice(0, limit) + "\n…（已截断）";

  const RESERVE = 96; // 留给省略标记，保证结果不超过 limit
  const budget = Math.max(2, limit - RESERVE);
  const tailLen = Math.max(1, Math.floor(budget * ratio));
  const headLen = Math.max(1, budget - tailLen);
  const omitted = text.length - headLen - tailLen;
  const marker =
    `\n\n……（此处省略 ${omitted} 字符；需要完整内容时，请用 read_file 读取上面标注的文件路径）……\n\n`;
  return text.slice(0, headLen) + marker + text.slice(text.length - tailLen);
}

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function normalize(abs) {
  return path.resolve(abs).toLowerCase().replace(/[\\/]+$/, "");
}

function inRoots(abs) {
  const target = normalize(abs);
  return (cfg.roots || []).some((root) => {
    const r = normalize(root);
    return target === r || target.startsWith(r + path.sep);
  });
}

// 文件名 glob -> 正则（只支持 `*`，大小写不敏感）。
function globToRegExp(glob) {
  const s = String(glob).replace(/[.+?^${}()|[\]\\]/g, "\\$&"); // 转义元字符，* 单独处理
  return new RegExp("^" + s.replace(/\*/g, ".*") + "$", "i");
}

// 当前生效的文件名模式（未配置 filePatterns 时回落到 fileName，保持向后兼容）。
function progressPatterns() {
  const list =
    Array.isArray(cfg.filePatterns) && cfg.filePatterns.length
      ? cfg.filePatterns
      : [cfg.fileName || "PROGRESS.md"];
  return list.map(globToRegExp);
}

function isProgressName(name) {
  if (!name) return false;
  return progressPatterns().some((re) => re.test(name));
}

/* ------------------------------------------------------------------ */
/* 桌面通知（Windows Toast）                                           */
/* ------------------------------------------------------------------ */

/**
 * 为什么绕 PowerShell：插件的 ctx 只有 storage / 注册工具 / 注册 provider / onDispose，
 * 没有通知接口，所以借系统原生的 Toast 通道。
 *
 * 为什么用 -EncodedCommand 而不是 -File：PowerShell 5.1 会把「无 BOM 的 UTF-8 脚本文件」
 * 按 ANSI 读，脚本里的中文会直接读坏（第一次实测就是因此语法报错的）。把脚本编码成
 * UTF-16LE 的 base64 从命令行传进去，就完全绕开了文件编码这一环。
 */
function psEncode(script) {
  return Buffer.from(String(script), "utf16le").toString("base64");
}

// Toast 的 XML 正文里不能直接放 & < > " '，换行也要写成实体。
function xmlEscape(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r?\n/g, "&#10;");
}

function showToast(title, body) {
  const xml =
    '<toast duration="short"><visual><binding template="ToastGeneric">' +
    `<text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text>` +
    "</binding></visual>" +
    (cfg.notifySound
      ? '<audio src="ms-winsoundevent:Notification.Default" />'
      : '<audio silent="true" />') +
    "</toast>";

  // 整段脚本只用单引号包 XML；XML 里的单引号已被转义成 &apos;，所以不会打架。
  const script =
    "$ErrorActionPreference='Stop';" +
    "[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime];" +
    "[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime];" +
    "$xml=New-Object Windows.Data.Xml.Dom.XmlDocument;" +
    `$xml.LoadXml('${xml}');` +
    "$appId='com.cyrene.live2d';" +
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show(" +
    "[Windows.UI.Notifications.ToastNotification]::new($xml));";

  try {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        psEncode(script),
      ],
      { windowsHide: true, stdio: "ignore" }
    );
    child.on("error", (error) => log("桌面通知启动失败：" + (error && error.message)));
    if (typeof child.unref === "function") child.unref();
  } catch (error) {
    log("桌面通知异常：" + (error && error.message));
  }
}

// 从全文里取「## 一句话状态」下的第一段正文（与 parseProgress 同一套规则）。
function extractSummary(text) {
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s*一句话状态/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (!t) continue;
        if (t.startsWith("#")) break;
        return t.replace(/^[-*]\s*/, "");
      }
      break;
    }
  }
  return "";
}

/**
 * kind: "写入"（progress-inject_write 写的） / "扫描"（外部改动被后台扫描发现）
 * 通知本身永远不抛错 —— 弹不出来也不能影响写入和 git 同步。
 */
function notifyProgress(file, kind, summary) {
  try {
    if (!cfg.notifyEnabled) return;
    if (kind === "写入" ? !cfg.notifyOnWrite : !cfg.notifyOnChange) return;

    const key = normalize(file);
    const now = Date.now();
    const gap = Math.max(0, Number(cfg.notifyMinIntervalMs) || 0);
    if (gap && now - (notifyLast.get(key) || 0) < gap) return;
    notifyLast.set(key, now);

    const project = path.basename(path.dirname(file));
    const title = `昔涟 · 进度已更新（${kind}）`;
    const body = [project + " / " + path.basename(file), summary || "", fmtTime(now)]
      .filter(Boolean)
      .join("\n");
    showToast(title, body);
  } catch (error) {
    log("桌面通知异常：" + (error && error.message));
  }
}

/* ------------------------------------------------------------------ */
/* 解析 PROGRESS.md                                                    */
/* ------------------------------------------------------------------ */

function parseProgress(file, text, stat) {
  const dir = path.dirname(file);
  const dirName = path.basename(dir);
  const lines = text.split(/\r?\n/);

  let title = "";
  for (const line of lines) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) { title = m[1]; break; }
  }
  if (!title) title = dirName;

  // 只认带 `> keywords:` 行的文件 —— 这是「本项目约定的进度文件」的显式标记，
  // 用来排除目录里同名的无关文件（例如各类模板 progress.md）。
  const kwRaw = (/^>\s*keywords\s*[:：]\s*(.+)$/im.exec(text) || [])[1] || "";
  if (!kwRaw.trim()) return null;

  const status = ((/^>\s*状态\s*[:：]\s*(.+)$/im.exec(text) || [])[1] || "").trim();

  const keywords = Array.from(
    new Set(
      kwRaw.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean)
    )
  );
  if (!keywords.length) keywords.push(dirName); // 兜底：keywords 行为空时用目录名

  // 取「## 一句话状态」下的第一段正文（规则见 extractSummary）
  const summary = extractSummary(text);

  return {
    file,
    fileName: path.basename(file),
    dir,
    title,
    status,
    keywords,
    summary,
    body: text,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    updatedAt: fmtTime(stat.mtimeMs),
  };
}

/* ------------------------------------------------------------------ */
/* 扫描                                                                */
/* ------------------------------------------------------------------ */

async function scanAll() {
  const found = [];
  const seen = new Set();
  const maxDepth = Math.max(0, Math.min(8, cfg.maxDepth | 0));

  for (const root of cfg.roots || []) {
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (_) {
        continue; // 目录不存在 / 无权限，跳过
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth >= maxDepth) continue;
          const low = entry.name.toLowerCase();
          if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
          if (SKIP_DIRS.has(low)) continue;
          stack.push({ dir: full, depth: depth + 1 });
        } else if (entry.isFile() && isProgressName(entry.name)) {
          const key = normalize(full);
          if (!seen.has(key)) {
            seen.add(key);
            found.push(full);
          }
        }
      }
    }
  }

  const files = [];
  for (const file of found) {
    try {
      const [text, stat] = await Promise.all([
        fsp.readFile(file, "utf8"),
        fsp.stat(file),
      ]);
      const parsed = parseProgress(file, text, stat);
      if (parsed) files.push(parsed);
      else log("跳过（无 keywords 行）：" + file);
    } catch (error) {
      log("读取失败 " + file + " :: " + (error && error.message));
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

async function refresh(reason) {
  if (stopped) return;
  // 已有扫描在进行时直接复用同一个 Promise，这样调用方能确定性 await 到结果
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const files = await scanAll();
      const before = snapshot.files.map((f) => f.file).join("|");
      const after = files.map((f) => f.file).join("|");
      snapshot = { files, at: Date.now() };
      if (before !== after) {
        log(`进度文件清单更新（${reason}）：共 ${files.length} 个`);
      }
      trackChanges(files);
    } catch (error) {
      log("扫描异常（" + reason + "）：" + (error && error.message));
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/* ------------------------------------------------------------------ */
/* Git 同步                                                            */
/* ------------------------------------------------------------------ */

/**
 * 只做一件事：把某个 PROGRESS.md 从「工作区有改动」推进到「已提交」，
 * 并在仓库已配置上游分支时顺带 push。
 *
 * 为什么这么设计：
 *   - 只 add / commit 传入的这一个文件路径，项目里的其他内容一律不碰；
 *   - 没有 @{u}（上游分支）就不 push —— 没配远程的仓库不会往任何地方上传；
 *   - commit 信息走 stdin（-F -），避开 Windows 命令行参数的中文编码坑；
 *   - 单条命令都有超时，且 GIT_TERMINAL_PROMPT=0，避免凭据过期时弹出窗口卡死。
 */

function firstLine(text) {
  return String(text || "").trim().split(/\r?\n/).filter(Boolean)[0] || "";
}

function runGit(args, cwd, timeoutMs, input) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("git", args, {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "echo",
          GIT_OPTIONAL_LOCKS: "0",
        },
      });
    } catch (error) {
      resolve({ ok: false, code: -1, out: "", err: String((error && error.message) || error) });
      return;
    }

    let out = "";
    let err = "";
    let done = false;
    const limit = Math.max(2000, Number(timeoutMs) || 15000);
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch (_) { /* 杀不掉也不阻塞 */ }
      resolve({ ok: false, code: -1, out, err: err + "\n[命令超时，已终止]" });
    }, limit);

    child.stdout.on("data", (d) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", (e) => {
      finish({ ok: false, code: -1, out, err: err + String((e && e.message) || e) });
    });
    child.on("close", (code) => finish({ ok: code === 0, code, out, err }));

    try {
      if (input === undefined || input === null) child.stdin.end();
      else child.stdin.end(Buffer.from(String(input), "utf8"));
    } catch (_) { /* stdin 已关闭不影响结果 */ }
  });
}

async function findRepoRoot(dir) {
  const key = normalize(dir);
  if (repoRootCache.has(key)) return repoRootCache.get(key);
  const r = await runGit(["rev-parse", "--show-toplevel"], dir, cfg.gitTimeoutMs);
  if (!r.ok) return null;
  const root = String(r.out || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";
  if (!root) return null;
  repoRootCache.set(key, root); // 只缓存命中结果：之后对该目录 git init 仍能被识别
  return root;
}

function syncFile(file, reason) {
  if (!cfg.gitEnabled) return Promise.resolve("（git 同步已关闭）");

  const key = normalize(file);
  const inflight = gitTasks.get(key);
  // 同一文件已有同步在跑：复用同一个 Promise，调用方仍能拿到真实结果（而不是被跳过）
  if (inflight) return inflight;

  const task = runSync(file, reason).finally(() => {
    gitTasks.delete(key);
  });
  gitTasks.set(key, task);
  return task;
}

// 本地仓库同步（原逻辑，保持不动）：只把 PROGRESS.md 从「有改动」推进到「已提交」。
async function syncLocal(file, reason) {
  try {
    const root = await findRepoRoot(path.dirname(file));
    if (!root) return "（该目录不在 git 仓库内，只写了文件）";

    const rel = path.relative(root, file).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) return "（文件不在仓库范围内，跳过）";

    const st = await runGit(["status", "--porcelain", "--", rel], root, cfg.gitTimeoutMs);
    if (!st.ok) return `（git status 失败：${firstLine(st.err || st.out)}）`;
    if (!st.out.trim()) return "（版本库已是最新）";

    const add = await runGit(["add", "--", rel], root, cfg.gitTimeoutMs);
    if (!add.ok) return `（git add 失败：${firstLine(add.err || add.out)}）`;

    // git status 会因「racily clean」（文件 mtime 与索引项同秒）误报有改动。
    // add 之后再看暂存区：若与 HEAD 一致，就是真的没变化，不该报成 commit 失败。
    const staged = await runGit(["diff", "--cached", "--quiet", "--", rel], root, cfg.gitTimeoutMs);
    if (staged.ok) return "（版本库已是最新）";

    const message =
      (cfg.gitCommitPrefix || "chore(progress): ") +
      `更新 ${path.basename(path.dirname(file))} 项目进度（${reason}）`;
    const commit = await runGit(
      ["commit", "-F", "-", "--", rel],
      root,
      cfg.gitTimeoutMs,
      message + "\n"
    );
    if (!commit.ok) return `（git commit 失败：${firstLine(commit.err || commit.out)}）`;

    let pushNote = "";
    if (cfg.gitPush) {
      const up = await runGit(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        root,
        cfg.gitTimeoutMs
      );
      if (!up.ok || !up.out.trim()) {
        pushNote = "；该仓库没有远程上游，仅本地提交";
      } else {
        let ps = await runGit(["push"], root, cfg.gitPushTimeoutMs);
        if (!ps.ok) {
          // 兜底：仓库里可能残留指向已关闭代理的 http.proxy，绕过它再试一次
          ps = await runGit(
            ["-c", "http.proxy=", "-c", "https.proxy=", "push"],
            root,
            cfg.gitPushTimeoutMs
          );
          pushNote = ps.ok
            ? "；已推送（绕过失效代理）"
            : `；已提交到本地，但推送失败：${firstLine(ps.err || ps.out) || "未知错误"}`;
        } else {
          pushNote = "；已推送";
        }
      }
    }

    log(`已同步版本库：${rel} @ ${root}${pushNote}`);
    return `（已提交到版本库${pushNote}）`;
  } catch (error) {
    return `（同步异常：${(error && error.message) || error}）`;
  }
}

/**
 * 一轮同步 = 本地仓库提交（原有逻辑） + 共享进度库发布（新增）。
 * 两步互不影响：共享库出问题不会影响本地提交的结果，反之亦然。
 */
async function runSync(file, reason) {
  const parts = [];

  try {
    parts.push(await syncLocal(file, reason));
  } catch (error) {
    parts.push("（本地同步异常：" + ((error && error.message) || error) + "）");
  }

  try {
    const shared = await publishToShared(file, reason);
    if (shared) parts.push("共享库：" + shared);
  } catch (error) {
    parts.push("（共享库同步异常：" + ((error && error.message) || error) + "）");
  }

  return parts.join("；");
}

/* ------------------------------------------------------------------ */
/* 共享进度库                                                          */
/* ------------------------------------------------------------------ */

async function hasUpstream(root) {
  const up = await runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    root,
    cfg.gitTimeoutMs
  );
  return up.ok && !!up.out.trim();
}

// 目录名 -> 共享库里的文件夹名。
// 例如 "20260911-181500-大小姐的首席护卫绝不认输" -> "大小姐的首席护卫绝不认输"
// 因为输入来自 path.basename()，不会含 / 或 \，所以这里只清理 Windows 文件名非法字符。
function slugFor(dirName, fileName) {
  const raw = String(dirName || "").trim();
  const overrides = cfg.sharedSlugs || {};
  for (const key of Object.keys(overrides)) {
    if (key.toLowerCase() === raw.toLowerCase()) return String(overrides[key]);
  }

  let s = raw;
  const stamped = /^\d{8}[-_]\d{6}[-_](.+)$/.exec(s);
  if (stamped) s = stamped[1];
  s = s.replace(/[:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/^[-.]+|[-.]+$/g, "");

  // 同一目录里有多个进度文件时，再拼上文件名后缀，避免它们在共享库里互相覆盖。
  // 规范名（PROGRESS.md）保持原来的目录名规则，旧链接不会失效。
  const canonical = String(cfg.fileName || "PROGRESS.md").toLowerCase();
  const base = String(fileName || "").trim();
  if (base && base.toLowerCase() !== canonical) {
    const stem = base.replace(/\.md$/i, "").replace(/^progress[-_]?/i, "").trim();
    if (stem) s = (s ? s + "-" : "") + stem;
  }
  return s || "project";
}

// 共享库的本地镜像目录。默认放在扫描根目录下的 .progress-hub ——
// 点开头，扫描器会自动跳过，不会把镜像里的 PROGRESS.md 又当成一个项目。
function hubDirPath() {
  const custom = String(cfg.sharedDir || "").trim();
  if (custom) return path.resolve(custom);
  const base = (cfg.roots && cfg.roots[0]) || process.cwd();
  return path.join(base, ".progress-hub");
}

// 本机全局 git 身份是空的，所以共享库优先沿用来源项目仓库里的身份配置。
async function ensureHubIdentity(dir, sourceRoot) {
  const cur = await runGit(["config", "user.name"], dir, cfg.gitTimeoutMs);
  if (cur.ok && cur.out.trim()) return;

  let name = "";
  let email = "";
  if (sourceRoot) {
    const n = await runGit(["config", "user.name"], sourceRoot, cfg.gitTimeoutMs);
    const e = await runGit(["config", "user.email"], sourceRoot, cfg.gitTimeoutMs);
    name = n.ok ? n.out.trim() : "";
    email = e.ok ? e.out.trim() : "";
  }
  if (!name) name = cfg.gitFallbackName || "ADMIN";
  if (!email) email = cfg.gitFallbackEmail || "ADMIN@localhost";

  await runGit(["config", "user.name", name], dir, cfg.gitTimeoutMs);
  await runGit(["config", "user.email", email], dir, cfg.gitTimeoutMs);
  log(`共享库提交身份：${name} <${email}>`);
}

/** 确保共享库的本地镜像存在、远程指向配置、并停在目标分支上。 */
async function ensureHub(sourceRoot) {
  const dir = hubDirPath();
  const branch = cfg.sharedBranch || "main";
  const url = String(cfg.sharedRepo || "").trim();

  try {
    if (!fs.existsSync(path.join(dir, ".git"))) {
      await fsp.mkdir(dir, { recursive: true });
      const init = await runGit(["init", "-b", branch], dir, cfg.gitTimeoutMs);
      if (!init.ok) {
        await runGit(["init"], dir, cfg.gitTimeoutMs);
        await runGit(["symbolic-ref", "HEAD", "refs/heads/" + branch], dir, cfg.gitTimeoutMs);
      }
      const add = await runGit(["remote", "add", "origin", url], dir, cfg.gitTimeoutMs);
      if (!add.ok) return { ok: false, dir, note: "配置远程失败：" + firstLine(add.err || add.out) };
    } else {
      const cur = await runGit(["remote", "get-url", "origin"], dir, cfg.gitTimeoutMs);
      if (!cur.ok) await runGit(["remote", "add", "origin", url], dir, cfg.gitTimeoutMs);
      else if (cur.out.trim() !== url) {
        await runGit(["remote", "set-url", "origin", url], dir, cfg.gitTimeoutMs);
      }
    }

    await ensureHubIdentity(dir, sourceRoot);

    const fetched = await runGit(["fetch", "origin", "--prune"], dir, cfg.gitPushTimeoutMs);
    const remoteRef = await runGit(
      ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + branch],
      dir,
      cfg.gitTimeoutMs
    );
    const hasRemote = fetched.ok && remoteRef.ok;

    const head = await runGit(["symbolic-ref", "--short", "-q", "HEAD"], dir, cfg.gitTimeoutMs);
    if (!(head.ok && head.out.trim() === branch)) {
      let co = await runGit(["checkout", branch], dir, cfg.gitTimeoutMs);
      if (!co.ok && hasRemote) {
        co = await runGit(
          ["checkout", "-b", branch, "--track", "origin/" + branch],
          dir,
          cfg.gitTimeoutMs
        );
      }
      if (!co.ok) co = await runGit(["checkout", "-b", branch], dir, cfg.gitTimeoutMs);
      if (!co.ok) return { ok: false, dir, note: "切换分支失败：" + firstLine(co.err || co.out) };
    }

    if (hasRemote) {
      // 失败不阻断：可能是首次推送或网络抖动，真正的成败判断交给后面的 push
      await runGit(["pull", "--rebase", "--autostash", "origin", branch], dir, cfg.gitPushTimeoutMs);
    }
    return { ok: true, dir, note: "" };
  } catch (error) {
    return { ok: false, dir, note: (error && error.message) || String(error) };
  }
}

async function pushHub(dir) {
  const branch = cfg.sharedBranch || "main";
  let r = await runGit(["push", "-u", "origin", branch], dir, cfg.gitPushTimeoutMs);
  if (r.ok) return { ok: true, note: "" };

  const firstErr = firstLine(r.err || r.out);

  // 兜底一：仓库里可能残留指向已关闭代理的 http.proxy
  r = await runGit(
    ["-c", "http.proxy=", "-c", "https.proxy=", "push", "-u", "origin", branch],
    dir,
    cfg.gitPushTimeoutMs
  );
  if (r.ok) return { ok: true, note: "（绕过失效代理）" };

  // 兜底二：远端可能被别处推过，先 rebase 再试一次
  await runGit(["pull", "--rebase", "--autostash", "origin", branch], dir, cfg.gitPushTimeoutMs);
  r = await runGit(["push", "-u", "origin", branch], dir, cfg.gitPushTimeoutMs);
  if (r.ok) return { ok: true, note: "（先 rebase 后推送）" };

  return { ok: false, err: firstErr + " / " + firstLine(r.err || r.out) };
}

/** 在共享库根目录维护一份总览 README（只有进度摘要，没有项目正文）。 */
async function writeHubReadme(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }

  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    // 一个目录里可能同时有 PROGRESS.md 和 PROGRESS_xxx.md，逐个都收。
    let names = [];
    try {
      names = (await fsp.readdir(path.join(dir, entry.name))).filter((n) => isProgressName(n));
    } catch (_) {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, entry.name, name);
      try {
        const [text, stat] = await Promise.all([fsp.readFile(file, "utf8"), fsp.stat(file)]);
        const parsed = parseProgress(file, text, stat);
        if (parsed) rows.push(parsed);
      } catch (_) { /* 读不到就跳过这一个 */ }
    }
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const lines = [
    "# 项目进度总览",
    "",
    "> 本仓库由 Cyrene 的 progress-inject 插件自动维护。",
    "> 只收录各项目的进度活文档（`PROGRESS.md` / `PROGRESS_*.md`），不含任何项目正文、素材或代码。",
    "",
    `最后更新：${fmtTime(Date.now())}`,
    "",
  ];

  if (!rows.length) {
    lines.push("（暂无已发布的进度文件）");
  } else {
    for (const f of rows) {
      const slug = path.basename(path.dirname(f.file));
      lines.push(`## ${f.title}`, "");
      if (f.status) lines.push(`- 状态：${f.status}`);
      lines.push(`- 一句话：${f.summary || "(未填写)"}`);
      const rel = `${slug}/${f.fileName}`;
      lines.push(`- 文件：[${rel}](${encodeURI(slug)}/${encodeURI(f.fileName)})`);
      lines.push(`- 项目最后更新：${f.updatedAt}`);
      lines.push("");
    }
  }

  await fsp.writeFile(path.join(dir, "README.md"), lines.join("\n"), "utf8");
}

// 多个项目同时发布时串行执行，避免在同一份 .git 里抢 index.lock
function withHubLock(fn) {
  const run = hubChain.then(fn, fn);
  hubChain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * 把 PROGRESS.md 发布到共享进度库。
 * 规则：有自己远程仓库的项目跳过（它回自己的仓库）；其余项目复制到 <项目名>/PROGRESS.md。
 * 只搬这一个文件（外加自动生成的 README.md 总览），项目正文 / 素材一律不碰。
 */
async function publishToShared(file, reason) {
  if (!cfg.sharedEnabled) return "";
  if (!String(cfg.sharedRepo || "").trim()) return "";

  const projectDir = path.dirname(file);
  const dirKey = path.basename(projectDir).toLowerCase();
  if ((cfg.sharedSkip || []).some((s) => String(s).toLowerCase() === dirKey)) {
    return "跳过（已在配置里排除）";
  }

  const ownRoot = await findRepoRoot(projectDir);
  if (ownRoot && (await hasUpstream(ownRoot))) {
    return "跳过（该项目有自己的远程仓库）";
  }

  return withHubLock(async () => {
    const hub = await ensureHub(ownRoot || projectDir);
    if (!hub.ok) return "发布失败：" + hub.note;

    const baseName = path.basename(file);
    const slug = slugFor(path.basename(projectDir), baseName);
    const destDir = path.join(hub.dir, slug);
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.copyFile(file, path.join(destDir, baseName));

    if (cfg.sharedReadme) await writeHubReadme(hub.dir);

    const rel = slug + "/" + baseName;
    const paths = cfg.sharedReadme ? [rel, "README.md"] : [rel];

    const st = await runGit(["status", "--porcelain", "--", ...paths], hub.dir, cfg.gitTimeoutMs);
    if (!st.ok) return "发布失败：" + firstLine(st.err || st.out);
    if (!st.out.trim()) return `已是最新（${rel}）`;

    const add = await runGit(["add", "--", ...paths], hub.dir, cfg.gitTimeoutMs);
    if (!add.ok) return "发布失败：" + firstLine(add.err || add.out);

    const message =
      (cfg.gitCommitPrefix || "chore(progress): ") + `同步 ${slug} 项目进度（${reason}）`;
    const commit = await runGit(
      ["commit", "-F", "-", "--", ...paths],
      hub.dir,
      cfg.gitTimeoutMs,
      message + "\n"
    );
    if (!commit.ok) return "发布失败：" + firstLine(commit.err || commit.out);

    const pushed = await pushHub(hub.dir);
    if (!pushed.ok) return `已提交到共享库本地，但推送失败：${pushed.err || "未知错误"}`;

    log(`已发布共享库：${rel} -> ${cfg.sharedRepo}`);
    return `已发布（${rel}）${pushed.note}`;
  });
}

// 由后台扫描调用：只对「新增或 mtime 变化」的文件触发同步，平时不产生任何 git 调用。
function trackChanges(files) {
  for (const f of files) {
    const key = normalize(f.file);
    const prev = lastSeen.get(key);
    lastSeen.set(key, f.mtimeMs);
    if (prev === f.mtimeMs) continue;

    // 桌面通知：只报「已经见过、mtime 又变了」的文件。
    // prev === undefined 表示这是插件启动后的首次发现，不算「变化」，不打扰。
    if (prev !== undefined) notifyProgress(f.file, "扫描", f.summary);

    if (!cfg.gitAutoSync) continue;
    if (prev === undefined && !cfg.gitSyncOnStart) continue;
    void syncFile(f.file, prev === undefined ? "启动时同步" : "检测到进度变化");
  }
}

/* ------------------------------------------------------------------ */
/* 提示词 Provider                                                     */
/* ------------------------------------------------------------------ */

function buildMatched(matched) {
  let out =
    "【项目进度文件 · 自动注入】以下是磁盘上真实存在的项目进度记录（比记忆更新，若与记忆数字冲突，以这些文件为准）：\n";
  // 命中多个项目时按数量平均分配配额，避免靠前的文件把靠后的整个挤没。
  // 单文件命中时仍以 maxFullChars 封顶；超限走「保头 + 保尾」。
  const count = Math.max(1, matched.length);
  const gap = 400; // 头部说明 + 余量
  const perFile = Math.min(
    cfg.maxFullChars,
    Math.max(1200, Math.floor((cfg.maxProviderChars - gap) / count))
  );
  for (const f of matched) {
    const meta =
      `\n===== ${f.title}${f.status ? "（" + f.status + "）" : ""} =====\n` +
      `文件：${f.file}\n最后更新：${f.updatedAt}\n\n`;
    const budget = Math.max(600, perFile - meta.length);
    out += meta + clip(f.body, budget, 0.4) + "\n";
  }
  return out;
}

function buildIndex(files) {
  let out =
    "【项目进度索引 · 自动注入】磁盘上已登记以下项目进度文件（本轮未命中关键词，因此只给索引，未展开正文）：\n";
  for (const f of files) {
    out +=
      `- ${f.title}${f.status ? "（" + f.status + "）" : ""}：` +
      `${f.summary || "(未填写一句话状态)"}｜更新 ${f.updatedAt}｜${f.file}\n`;
  }
  return clip(out, cfg.maxIndexChars);
}

function provideProgress({ source, mode, userText, signal }) {
  try {
    if (signal && signal.aborted) return "";
    if (source && source !== "conversation") return "";
    const files = snapshot.files;
    if (!files || !files.length) return "";

    const text = String(userText || "");
    const matched = text
      ? files.filter((f) => f.keywords.some((k) => k && text.includes(k)))
      : [];

    if (matched.length) return buildMatched(matched);
    if (mode === "chat") return ""; // 闲聊不打扰
    return buildIndex(files);
  } catch (error) {
    log("provide 异常：" + (error && error.message));
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const listTool = {
  id: "progress-inject_list",
  name: "查看已登记的项目进度文件",
  description:
    "列出当前自动扫描到的所有项目进度文件（PROGRESS.md）。当用户问「有哪些项目进度文件」「进度注入生效了吗」「进度文件在哪」，或需要确认某个项目的进度文件路径与关键词时使用。会顺带刷新一次磁盘缓存。",
  risk: "safe",
  effectKind: "read",
  inputSchema: { type: "object", properties: {}, required: [] },
  async execute() {
    await refresh("工具调用");
    const lines = [];
    lines.push(`扫描根目录：${(cfg.roots || []).join("；")}`);
    lines.push(
      `文件名模式：${(cfg.filePatterns || [cfg.fileName]).join(" / ")}｜最大深度：${cfg.maxDepth}｜刷新间隔：${cfg.refreshSeconds}s`
    );
    lines.push(
      `缓存时间：${snapshot.at ? fmtTime(snapshot.at) : "尚未刷新"}｜已发现 ${snapshot.files.length} 个文件`
    );
    if (cfg.sharedEnabled && String(cfg.sharedRepo || "").trim()) {
      lines.push(
        `共享进度库：${cfg.sharedRepo}（分支 ${cfg.sharedBranch || "main"}）｜本地镜像：${hubDirPath()}`
      );
      lines.push(
        "发布规则：有自己远程仓库的项目留在原处；其余项目把进度文件复制到共享库的 <项目名>/ 目录"
      );
    } else {
      lines.push("共享进度库：未启用");
    }
    if (!snapshot.files.length) {
      lines.push("");
      lines.push("（没扫到任何 PROGRESS.md。若刚创建，稍等几秒重新调用一次；若路径不在上面，需要改插件里的 roots 配置。）");
      return lines.join("\n");
    }
    snapshot.files.forEach((f, i) => {
      lines.push("");
      lines.push(`${i + 1}. ${f.title}`);
      lines.push(`   路径：${f.file}`);
      lines.push(`   更新：${f.updatedAt}${f.status ? "｜状态：" + f.status : ""}`);
      lines.push(`   关键词：${f.keywords.join("、")}`);
      lines.push(`   一句话状态：${f.summary || "(未填写)"}`);
    });
    return lines.join("\n");
  },
};

const writeTool = {
  id: "progress-inject_write",
  name: "更新项目进度文件",
  description:
    "把一个项目的进度写入该项目的进度文件（PROGRESS.md 或 PROGRESS_*.md；整文件覆盖，覆盖前自动备份为同名 .bak）。当用户说「存个档」「更新一下进度」，或一段工作告一段落、需要把进度固化下来以免新对话断片时使用。参数 project 传项目名（可用 progress-inject_list 查）或进度文件的绝对路径；content 传完整 Markdown 全文，务必保留 `> keywords:` 行以便后续自动匹配。",
  risk: "write",
  effectKind: "write",
  inputSchema: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description:
          "项目名（匹配已有进度文件所在目录名 / 文件名 / 标题），或进度文件的绝对路径",
      },
      content: {
        type: "string",
        description: "完整 Markdown 全文，需包含 `> keywords: ...` 行",
      },
    },
    required: ["project", "content"],
  },
  async execute(args) {
    const project = String((args && args.project) || "").trim();
    const content = String((args && args.content) || "");
    if (!project) throw new Error("project 不能为空");
    if (!content.trim()) throw new Error("content 不能为空，且必须是完整全文（本工具是整文件覆盖）");
    if (content.length > 200000) throw new Error("content 过长（>200000 字符）");
    if (!/^>\s*keywords\s*[:：]/im.test(content)) {
      throw new Error("content 里缺少 `> keywords: ...` 行，补上之后才能被自动匹配");
    }

    let target = null;

    if (/[\\/]/.test(project) || /\.md$/i.test(project)) {
      const abs = path.resolve(project);
      if (!isProgressName(path.basename(abs))) {
        throw new Error("只允许写入进度文件（PROGRESS.md / PROGRESS_*.md）：" + abs);
      }
      if (!inRoots(abs)) throw new Error("路径不在允许的扫描根目录内：" + abs);
      target = abs;
    } else {
      if (!snapshot.files.length) await refresh("写入前");
      const key = project.toLowerCase();
      const hit = snapshot.files.find(
        (f) =>
          path.basename(f.dir).toLowerCase() === key ||
          String(f.fileName || "").toLowerCase() === key ||
          String(f.fileName || "").replace(/\.md$/i, "").toLowerCase() === key ||
          f.title.toLowerCase() === key ||
          f.title.toLowerCase().includes(key)
      );
      if (!hit) {
        throw new Error(
          "没找到名为「" + project + "」的项目进度文件。可以先调用 progress-inject_list 看有哪些，或直接传绝对路径。"
        );
      }
      target = hit.file;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });

    let backup = null;
    try {
      if (fs.existsSync(target)) {
        backup = target + ".bak";
        await fsp.copyFile(target, backup);
      }
    } catch (_) {
      backup = null; // 备份失败不阻断写入
    }

    await fsp.writeFile(target, content, "utf8");
    const bytes = Buffer.byteLength(content, "utf8");
    notifyProgress(target, "写入", extractSummary(content));
    try {
      const stat = await fsp.stat(target);
      // 先登记 mtime，让紧随其后的 refresh 不会把这次写入当成「外部改动」重复提交
      lastSeen.set(normalize(target), stat.mtimeMs);
    } catch (_) { /* 取不到 mtime 不影响写入结果 */ }
    const gitNote = await syncFile(target, "工具写入");
    void refresh("写入后");

    return (
      `已写入 ${target}（${bytes} 字节，${content.split(/\r?\n/).length} 行）` +
      (backup ? `；原文件已备份到 ${backup}` : "；原本没有文件，属新建") +
      (gitNote ? `\n版本库：${gitNote}` : "")
    );
  },
};

/* ------------------------------------------------------------------ */
/* 手动同步工具                                                        */
/* ------------------------------------------------------------------ */

const syncTool = {
  id: "progress-inject_sync",
  name: "把项目进度同步到版本库",
  description:
    "立即把某个项目的进度文件（PROGRESS.md / PROGRESS_*.md）提交到它所在的 git 仓库；有远程上游（@{u}）时推送，没有自己远程仓库的项目还会另外发布到共享进度库（默认 github.com/guchengyuri-gif/project，库内按项目名分文件夹）。当用户说「把进度推上去」「同步到版本库」「提交一下进度」时使用。只会提交进度文件本身（共享库另加一份自动生成的 README 总览），不会碰项目里的其他内容。参数 project 可选，不传则处理所有已登记项目。",
  risk: "write",
  effectKind: "write",
  inputSchema: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "项目名或 PROGRESS.md 的绝对路径；留空表示处理所有已登记项目",
      },
    },
    required: [],
  },
  async execute(args) {
    const project = String((args && args.project) || "").trim();
    await refresh("同步前");

    let targets = snapshot.files;
    if (project) {
      const key = project.toLowerCase();
      targets = targets.filter(
        (f) =>
          normalize(f.file) === normalize(project) ||
          path.basename(f.dir).toLowerCase() === key ||
          f.title.toLowerCase().includes(key)
      );
      if (!targets.length) {
        throw new Error("没找到匹配「" + project + "」的进度文件，可先调用 progress-inject_list");
      }
    }
    if (!targets.length) return "当前没有已登记的进度文件。";

    const lines = [];
    for (const f of targets) {
      const note = await syncFile(f.file, "手动同步");
      lines.push(`${f.title}：${note}`);
    }
    return lines.join("\n");
  },
};

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

module.exports = {
  async register(ctx) {
    hostCtx = ctx;
    stopped = false;

    try {
      const saved = await ctx.storage.get("config");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        cfg = { ...DEFAULT_CONFIG, ...saved };
      } else {
        cfg = { ...DEFAULT_CONFIG };
      }
    } catch (_) {
      cfg = { ...DEFAULT_CONFIG };
    }

    ctx.registerPromptProvider({
      id: "progress",
      sources: ["conversation"],
      provide: provideProgress,
    });

    ctx.registerTool(listTool);
    ctx.registerTool(writeTool);
    ctx.registerTool(syncTool);

    const intervalMs = Math.max(15, Number(cfg.refreshSeconds) || 60) * 1000;
    timer = setInterval(() => {
      void refresh("定时");
    }, intervalMs);
    ctx.onDispose(() => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });

    log(
      "已启用，扫描根目录：" + (cfg.roots || []).join("；") +
        `，每 ${intervalMs / 1000}s 刷新，git 自动同步：` +
        (cfg.gitEnabled ? (cfg.gitPush ? "开（有上游则推送）" : "开（仅本地提交）") : "关") +
        "，桌面通知：" + (cfg.notifyEnabled ? "开" : "关")
    );
    void refresh("启动");
  },

  async unregister() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    hostCtx = null;
    snapshot = { files: [], at: 0 };
    repoRootCache.clear();
    lastSeen.clear();
    gitTasks.clear();
    notifyLast.clear();
    log("已停用");
  },
};
