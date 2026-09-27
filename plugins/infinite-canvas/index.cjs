"use strict";

/**
 * Infinite Canvas — Cyrene 插件
 * 1) 在 Cyrene 内开一个窗口承载「无限画布」创作站
 * 2) 把 ZikL 的生图 / 改图能力注册成昔涟可调用的工具
 */

const path = require("node:path");
const fsp = require("node:fs/promises");
const os = require("node:os");

const CANVAS_URL = "https://canvas.zikl.dev";

const DEFAULTS = {
  baseUrl: "https://img.mzfe.de/v1",
  apiKey: "",
  outputDir: "",
  timeoutMs: 240000,
};

let win = null;

/* ---------------- 基础工具函数 ---------------- */

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    String(d.getFullYear()) +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

function extFromMime(mime) {
  if (/jpe?g/i.test(mime || "")) return ".jpg";
  if (/webp/i.test(mime || "")) return ".webp";
  if (/gif/i.test(mime || "")) return ".gif";
  return ".png";
}

async function getCfg(ctx) {
  let saved = {};
  try {
    if (ctx && ctx.storage) {
      const v = await Promise.resolve(ctx.storage.get("config"));
      if (v && typeof v === "object") saved = v;
    }
  } catch (_) {
    /* 读不到就用默认值 */
  }
  return Object.assign({}, DEFAULTS, saved);
}

async function saveCfg(ctx, patch) {
  const next = Object.assign({}, await getCfg(ctx), patch || {});
  if (ctx && ctx.storage) await Promise.resolve(ctx.storage.set("config", next));
  return next;
}

function defaultOutDir() {
  try {
    const { app } = require("electron");
    if (app && typeof app.getPath === "function") {
      return path.join(app.getPath("desktop"), "无限画布出图");
    }
  } catch (_) {
    /* 不在 Electron 环境 */
  }
  return path.join(os.homedir(), "Desktop", "无限画布出图");
}

async function resolveOutDir(cfg, override) {
  const dir = (override && String(override).trim()) || cfg.outputDir || defaultOutDir();
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function requireKey(cfg) {
  if (!cfg.apiKey || !String(cfg.apiKey).trim()) {
    throw new Error(
      "还没有配置 API Key。请先调用 infinite-canvas_config（action=set, patch={\"apiKey\":\"sk-...\"}）写入密钥。"
    );
  }
}

async function callApi(cfg, urlPath, init) {
  if (typeof fetch !== "function") {
    throw new Error("当前运行环境没有全局 fetch，无法调用接口");
  }
  const base = String(cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "");
  const url = base + urlPath;
  const timeoutMs = Math.max(5000, Number(cfg.timeoutMs) || DEFAULTS.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = Object.assign(
    { Authorization: "Bearer " + cfg.apiKey },
    (init && init.headers) || {}
  );
  try {
    const res = await fetch(url, Object.assign({}, init, { headers, signal: controller.signal }));
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      /* 非 JSON */
    }
    if (!res.ok) {
      const detail =
        json && json.error
          ? json.error.message || json.error.code || JSON.stringify(json.error)
          : text.slice(0, 300);
      throw new Error("HTTP " + res.status + "：" + detail);
    }
    if (json === null) throw new Error("接口返回的不是 JSON：" + text.slice(0, 200));
    return json;
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error("请求超时（上限 " + Math.round(timeoutMs / 1000) + " 秒）");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function loadImageBuffer(src) {
  const s = String(src == null ? "" : src).trim();
  if (!s) throw new Error("image 参数不能为空");

  if (/^data:/i.test(s)) {
    const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(s);
    if (!m) throw new Error("无法解析 data URL");
    const mime = m[1] || "image/png";
    const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
    return { buffer: buf, mime, name: "input" + extFromMime(mime) };
  }

  if (/^https?:\/\//i.test(s)) {
    const r = await fetch(s);
    if (!r.ok) throw new Error("下载参考图失败：HTTP " + r.status);
    const mime = (r.headers.get("content-type") || "image/png").split(";")[0].trim();
    return {
      buffer: Buffer.from(await r.arrayBuffer()),
      mime,
      name: "input" + extFromMime(mime),
    };
  }

  const buf = await fsp.readFile(s);
  const ext = path.extname(s).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
      ? "image/webp"
      : ext === ".gif"
      ? "image/gif"
      : "image/png";
  return { buffer: buf, mime, name: path.basename(s) || "input" + extFromMime(mime) };
}

async function persistImages(data, dir, prefix) {
  const items = Array.isArray(data) ? data : [];
  const saved = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const name = prefix + "-" + String(i + 1).padStart(2, "0") + ".png";
    const file = path.join(dir, name);
    if (item.b64_json) {
      await fsp.writeFile(file, Buffer.from(item.b64_json, "base64"));
      saved.push(file);
    } else if (item.url) {
      const r = await fetch(item.url);
      if (!r.ok) throw new Error("下载生成结果失败：HTTP " + r.status);
      await fsp.writeFile(file, Buffer.from(await r.arrayBuffer()));
      saved.push(file);
    }
  }
  return saved;
}

/* ---------------- 窗口 ---------------- */

async function openWindow() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  const { BrowserWindow } = require("electron");
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: "无限画布",
    backgroundColor: "#17121d",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  });
  win.on("closed", () => {
    win = null;
  });
  await win.loadFile(path.join(__dirname, "ui.html"));
}

