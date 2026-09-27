"use strict";

/**
 * DSH 协作桥 · Cyrene 插件
 *
 * 让昔涟能与本机的 DSH Desktop 协作，三条能力：
 *   1. 观测  —— 读 DSH 的运行状态（进程、connector、本地端点、插件清单）
 *   2. 指令  —— 通过官方 anywhere-cli 的 JSON-RPC 控制面操作 connector
 *   3. 通信  —— 共享信箱（文件系统），两个 agent 双向留言
 *
 * 设计约束：
 *   - 不逆向 DSH 的私有端点（127.0.0.1:13206），只使用官方 CLI 与公开文件
 *   - 不改 DSH 任何配置；本插件只读 DSH 侧文件
 *   - 所有子进程设超时并做失败降级，不让单个探测拖垮一轮对话
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PLUGIN_ID = "dsh-bridge";

/* ---------- 路径常量 ---------- */

const HOME = os.homedir();
const DSH_HOME = path.join(HOME, ".dsh");
const BRIDGE_DIR = path.join(HOME, ".agentsanywhere", "dsh-bridge-next");
const CLI_PATH = path.join(BRIDGE_DIR, "connector-venv", "Scripts", "anywhere-cli.exe");
const CONNECTOR_CONFIG = path.join(BRIDGE_DIR, "connector", "connector.json");
const ENDPOINT_PATH = path.join(DSH_HOME, "agents-anywhere", "bridge", "endpoint.json");
const PROFILE_PACKAGE = path.join(DSH_HOME, "profiles", "desktop", "package.json");
const DSH_EXE = "C:\\Program Files\\DSH Desktop\\DSH Desktop.exe";

const MAILBOX_ROOT = "D:\\ai\\program\\dsh-bridge\\mailbox";
const INBOX_DIR = path.join(MAILBOX_ROOT, "to-cyrene");
const OUTBOX_DIR = path.join(MAILBOX_ROOT, "to-dsh");
const ARCHIVE_DIR = path.join(MAILBOX_ROOT, "archive");
const STATE_PATH = path.join(MAILBOX_ROOT, ".state.json");

/* ---------- 小工具 ---------- */

function existsSync(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function nowText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function clip(text, max = 60000) {
  const s = String(text == null ? "" : text);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…（已截断，共 ${s.length} 字符）`;
}

/** UTF-8 优先解码，出现替换字符时回退 GBK（Windows 控制台常见） */
function decodeBuffer(buf) {
  let text = buf.toString("utf8");
  if (text.includes("\uFFFD")) {
    try {
      text = new TextDecoder("gbk").decode(buf);
    } catch {
      /* 保留 utf8 结果 */
    }
  }
  return text;
}

/** 执行一个子进程，永不抛错：失败/超时都降级为结构化结果 */
function runProcess(file, args, options = {}) {
  const { input = null, timeoutMs = 15000 } = options;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { windowsHide: true });
    } catch (error) {
      resolve({ ok: false, code: null, timedOut: false, stdout: "", stderr: String((error && error.message) || error) });
      return;
    }

    const outChunks = [];
    const errChunks = [];
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* 已经退出 */
      }
    }, timeoutMs);

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    child.stdout.on("data", (chunk) => outChunks.push(chunk));
    child.stderr.on("data", (chunk) => errChunks.push(chunk));
    child.on("error", (error) => {
      finish({
        ok: false,
        code: null,
        timedOut,
        stdout: decodeBuffer(Buffer.concat(outChunks)),
        stderr: String((error && error.message) || error),
      });
    });
    child.on("close", (code) => {
      finish({
        ok: code === 0 && !timedOut,
        code,
        timedOut,
        stdout: decodeBuffer(Buffer.concat(outChunks)),
        stderr: decodeBuffer(Buffer.concat(errChunks)),
      });
    });

    try {
      if (input != null) {
        child.stdin.write(input);
      }
      child.stdin.end();
    } catch {
      /* stdin 不可用不影响结果读取 */
    }
  });
}

/* ---------- anywhere-cli JSON-RPC ---------- */

const RPC_METHODS = {
  state: "connector.getState",
  paths: "connector.getPaths",
  config: "connector.getConfig",
  start: "connector.start",
  stop: "connector.stop",
  restart: "connector.restart",
};

async function rpcCall(method, timeoutMs = 25000) {
  if (!existsSync(CLI_PATH)) {
    return { ok: false, error: `找不到 anywhere-cli：${CLI_PATH}` };
  }
  const request = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method })}\n`;
  const run = await runProcess(CLI_PATH, ["rpc", "--config", CONNECTOR_CONFIG], { input: request, timeoutMs });

  let result = null;
  let rpcError = null;
  for (const line of run.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message && message.id === 1) {
      if (message.error) rpcError = message.error;
      else result = message.result;
    }
  }

  if (rpcError) return { ok: false, error: `${rpcError.code}: ${rpcError.message}`, data: rpcError.data };
  if (result === null) {
    const detail = run.timedOut ? "调用超时" : run.stderr.trim() || "未收到应答";
    return { ok: false, error: detail };
  }
  return { ok: true, result };
}

