"use strict";
// 通用 MCP (stdio) 桥接插件 —— 由 build-plugins.cjs 生成，请勿手工修改本文件
// register(): 拉起 mcp-config.json 指定的底层 MCP 进程 → initialize → tools/list → 注册为 Cyrene 工具
// execute(): 经 JSON-RPC tools/call 原样转发并回传文本结果
// unregister() / onDispose: 杀掉底层子进程树，把内存还给系统
const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");

const CFG_PATH = path.join(__dirname, "mcp-config.json");
const PLUGIN_ID = "mcp-skills-gateway";
const PROTOCOL_VERSION = "2024-11-05";

function loadConfig() {
  return JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
}

function hasKey(cfg, key) {
  return Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key] != null;
}

// Windows 下把裸命令名（node / npx / openclaw-mcp）解析成真实可执行文件，
// 尽量避免无谓地经过 shell 启动，方便后续按进程树回收。
function resolveCommand(rawCmd) {
  const cmd = String(rawCmd || "");
  if (!cmd || process.platform !== "win32") return { file: cmd, useShell: false };
  if (/[\\/]/.test(cmd) || /\.[a-z0-9]+$/i.test(cmd)) {
    return { file: cmd, useShell: /\.(cmd|bat)$/i.test(cmd) };
  }
  const exts = [];
  const fromPathExt = String(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";");
  for (const e of [".exe"].concat(fromPathExt)) {
    const low = String(e || "").toLowerCase();
    if (low && exts.indexOf(low) === -1) exts.push(low);
  }
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const ext of exts) {
    for (const dir of dirs) {
      const cand = path.join(dir, cmd + ext);
      try {
        if (fs.existsSync(cand)) return { file: cand, useShell: /\.(cmd|bat)$/i.test(cand) };
      } catch (e) {
        /* ignore */
      }
    }
  }
  return { file: cmd, useShell: true };
}

// Windows 命令行参数转义（CommandLineToArgvW 规则），处理带空格的路径
function winQuote(s) {
  s = String(s);
  if (s === "") return '\"\"';
  if (!/[\s\"]/.test(s)) return s;
  let out = '\"';
  let bs = 0;
  for (const ch of s) {
    if (ch === "\\") {
      bs++;
      out += ch;
    } else if (ch === '\"') {
      out += "\\".repeat(bs + 1) + '\"';
      bs = 0;
    } else {
      out += ch;
      bs = 0;
    }
  }
  out += "\\".repeat(bs) + '\"';
  return out;
}

function extractText(result) {
  if (!result) return "";
  if (Array.isArray(result.content)) {
    return result.content
      .map((c) => (c && c.type === "text" ? c.text : c ? JSON.stringify(c) : ""))
      .join("\n");
  }
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

class McpClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.child = null;
    this.rl = null;
    this.pending = new Map();
    this.nextId = 1;
    this.serverInfo = null;
    this.stopped = false;
  }

  start() {
    const resolved = resolveCommand(this.cfg.command);
    const opts = { stdio: ["pipe", "pipe", "pipe"], windowsHide: true };
    if (hasKey(this.cfg, "cwd")) opts.cwd = this.cfg.cwd;
    if (hasKey(this.cfg, "env")) opts.env = Object.assign({}, process.env, this.cfg.env);

    // .cmd/.bat（如 npx）不能直接 spawn，路径常含空格，且 Node 会二次转义引号。
    // 做法：自己拼好命令行，再用 windowsVerbatimArguments 让 Node 原样透传给 cmd.exe。
    let file = resolved.file;
    let args = (this.cfg.args || []).slice();
    if (resolved.useShell) {
      const comspec = process.env.ComSpec || "cmd.exe";
      const line = [winQuote(file)].concat(args.map(winQuote)).join(" ");
      file = comspec;
      // /s 会剥掉首尾引号，所以整条命令再包一层引号（cmd 标准做法）
      args = ["/d", "/s", "/c", '"' + line + '"'];
      opts.windowsVerbatimArguments = true;
    }

    this.child = spawn(file, args, opts);

    this.child.stderr.on("data", (d) => {
      const s = String(d).trim();
      if (s) process.stderr.write("[" + PLUGIN_ID + "] " + s + "\n");
    });

    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        return;
      }
      if (msg && msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "MCP 调用失败"));
        else p.resolve(msg.result);
      }
    });

    const failAll = (err) => {
      for (const p of Array.from(this.pending.values())) p.reject(err);
      this.pending.clear();
    };
    this.child.on("error", failAll);
    this.child.on("exit", () => {
      if (!this.stopped) failAll(new Error("MCP 底层进程已退出"));
    });

    return this.call("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: "cyrene-mcp-bridge", version: "1.0.0" },
    }).then((res) => {
      this.serverInfo = (res && res.serverInfo) || {};
      try {
        this.child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
        );
      } catch (e) {
        /* ignore */
      }
      return this.serverInfo;
    });
  }

  call(method, params) {
    if (!this.child || !this.child.stdin || !this.child.stdin.writable) {
      return Promise.reject(new Error("MCP 底层进程未就绪"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  async listTools() {
    const res = await this.call("tools/list", {});
    return (res && res.tools) || [];
  }

  async callTool(name, args) {
    const res = await this.call("tools/call", { name, arguments: args || {} });
    const text = extractText(res);
    if (res && res.isError) throw new Error(text || "工具 " + name + " 执行失败");
    return text;
  }

  stop() {
    this.stopped = true;
    const child = this.child;
    this.child = null;
    if (this.rl) {
      try {
        this.rl.close();
      } catch (e) {
        /* ignore */
      }
      this.rl = null;
    }
    this.pending.clear();
    if (!child) return;
    try {
      if (process.platform === "win32" && child.pid) {
        // /T 连子孙进程一起收，避免 npx / python venv 之类留下孤儿进程占内存
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill();
      }
    } catch (e) {
      try {
        child.kill();
      } catch (e2) {
        /* ignore */
      }
    }
  }
}

let client = null;

module.exports = {
  async register(ctx) {
    const cfg = loadConfig();
    const c = new McpClient(cfg);
    let tools = [];
    try {
      await c.start();
      tools = await c.listTools();
    } catch (err) {
      c.stop();
      ctx.log("[" + PLUGIN_ID + "] 启动失败：" + err.message);
      throw new Error("无法连接底层 MCP 服务（" + cfg.command + "）：" + err.message);
    }
    client = c;

    for (const t of tools) {
      const toolId = PLUGIN_ID + "_" + t.name;
      ctx.registerTool({
        id: toolId,
        name: t.title || t.name,
        description: t.description || "转发调用 MCP 工具 " + t.name,
        enabled: true,
        risk: "safe",
        // MCP 工具副作用未知，统一按 write 走权限门控，更保守
        effectKind: "write",
        inputSchema:
          t.inputSchema && t.inputSchema.type === "object"
            ? t.inputSchema
            : { type: "object", properties: {}, required: [] },
        async execute(args) {
          if (!client) throw new Error("插件已停用");
          return await client.callTool(t.name, args || {});
        },
      });
    }

    ctx.onDispose(() => {
      if (client) {
        client.stop();
        client = null;
      }
    });

    ctx.log(
      "[" +
        PLUGIN_ID +
        "] 桥接就绪：" +
        (c.serverInfo && c.serverInfo.name ? c.serverInfo.name : cfg.name) +
        "，工具 " +
        tools.length +
        " 个"
    );
  },

  async unregister() {
    if (client) {
      client.stop();
      client = null;
    }
  },
};