function closeWindow() {
  if (win && !win.isDestroyed()) win.close();
  win = null;
}

/* ---------------- 注册 ---------------- */

module.exports = {
  async register(ctx) {
    /* --- 工具：列出模型 --- */
    ctx.registerTool({
      id: "infinite-canvas_models",
      name: "无限画布可用模型",
      description:
        "列出「无限画布」(ZikL) 生图接口当前可用的模型。用户问「无限画布支持哪些模型」「生图能用什么模型」时使用。无需参数。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const cfg = await getCfg(ctx);
        requireKey(cfg);
        const json = await callApi(cfg, "/models", { method: "GET" });
        const list = Array.isArray(json.data) ? json.data : [];
        const ids = list.map((m) => (typeof m === "string" ? m : m && m.id)).filter(Boolean);
        return "无限画布接口当前可用模型（共 " + ids.length + " 个）：\n" + ids.join("\n");
      },
    });

    /* --- 工具：查额度 --- */
    ctx.registerTool({
      id: "infinite-canvas_balance",
      name: "无限画布额度",
      description:
        "查询「无限画布」(ZikL) 生图接口的账户额度 / 订阅状态。用户问「生图还剩多少额度」「无限画布还有钱吗」时使用。无需参数。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const cfg = await getCfg(ctx);
        requireKey(cfg);
        const json = await callApi(cfg, "/dashboard/billing/subscription", { method: "GET" });
        const soft = json.soft_limit_usd;
        const hard = json.hard_limit_usd;
        const usable = json.has_payment_method ? "已绑定支付方式" : "未绑定支付方式";
        return (
          "无限画布接口账户状态：\n" +
          "- " +
          usable +
          "\n" +
          "- 软限额(USD)：" +
          soft +
          "\n" +
          "- 硬限额(USD)：" +
          hard +
          "\n（该站点没有 /usage 明细端点，无法查单次消费）"
        );
      },
    });

    /* --- 工具：文生图 --- */
    ctx.registerTool({
      id: "infinite-canvas_generate",
      name: "无限画布生图",
      description:
        "用「无限画布」(ZikL) 接口文生图。用户要求画图/生图/出图，并指定用无限画布或 ZikL 接口时使用。prompt 必填（画面描述，中英文均可）；model 可选，默认 gpt-image-2.5-sunburst；size 可选 1024x1024 / 1024x1536 / 1536x1024 / auto；quality 可选 low/medium/high/auto；n 可选 1-4；out 可选输出目录。图片会保存到本地并返回完整路径（单张约 1.5MB，耗时 30~90 秒属正常）。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "画面描述，中英文均可" },
          model: {
            type: "string",
            description:
              "模型名，默认 gpt-image-2.5-sunburst；快速可用 gpt-image-2.5-flare；旧版 gpt-image-2",
          },
          size: {
            type: "string",
            description: "图片尺寸：1024x1024（默认）/ 1024x1536（竖版）/ 1536x1024（横版）/ auto",
          },
          quality: { type: "string", description: "生成质量：low / medium / high / auto（默认 auto）" },
          n: { type: "number", description: "生成张数 1-4，默认 1" },
          out: { type: "string", description: "输出目录绝对路径，缺省存到桌面「无限画布出图」" },
        },
        required: ["prompt"],
      },
      async execute(args) {
        const a = args || {};
        const prompt = String(a.prompt || "").trim();
        if (!prompt) throw new Error("prompt 不能为空");
        const cfg = await getCfg(ctx);
        requireKey(cfg);

        const body = {
          model: a.model || "gpt-image-2.5-sunburst",
          prompt,
          n: Math.min(4, Math.max(1, Number(a.n) || 1)),
        };
        if (a.size) body.size = a.size;
        if (a.quality) body.quality = a.quality;

        const json = await callApi(cfg, "/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const dir = await resolveOutDir(cfg, a.out);
        const saved = await persistImages(json.data, dir, "ic-" + stamp());
        if (!saved.length) throw new Error("接口返回成功，但没有拿到图片数据");

        return (
          "生图完成（模型 " +
          body.model +
          "，共 " +
          saved.length +
          " 张）：\n" +
          saved.join("\n") +
          "\n可以直接用 read_image 查看效果。"
        );
      },
    });

    /* --- 工具：改图 / 图生图 --- */
    ctx.registerTool({
      id: "infinite-canvas_edit",
      name: "无限画布改图",
      description:
        "用「无限画布」(ZikL) 接口做图生图 / 改图。最适合保持角色一致性的立绘差分、换背景、换服装、改表情。image 必填：本地图片绝对路径或 http(s) 图片 URL；prompt 必填，建议明确写「保持角色不变，只改 XXX」；可选 mask（PNG 遮罩，透明区域允许重绘）、model（默认 gpt-image-2.5-sunburst）、size、n。结果保存到本地并返回路径，耗时 40~90 秒属正常。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "参考图：本地绝对路径或 http(s) 图片 URL" },
          prompt: { type: "string", description: "编辑指令，如「保持角色完全不变，只把背景换成黄昏海面」" },
          mask: { type: "string", description: "可选遮罩 PNG 路径：透明区域允许重绘，不透明区域保持原样" },
          model: { type: "string", description: "模型名，默认 gpt-image-2.5-sunburst" },
          size: { type: "string", description: "输出尺寸：1024x1024（默认）/ 1024x1536 / 1536x1024 / auto" },
          quality: { type: "string", description: "质量：low / medium / high / auto（默认 auto）" },
          n: { type: "number", description: "生成张数 1-4，默认 1" },
          out: { type: "string", description: "输出目录绝对路径，缺省存到桌面「无限画布出图」" },
        },
        required: ["image", "prompt"],
      },
      async execute(args) {
        const a = args || {};
        const prompt = String(a.prompt || "").trim();
        if (!prompt) throw new Error("prompt 不能为空");
        if (typeof FormData !== "function" || typeof Blob !== "function") {
          throw new Error("当前运行环境缺少 FormData/Blob，无法上传参考图");
        }
        const cfg = await getCfg(ctx);
        requireKey(cfg);

        const img = await loadImageBuffer(a.image);
        const form = new FormData();
        form.append("model", a.model || "gpt-image-2.5-sunburst");
        form.append("prompt", prompt);
        form.append("n", String(Math.min(4, Math.max(1, Number(a.n) || 1))));
        if (a.size) form.append("size", a.size);
        if (a.quality) form.append("quality", a.quality);
        form.append("image", new Blob([img.buffer], { type: img.mime }), img.name);
        if (a.mask) {
          const mk = await loadImageBuffer(a.mask);
          form.append("mask", new Blob([mk.buffer], { type: mk.mime }), mk.name);
        }

        const json = await callApi(cfg, "/images/edits", { method: "POST", body: form });

        const dir = await resolveOutDir(cfg, a.out);
        const saved = await persistImages(json.data, dir, "ic-edit-" + stamp());
        if (!saved.length) throw new Error("接口返回成功，但没有拿到图片数据");

        return "改图完成（共 " + saved.length + " 张）：\n" + saved.join("\n");
      },
    });

    /* --- 工具：配置 --- */
    ctx.registerTool({
      id: "infinite-canvas_config",
      name: "无限画布配置",
      description:
        "查看或修改「无限画布」插件的接口配置（baseUrl / apiKey / 输出目录 / 超时）。用户说「配置无限画布」「设置 ZikL 的 key」「无限画布的接口地址是什么」时使用。action=get 只读返回当前配置（apiKey 打码）；action=set 写入 patch 里给出的字段。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: "get=读取当前配置；set=写入" },
          patch: {
            type: "object",
            description:
              "要写入的字段：baseUrl（如 https://img.mzfe.de/v1）、apiKey、outputDir、timeoutMs",
          },
        },
        required: ["action"],
      },
      async execute(args) {
        const a = args || {};
        const action = String(a.action || "get").toLowerCase();
        if (action === "set") {
          const patch = Object.assign({}, a.patch || {});
          if (Object.prototype.hasOwnProperty.call(patch, "timeoutMs")) {
            patch.timeoutMs = Math.max(5000, Number(patch.timeoutMs) || DEFAULTS.timeoutMs);
          }
          const next = await saveCfg(ctx, patch);
          return "配置已更新：\n" + renderCfg(next);
        }
        return "当前配置：\n" + renderCfg(await getCfg(ctx));
      },
    });

    /* --- 工具：打开窗口 --- */
    ctx.registerTool({
      id: "infinite-canvas_open",
      name: "打开无限画布",
      description:
        "打开「无限画布」窗口（在 Cyrene 内直接承载 canvas.zikl.dev 创作站）。用户说「打开无限画布」「打开画布」时使用。无需参数。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        await openWindow();
        return "无限画布窗口已经打开啦♪（若窗口没出现，可能被最小化或挡在后面，再让我开一次即可）";
      },
    });

    /* --- IPC（供本地 UI 调用） --- */
    ctx.registerIpc("status", async () => {
      const cfg = await getCfg(ctx);
      let modelCount = null;
      try {
        const json = await callApi(cfg, "/models", { method: "GET" });
        modelCount = Array.isArray(json.data) ? json.data.length : null;
      } catch (_) {
        modelCount = null;
      }
      return {
        baseUrl: cfg.baseUrl,
        hasKey: !!cfg.apiKey,
        modelCount,
        outputDir: cfg.outputDir || defaultOutDir(),
        canvasUrl: CANVAS_URL,
      };
    });

    ctx.registerIpc("get-config", async () => {
      const cfg = await getCfg(ctx);
      return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, outputDir: cfg.outputDir, timeoutMs: cfg.timeoutMs };
    });

    ctx.registerIpc("save-config", async (_e, patch) => {
      const next = await saveCfg(ctx, patch || {});
      return { ok: true, baseUrl: next.baseUrl, hasKey: !!next.apiKey };
    });

    ctx.registerIpc("open-external", async (_e, url) => {
      const { shell } = require("electron");
      await shell.openExternal(String(url || CANVAS_URL));
      return { ok: true };
    });

    ctx.registerIpc("open-tool-window", async () => {
      await openWindow();
      return { ok: true };
    });

    /* --- 清理托管 --- */
    ctx.onDispose(() => {
      closeWindow();
    });

    ctx.log("无限画布插件已就绪");
  },

  async unregister() {
    closeWindow();
  },

  async open() {
    await openWindow();
  },
};

function renderCfg(cfg) {
  const key = cfg.apiKey ? String(cfg.apiKey).slice(0, 7) + "…" + String(cfg.apiKey).slice(-4) : "（未设置）";
  return (
    "- baseUrl：" +
    cfg.baseUrl +
    "\n- apiKey：" +
    key +
    "\n- 输出目录：" +
    (cfg.outputDir || defaultOutDir() + "（默认）") +
    "\n- 超时：" +
    cfg.timeoutMs +
    " ms"
  );
}