/* ---------- 进程与 DSH 侧探测 ---------- */

async function listProcesses() {
  const run = await runProcess("tasklist", ["/FO", "CSV", "/NH"], { timeoutMs: 12000 });
  if (!run.ok) return [];
  const rows = [];
  for (const line of run.stdout.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw.startsWith('"')) continue;
    const parts = raw.split('","').map((s) => s.replace(/^"|"$/g, "").trim());
    if (parts.length >= 5) rows.push({ name: parts[0], pid: parts[1], mem: parts[4] });
  }
  return rows;
}

function readEndpoint() {
  try {
    const raw = fs.readFileSync(ENDPOINT_PATH, "utf8");
    const data = JSON.parse(raw);
    return {
      host: data.host,
      port: data.port,
      pid: data.pid,
      hasToken: Boolean(data.token),
    };
  } catch {
    return null;
  }
}

function readBundles() {
  try {
    const raw = fs.readFileSync(PROFILE_PACKAGE, "utf8");
    const data = JSON.parse(raw);
    const bundles = data && data.dsh && data.dsh.profile && data.dsh.profile.bundles;
    return Array.isArray(bundles) ? bundles : [];
  } catch {
    return [];
  }
}

async function listInboxFiles() {
  try {
    await ensureMailbox();
    const entries = await fsp.readdir(INBOX_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * 已读状态（只记「读过」，不搬文件）。
 * 文件在不在收件箱由目录实况决定；状态文件坏了也不影响读信本身。
 */
async function readState() {
  try {
    const raw = await fsp.readFile(STATE_PATH, "utf8");
    const data = JSON.parse(raw);
    const read = data && Array.isArray(data.read) ? data.read.filter((n) => typeof n === "string") : [];
    return { read: new Set(read) };
  } catch {
    return { read: new Set() };
  }
}

async function writeState(state) {
  const payload = { read: Array.from(state.read).sort(), updatedAt: nowText() };
  await fsp.writeFile(STATE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** 收件箱实况：未读 / 已读未归档 / 总数 */
async function countInbox() {
  const files = await listInboxFiles();
  const state = await readState();
  const unread = files.filter((n) => !state.read.has(n));
  const pending = files.filter((n) => state.read.has(n));
  return {
    count: unread.length,
    names: unread,
    total: files.length,
    readPending: pending.length,
    readPendingNames: pending,
  };
}

/* ---------- 信箱 ---------- */

async function ensureMailbox() {
  for (const dir of [MAILBOX_ROOT, INBOX_DIR, OUTBOX_DIR, ARCHIVE_DIR]) {
    await fsp.mkdir(dir, { recursive: true });
  }
}

function parseMessage(raw, fallbackName) {
  const meta = {};
  let body = raw;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    body = raw.slice(match[0].length);
  }
  /* headerMissing：围栏首尾不成对（或完全缺失）时为 true。
     此时 meta 必然为空，from/time/topic 全丢，调用方应显式报警。 */
  return { meta, body: body.trim(), file: fallbackName, headerMissing: !match };
}

/**
 * 只读收件箱：**永不移动文件**。
 * markRead=true 时把本次读到的文件登记为「已读」（写 .state.json，信本身不动）。
 * 归档是独立动作，见 archiveInbox。
 */
async function readInbox(limit, markRead, onlyUnread) {
  const files = await listInboxFiles();
  if (files.length === 0) {
    return { total: 0, unread: 0, readPending: 0, shown: 0, messages: [], marked: 0, markError: null };
  }

  const state = await readState();
  const pool = onlyUnread ? files.filter((n) => !state.read.has(n)) : files;
  const picked = pool.slice(-limit);
  const messages = [];
  const newlyMarked = [];

  for (const name of picked) {
    const full = path.join(INBOX_DIR, name);
    try {
      const raw = await fsp.readFile(full, "utf8");
      messages.push({ ...parseMessage(raw, name), state: state.read.has(name) ? "read" : "new" });
      if (markRead && !state.read.has(name)) {
        state.read.add(name);
        newlyMarked.push(name);
      }
    } catch (error) {
      /* 只有「读文件本身失败」才报读取失败；归档的失败不应被误报成读信失败 */
      messages.push({
        meta: {},
        body: `（读取失败：${String((error && error.message) || error)}）`,
        file: name,
        state: "error",
      });
    }
  }

  let markError = null;
  if (newlyMarked.length > 0) {
    try {
      await writeState(state);
    } catch (error) {
      markError = String((error && error.message) || error);
    }
  }

  /* 统计以磁盘实况为准，避免内存改动造成虚报 */
  const truth = markError ? await readState() : state;
  const readCount = files.filter((n) => truth.read.has(n)).length;

  return {
    total: files.length,
    unread: files.length - readCount,
    readPending: readCount,
    shown: messages.length,
    messages,
    marked: markError ? 0 : newlyMarked.length,
    markError,
  };
}

/**
 * 把收件箱里的信件移入 archive（真正的归档动作）。
 * names 为空时默认归档「所有已读」的信；逐条返回真实结果，失败不掩盖。
 */
async function archiveInbox(names) {
  const files = await listInboxFiles();
  const state = await readState();
  const wanted = names && names.length ? names : files.filter((n) => state.read.has(n));
  const targets = wanted.filter((n) => files.includes(n));

  const moved = [];
  const failed = [];

  for (const name of targets) {
    const src = path.join(INBOX_DIR, name);
    let dest = path.join(ARCHIVE_DIR, name);
    try {
      if (existsSync(dest)) {
        /* Windows 的 rename 不覆盖已存在文件：撞名就换一个带序号的名字 */
        dest = path.join(ARCHIVE_DIR, `${name.replace(/\.md$/, "")}-dup${stamp()}.md`);
      }
      await fsp.rename(src, dest);
      state.read.delete(name);
      moved.push(name);
    } catch (error) {
      failed.push({ name, error: String((error && error.message) || error) });
    }
  }

  if (moved.length > 0) {
    try {
      await writeState(state);
    } catch {
      /* 状态文件写失败不回滚已迁移的文件；下次按目录实况重算 */
    }
  }

  return { moved, failed, remaining: files.length - moved.length };
}

/* ---------- 插件入口 ---------- */

module.exports = {
  async register(ctx) {
    await ensureMailbox();

    /* 1. 状态观测 */
    ctx.registerTool({
      id: `${PLUGIN_ID}_status`,
      name: "DSH 运行状态",
      description:
        "查看本机 DSH Desktop 的运行状态：进程是否在跑、agents-anywhere 连接器状态、本地端点、已装插件清单、信箱未读条数。用户问『DSH 在干什么』『DSH 开着吗』『和 DSH 的桥通不通』『DSH 装了哪些插件』时使用。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          withConnector: {
            type: "boolean",
            description: "是否额外查询 connector 运行时状态（会启动一次 anywhere-cli，约 1-3 秒）。默认 true。",
          },
        },
        required: [],
      },
      async execute(args) {
        const withConnector = args && args.withConnector !== false;
        const lines = [];

        lines.push("## 桥组件");
        lines.push(`- anywhere-cli：${existsSync(CLI_PATH) ? "✓" : "✗ 缺失"}  ${CLI_PATH}`);
        lines.push(`- connector 配置：${existsSync(CONNECTOR_CONFIG) ? "✓" : "✗ 缺失"}  ${CONNECTOR_CONFIG}`);
        lines.push(`- DSH 主程序：${existsSync(DSH_EXE) ? "✓" : "✗ 缺失"}  ${DSH_EXE}`);

        const endpoint = readEndpoint();
        lines.push(
          endpoint
            ? `- 本地端点：✓ ${endpoint.host}:${endpoint.port}（pid ${endpoint.pid}${endpoint.hasToken ? "，带 token" : ""}）`
            : "- 本地端点：✗ 未找到 endpoint.json（DSH 可能没在运行）"
        );

        lines.push("");
        lines.push("## 进程");
        const processes = await listProcesses();
        if (processes.length === 0) {
          lines.push("- （无法读取进程列表）");
        } else {
          const desktop = processes.filter((p) => p.name.toLowerCase().startsWith("dsh desktop"));
          const node = processes.filter((p) => /^node\.exe$/i.test(p.name));
          lines.push(
            desktop.length
              ? desktop.map((p) => `- DSH Desktop.exe：运行中（pid ${p.pid}，内存 ${p.mem}）`).join("\n")
              : "- DSH Desktop.exe：未运行"
          );
          if (endpoint && endpoint.pid) {
            const bridgeProc = processes.find((p) => p.pid === String(endpoint.pid));
            lines.push(
              bridgeProc
                ? `- 桥进程（pid ${endpoint.pid}）：运行中（${bridgeProc.name}）`
                : `- 桥进程（pid ${endpoint.pid}）：未在运行`
            );
          }
          lines.push(`- node 进程数：${node.length}`);
        }

        const bundles = readBundles();
        lines.push("");
        lines.push("## DSH 已装插件（profile: desktop）");
        lines.push(bundles.length ? bundles.map((b) => `- ${b}`).join("\n") : "- （读不到插件清单）");

        const inbox = await countInbox();
        lines.push("");
        lines.push("## 信箱");
        lines.push(`- to-cyrene：未读 ${inbox.count} 条 / 已读未归档 ${inbox.readPending} 条 / 共 ${inbox.total} 条`);
        if (inbox.count > 0) lines.push(`  最近未读：${inbox.names.slice(-3).join("、")}`);
        if (inbox.readPending > 0) lines.push(`  待归档：${inbox.readPendingNames.slice(-3).join("、")}`);

        if (withConnector) {
          lines.push("");
          lines.push("## 连接器运行时（connector.getState）");
          const state = await rpcCall("connector.getState");
          if (state.ok) {
            const s = state.result || {};
            lines.push(`- 状态：${s.status}（running=${s.running}，paring=${s.pairing}）`);
            if (s.lastError) lines.push(`- 最近错误：${s.lastError}`);
            if (s.authFailed) lines.push("- 凭据已失效");
          } else {
            lines.push(`- 查询失败：${state.error}`);
          }
        }

        return lines.join("\n");
      },
    });

    /* 2. connector 控制 */
    ctx.registerTool({
      id: `${PLUGIN_ID}_connector`,
      name: "操作 DSH 连接器",
      description:
        "操作 DSH 的 agents-anywhere 连接器：查询状态/路径/配置，或启动、停止、重启连接器。用户明确要求『重启 DSH 的桥』『停掉 DSH 连接器』『看看 DSH 连接器配置』时使用。start/stop/restart 会真实影响 DSH 与云端的连接，执行前应确认用户意图。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["state", "paths", "config", "start", "stop", "restart"],
            description: "要执行的动作。state=状态，paths=路径，config=配置（密钥打码），start/stop/restart=启停连接器。",
          },
        },
        required: ["action"],
      },
      async execute(args) {
        const action = args && args.action;
        const method = RPC_METHODS[action];
        if (!method) {
          return `不支持的动作：${action}（可选 ${Object.keys(RPC_METHODS).join(" / ")}）`;
        }

        const call = await rpcCall(method);
        if (!call.ok) return `调用失败：${call.error}`;

        let payload = call.result;
        if (action === "config" && payload && typeof payload === "object") {
          payload = { ...payload };
          if (payload.connectorToken) payload.connectorToken = "（已打码）";
        }

        return `${method} →\n\`\`\`json\n${clip(JSON.stringify(payload, null, 2), 20000)}\n\`\`\``;
      },
    });

    /* 3. 发消息给 DSH */
    ctx.registerTool({
      id: `${PLUGIN_ID}_send`,
      name: "给 DSH 留言",
      description:
        "把一条消息写入与 DSH 共享的信箱（to-dsh 目录），DSH 读到后即可接续处理。用户要求『告诉 DSH……』『把这个任务交给 DSH』『给 DSH 留言』『让 DSH 接手』时使用。message 写正文，topic 可写一句话主题。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "要留给 DSH 的正文内容" },
          topic: { type: "string", description: "可选，一句话主题，便于 DSH 快速判断" },
        },
        required: ["message"],
      },
      async execute(args) {
        const message = (args && args.message) || "";
        if (!message.trim()) return "留言内容为空，没有写入。";

        await ensureMailbox();
        const name = `${stamp()}-from-cyrene.md`;
        const full = path.join(OUTBOX_DIR, name);
        const header = [
          "---",
          "from: cyrene",
          "to: dsh",
          `time: ${nowText()}`,
          args && args.topic ? `topic: ${String(args.topic).replace(/\r?\n/g, " ")}` : null,
          "---",
          "",
        ]
          .filter((v) => v !== null)
          .join("\n");

        await fsp.writeFile(full, `${header}${message.trim()}\n`, "utf8");
        return `已写入信箱：${full}\nDSH 侧读取该文件即可收到这条留言（读到后请告知用户，让 DSH 查收）。`;
      },
    });

    /* 4. 读 DSH 的留言 */
    ctx.registerTool({
      id: `${PLUGIN_ID}_inbox`,
      name: "收 DSH 的留言",
      description:
        "读取 DSH 留在共享信箱（to-cyrene 目录）里的消息。用户说『DSH 说什么了』『看看 DSH 的留言』『有没有新消息』时使用。本工具只读，永不移动或删除信件；读过的只标记为「已读未归档」，真正归档请另用 dsh-bridge_archive。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "最多读取几条，默认 10" },
          markRead: { type: "boolean", description: "是否把本次读到的消息标记为已读（只写状态文件，不动信件），默认 true" },
          onlyUnread: { type: "boolean", description: "只读未读的消息，默认 false" },
        },
        required: [],
      },
      async execute(args) {
        const limit = Number.isFinite(args && args.limit) ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 10;
        const markRead = !(args && args.markRead === false);
        const onlyUnread = Boolean(args && args.onlyUnread);

        const data = await readInbox(limit, markRead, onlyUnread);
        if (data.total === 0) return "信箱里暂时没有 DSH 留下的消息。";

        const parts = [
          `信箱：共 ${data.total} 条，未读 ${data.unread} 条，本次显示 ${data.shown} 条` +
            (markRead ? `，本次新标记已读 ${data.marked} 条` : "（未标记已读）"),
          "本次未移动任何文件；处理完并回过信后，用 dsh-bridge_archive 显式归档。",
        ];
        if (data.markError) parts.push(`⚠️ 已读标记写入失败：${data.markError}`);
        for (const msg of data.messages) {
          const from = msg.meta.from || "未知";
          const time = msg.meta.time || "时间未标注";
          const topic = msg.meta.topic ? `｜${msg.meta.topic}` : "";
          const flag = msg.state === "new" ? "🆕 未读" : msg.state === "read" ? "已读未归档" : "读取异常";
          const headWarn = msg.headerMissing
            ? "\n⚠️ 头部围栏缺失或不成对（应为首尾各一行 `---`）——发件人/时间/主题已丢失，只能按文件名判断"
            : "";
          parts.push(`\n---\n【${msg.file}】[${flag}] 来自 ${from}，${time}${topic}${headWarn}\n${clip(msg.body, 8000)}`);
        }
        return parts.join("\n");
      },
    });

    /* 5. 归档：显式把处理完的信件移入 archive */
    ctx.registerTool({
      id: `${PLUGIN_ID}_archive`,
      name: "归档 DSH 信件",
      description:
        "把收件箱（to-cyrene）里已经处理完的信件移入 archive 目录。不传 files 时默认归档『所有已读』的消息；也可传 files 指定文件名，或用 all=true 归档收件箱全部。这是不可逆的移动操作，确认处理完再调用。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: { type: "string" },
            description: "要归档的文件名列表（不含路径），可选",
          },
          all: { type: "boolean", description: "true=归档收件箱全部信件（含未读），默认 false" },
        },
        required: [],
      },
      async execute(args) {
        const files = Array.isArray(args && args.files) ? args.files.filter((f) => typeof f === "string") : [];
        const all = Boolean(args && args.all);
        const list = all ? await listInboxFiles() : files;

        if (!all && list.length === 0) {
          const state = await readState();
          const pending = (await listInboxFiles()).filter((n) => state.read.has(n));
          if (pending.length === 0) {
            return "没有「已读未归档」的信件可归档。（若想连未读一起归档，传 all=true）";
          }
        }

        const result = await archiveInbox(list);
        const lines = [`已归档 ${result.moved.length} 条 → ${ARCHIVE_DIR}`];
        if (result.moved.length) lines.push(result.moved.map((n) => `- ${n}`).join("\n"));
        if (result.failed.length) {
          lines.push(`⚠️ ${result.failed.length} 条归档失败：`);
          lines.push(result.failed.map((f) => `- ${f.name}：${f.error}`).join("\n"));
        }
        lines.push(`收件箱剩余 ${result.remaining} 条。`);
        return lines.join("\n");
      },
    });

    /* 6. 动态上下文：有新留言时主动提醒 */
    ctx.registerPromptProvider({
      id: "inbox-hint",
      modes: ["chat", "work", "code", "learn"],
      async provide({ signal }) {
        if (signal && signal.aborted) return "";
        const inbox = await countInbox();
        const bits = [];
        if (inbox.count > 0) bits.push(`${inbox.count} 条未读留言（用 dsh-bridge_inbox 读取）`);
        if (inbox.readPending > 0) bits.push(`${inbox.readPending} 条已读未归档（处理完后用 dsh-bridge_archive 归档）`);
        if (bits.length === 0) return "";
        return `【DSH 协作桥】信箱 to-cyrene：${bits.join("；")}。`;
      },
    });

    ctx.log(`DSH 协作桥已启用（信箱：${MAILBOX_ROOT}）`);
  },

  async unregister() {
    /* 本插件无常驻资源：不持有窗口、定时器或后台子进程 */
  },
};
