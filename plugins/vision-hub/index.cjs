"use strict";

const fs = require("fs");
const path = require("path");

const PLUGIN_ID = "vision-hub";
const MAX_IMAGE_MB = 20;

// 用于 health 检查的极小 1x1 白色 PNG（base64）
const HEALTH_TEST_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// ---------- 配置路径 ----------
function cfgDir(ctx) {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  return path.join(appData, "live2d-cyrene", "plugin-data", PLUGIN_ID);
}

function cfgPath(ctx) {
  return path.join(cfgDir(ctx), "profiles.json");
}

function loadCfg(ctx) {
  const p = cfgPath(ctx);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      ctx.log(`读取配置失败，使用 seed：${e.message}`);
    }
  }
  // 从插件自带的 seed 复制一份
  const seed = path.join(__dirname, "profiles.json");
  if (fs.existsSync(seed)) {
    const dir = cfgDir(ctx);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(seed, p);
    ctx.log(`已从 seed 初始化配置到 ${p}`);
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return { healthTestImage: "", profiles: [] };
}

function saveCfg(ctx, cfg) {
  const dir = cfgDir(ctx);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cfgPath(ctx), JSON.stringify(cfg, null, 2), "utf8");
}

// ---------- profile 校验 ----------
function validateProfile(p, isUpdate) {
  if (!p || typeof p !== "object") return "profile 必须是对象";
  if (typeof p.name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(p.name))
    return "name 必须是字母数字开头的 slug（可含 - _）";
  if (!isUpdate && (typeof p.baseUrl !== "string" || !/^https?:\/\//.test(p.baseUrl)))
    return "baseUrl 必须以 http:// 或 https:// 开头";
  if (!isUpdate && (typeof p.apiKey !== "string" || p.apiKey.length < 8))
    return "apiKey 长度至少 8 位";
  if (!isUpdate && (typeof p.model !== "string" || !p.model.trim()))
    return "model 不能为空";
  return null;
}

// ---------- 图片 → data URL ----------
const EXT_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

function imageToDataURL(imageArg, promptText) {
  if (typeof imageArg !== "string" || !imageArg.trim()) {
    throw new Error(`image 不能为空。prompt=${JSON.stringify(promptText)}`);
  }
  const s = imageArg.trim();
  // 已经是 data URL
  if (/^data:image\/[a-z]+;base64,/.test(s)) return s;
  // http(s) 直连
  if (/^https?:\/\//.test(s)) return s;
  // 本地路径
  const p = path.resolve(s);
  if (!fs.existsSync(p)) throw new Error(`图片文件不存在：${p}`);
  const stat = fs.statSync(p);
  if (stat.size > MAX_IMAGE_MB * 1024 * 1024)
    throw new Error(`图片过大（>${MAX_IMAGE_MB}MB）：${p}`);
  const mime = EXT_MIME[path.extname(p).toLowerCase()] || "image/png";
  const b64 = fs.readFileSync(p).toString("base64");
  return `data:${mime};base64,${b64}`;
}

// ---------- OpenAI 兼容 chat/completions 调用 ----------
async function callProfile(profile, imageArg, promptText, ctx, signal) {
  const url = profile.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => ctrl.abort(), profile.timeoutMs || 60000);

  try {
    const dataUrl = imageToDataURL(imageArg, promptText);
    const messages = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: promptText },
        ],
      },
    ];
    const body = {
      model: profile.model,
      messages,
      max_tokens: 2048,
    };
    const headers = {
      "Content-Type": "application/json",
    };
    if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`;

    const t0 = Date.now();
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const elapsed = Date.now() - t0;

    if (!resp.ok) {
      let detail = "";
      try {
        detail = (await resp.text()).slice(0, 500);
      } catch (_) {}
      return {
        ok: false,
        profile: profile.name,
        elapsedMs: elapsed,
        error: `HTTP ${resp.status}：${detail || resp.statusText}`,
      };
    }

    const json = await resp.json();
    const text = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || "";
    return {
      ok: true,
      profile: profile.name,
      model: json.model || profile.model,
      elapsedMs: elapsed,
      text: typeof text === "string" ? text : JSON.stringify(text),
      usage: json.usage || null,
    };
  } catch (e) {
    return {
      ok: false,
      profile: profile.name,
      elapsedMs: 0,
      error: e.name === "AbortError" ? `超时或取消：${url}` : `${e.name}: ${e.message}`,
    };
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

// ---------- 内部 helpers ----------
function getProfiles(cfg, { onlyEnabled = false } = {}) {
  let list = (cfg.profiles || []).slice();
  if (onlyEnabled) list = list.filter((p) => p.enabled !== false);
  list.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  return list;
}

function summarize(p) {
  const key = p.apiKey || "";
  return {
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    enabled: p.enabled !== false,
    priority: p.priority ?? null,
    timeoutMs: p.timeoutMs ?? null,
    apiKeyMask: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : "",
  };
}

// 返回值约定：直接返回字符串，宿主会 trimStart；
// 失败用 ✗ 前缀让前端/AI 一眼能识别，但依然是字符串不会报错
function ok(text) {
  return text;
}
function fail(text) {
  return `✗ ${text}`;
}

// ---------- 工具注册 ----------
function registerTools(ctx) {
  ctx.registerTool({
    id: `${PLUGIN_ID}_list`,
    name: "vision-list",
    description:
      "列出当前配置的所有视觉模型 profile。当用户问'我配了哪些视觉模型'、'有哪些视觉接口'、'vision-hub 里有什么'时使用。apiKey 会脱敏显示。",
    enabled: true,
    risk: "safe",
    effectKind: "read",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const cfg = loadCfg(ctx);
      const all = getProfiles(cfg);
      if (all.length === 0) return fail("配置为空，还没有任何视觉模型 profile。用 vision-hub_add 添加一个。");
      return ok(
        `共 ${all.length} 个 profile（按 priority 排序）：\n` +
          all
            .map(
              (p, i) =>
                `${i + 1}. [${p.enabled !== false ? "✓" : "✗"}] ${p.name} · ${p.model} @ ${p.baseUrl} · priority=${p.priority ?? "-"} · key=${summarize(p).apiKeyMask}`
            )
            .join("\n")
      );
    },
  });

  ctx.registerTool({
    id: `${PLUGIN_ID}_ask`,
    name: "vision-ask",
    description:
      "手动指定 profile 名让视觉模型看图回答。适用于用户明确指定某个视觉模型（如'用 glm-x5m5x 看看这张图'、'用 xxx 接口识别一下'），或用户提到 vision-hub / 视觉模型且给了具体 profile 名。profile 名必须先通过 vision-hub_list 确认存在。image 支持本地绝对路径、http(s) URL 或 data URL。",
    enabled: true,
    risk: "safe",
    effectKind: "read",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string", description: "profile 名（slug，如 glm-x5m5x）" },
        image: { type: "string", description: "本地绝对路径 / http(s) URL / data:image/...;base64 URL" },
        prompt: { type: "string", description: "问视觉模型的问题，比如'这张图里是什么'" },
      },
      required: ["profile", "image", "prompt"],
    },
    async execute(args) {
      const cfg = loadCfg(ctx);
      const p = (cfg.profiles || []).find((x) => x.name === args.profile);
      if (!p) {
        const names = (cfg.profiles || []).map((x) => x.name).join(", ") || "(空)";
        return fail(`找不到 profile "${args.profile}"。当前可用：${names}`);
      }
      if (p.enabled === false) return fail(`profile "${args.profile}" 已被禁用（enabled=false）`);
      const r = await callProfile(p, args.image, args.prompt, ctx, ctx.signal);
      if (r.ok) {
        return ok(`[profile=${r.profile}, model=${r.model}, ${r.elapsedMs}ms]\n${r.text}`);
      }
      return fail(`调用 ${args.profile} 失败（${r.elapsedMs}ms）：${r.error}`);
    },
  });

  ctx.registerTool({
    id: `${PLUGIN_ID}_auto`,
    name: "vision-auto",
    description:
      "在多个视觉 profile 中自动轮转兜底：按 priority 从小到大逐个尝试，第一个成功即返回；全部失败则汇总错误。适用于用户没指定 profile 只想'帮我看看这张图'、'识别一下'、'这图是什么'等一般视觉需求。image 支持本地绝对路径 / http(s) URL / data URL。",
    enabled: true,
    risk: "safe",
    effectKind: "read",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "图片来源" },
        prompt: { type: "string", description: "问题" },
        maxAttempts: { type: "number", description: "最多尝试几个 profile（默认 3）" },
      },
      required: ["image", "prompt"],
    },
    async execute(args) {
      const cfg = loadCfg(ctx);
      const list = getProfiles(cfg, { onlyEnabled: true });
      if (list.length === 0) return fail("没有 enabled=true 的 profile，请先用 vision-hub_add 添加");
      const limit = Math.min(args.maxAttempts || 3, list.length);
      const tried = [];
      for (let i = 0; i < limit; i++) {
        const r = await callProfile(list[i], args.image, args.prompt, ctx, ctx.signal);
        tried.push({ name: list[i].name, ok: r.ok, elapsedMs: r.elapsedMs, error: r.error || null });
        if (r.ok) {
          return ok(
            `成功（尝试 ${i + 1}/${limit}，profile=${r.profile}，model=${r.model}，${r.elapsedMs}ms）\n\n${r.text}`
          );
        }
      }
      return fail(
        `所有 ${tried.length} 个 profile 都失败：\n` +
          tried.map((t) => `- ${t.name} (${t.elapsedMs}ms): ${t.error}`).join("\n")
      );
    },
  });

  ctx.registerTool({
    id: `${PLUGIN_ID}_health`,
    name: "vision-health",
    description:
      "遍历所有 enabled=true 的 profile 做健康检查：用一张极小测试图（1x1 白色 PNG，或 profiles.json 里的 healthTestImage）发一条简单 prompt，逐个报告响应时间、状态、错误。适用于用户问'哪个视觉模型能用'、'健康检查'、'哪个挂了'时使用。注意：会真实消耗每个 profile 的额度（虽然图片很小）。",
    enabled: true,
    risk: "safe",
    effectKind: "read",
    inputSchema: {
      type: "object",
      properties: {
        only: { type: "string", description: "只测某个 profile 名，可选" },
        prompt: { type: "string", description: "自定义测试 prompt，默认 'ping'" },
      },
      required: [],
    },
    async execute(args) {
      const cfg = loadCfg(ctx);
      let list = getProfiles(cfg, { onlyEnabled: true });
      if (args.only) list = list.filter((p) => p.name === args.only);
      if (list.length === 0) return fail("没有要测的 profile");
      const imgArg = cfg.healthTestImage
        ? cfg.healthTestImage
        : `data:image/png;base64,${HEALTH_TEST_PNG_B64}`;
      const prompt = args.prompt || "ping";
      const results = [];
      for (const p of list) {
        if (ctx.signal && ctx.signal.aborted) break;
        const r = await callProfile(p, imgArg, prompt, ctx, ctx.signal);
        results.push(r);
      }
      const okCount = results.filter((r) => r.ok).length;
      return ok(
        `健康检查完成：${okCount}/${results.length} 存活\n\n` +
          results
            .map((r) =>
              r.ok
                ? `✓ ${r.profile} — ${r.elapsedMs}ms`
                : `✗ ${r.profile} — ${r.elapsedMs}ms — ${r.error}`
            )
            .join("\n")
      );
    },
  });

  ctx.registerTool({
    id: `${PLUGIN_ID}_add`,
    name: "vision-add",
    description:
      "新增或更新一个视觉模型 profile。新增需 name/baseUrl/apiKey/model 全给；只给 name + 想改的字段则更新。enabled 默认 true，priority 越小越先被 auto 尝试。",
    enabled: true,
    risk: "safe",
    effectKind: "write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "profile 名，slug" },
        baseUrl: { type: "string", description: "OpenAI 兼容的 base URL，如 https://api.xxx.com/v1" },
        apiKey: { type: "string", description: "API Key" },
        model: { type: "string", description: "视觉模型名，如 glm-5.3-flash / qwen-vl-max / gpt-4o" },
        enabled: { type: "boolean", description: "是否启用，默认 true" },
        priority: { type: "number", description: "轮转优先级，数字越小越先试，默认 10" },
        timeoutMs: { type: "number", description: "超时毫秒，默认 60000" },
      },
      required: ["name"],
    },
    async execute(args) {
      const cfg = loadCfg(ctx);
      const exist = (cfg.profiles || []).find((x) => x.name === args.name);
      if (!exist) {
        const err = validateProfile(args, false);
        if (err) return fail(`新增失败：${err}`);
        cfg.profiles = cfg.profiles || [];
        cfg.profiles.push({
          name: args.name,
          baseUrl: args.baseUrl.replace(/\/+$/, ""),
          apiKey: args.apiKey,
          model: args.model,
          enabled: args.enabled !== false,
          priority: args.priority ?? 10,
          timeoutMs: args.timeoutMs ?? 60000,
        });
        saveCfg(ctx, cfg);
        return ok(`已新增 profile：${args.name}`);
      }
      const patch = { ...args };
      delete patch.name;
      const merged = { ...exist, ...patch };
      if (merged.enabled === undefined) merged.enabled = exist.enabled !== false;
      if (merged.timeoutMs === undefined) merged.timeoutMs = exist.timeoutMs ?? 60000;
      if (merged.priority === undefined) merged.priority = exist.priority ?? 10;
      saveCfg(ctx, cfg);
      return ok(`已更新 profile：${args.name}`);
    },
  });

  ctx.registerTool({
    id: `${PLUGIN_ID}_remove`,
    name: "vision-remove",
    description:
      "删除一个视觉模型 profile。适用于用户明确说'删掉 xxx 这个视觉模型'、'移除 profile xxx'时使用。",
    enabled: true,
    risk: "safe",
    effectKind: "write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "profile 名" },
      },
      required: ["name"],
    },
    async execute(args) {
      const cfg = loadCfg(ctx);
      const before = (cfg.profiles || []).length;
      cfg.profiles = (cfg.profiles || []).filter((x) => x.name !== args.name);
      if (cfg.profiles.length === before) return fail(`没找到 profile "${args.name}"`);
      saveCfg(ctx, cfg);
      return ok(`已删除 profile：${args.name}（还剩 ${cfg.profiles.length} 个）`);
    },
  });

  ctx.registerTool({
    id: `${PLUGIN_ID}_toggle`,
    name: "vision-toggle",
    description:
      "批量开关视觉模型 profile 的 enabled 状态。支持四种模式：(1) name 单个开/关，(2) names 逗号分隔批量开/关，(3) all=true/false 全开全关，(4) only=[...] 白名单（只留这些开，其他全关）。state=true 打开、false 关闭。only 模式优先级最高。",
    enabled: true,
    risk: "safe",
    effectKind: "write",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "单个 profile 名（与 names/only 互斥）",
        },
        names: {
          type: "string",
          description: "逗号分隔的 profile 名列表（批量）",
        },
        only: {
          type: "array",
          description: "白名单模式：只启用列出的 profile，其他全部关闭",
          items: { type: "string" },
        },
        all: {
          type: "boolean",
          description: "true=全部启用；false=全部禁用",
        },
        state: {
          type: "boolean",
          description: "目标状态，默认 true",
        },
      },
      required: [],
    },
    async execute(args) {
      const cfg = loadCfg(ctx);
      const list = cfg.profiles || [];
      if (list.length === 0) return fail("配置为空，没有 profile 可切换");

      const state = args.state !== false;
      const changed = [];
      const skipped = [];

      if (Array.isArray(args.only) && args.only.length > 0) {
        const onlySet = new Set(args.only);
        for (const p of list) {
          const target = onlySet.has(p.name);
          if (p.enabled !== false && target) continue;
          if (p.enabled === false && !target) continue;
          p.enabled = target;
          changed.push(`${p.name}→${target ? "on" : "off"}`);
        }
        for (const n of onlySet) {
          if (!list.find((x) => x.name === n)) skipped.push(`${n}(不存在)`);
        }
        saveCfg(ctx, cfg);
        return ok(
          `白名单模式生效：${changed.length} 个已切换\n` +
            (changed.length ? changed.join(", ") : "(无变化)") +
            (skipped.length ? `\n警告：${skipped.join(", ")}` : "")
        );
      }

      if (typeof args.all === "boolean") {
        for (const p of list) {
          if (p.enabled === args.all) continue;
          p.enabled = args.all;
          changed.push(`${p.name}→${args.all ? "on" : "off"}`);
        }
        saveCfg(ctx, cfg);
        return ok(
          `${args.all ? "全部启用" : "全部禁用"}：${changed.length} 个已切换\n` +
            (changed.length ? changed.join(", ") : "(无变化)")
        );
      }

      const targets = new Set();
      if (args.name) targets.add(args.name);
      if (args.names) {
        for (const s of args.names.split(",")) {
          const t = s.trim();
          if (t) targets.add(t);
        }
      }
      if (targets.size === 0) {
        return fail(
          "至少给一个参数：name / names / only / all 四选一"
        );
      }

      for (const n of targets) {
        const p = list.find((x) => x.name === n);
        if (!p) {
          skipped.push(n);
          continue;
        }
        if (p.enabled === state) continue;
        p.enabled = state;
        changed.push(`${n}→${state ? "on" : "off"}`);
      }
      saveCfg(ctx, cfg);
      return ok(
        `${state ? "启用" : "禁用"} ${changed.length} 个：\n` +
          (changed.length ? changed.join("\n") : "(无变化，目标状态和当前一致)") +
          (skipped.length ? `\n警告：${skipped.join(", ")} 未找到` : "")
      );
    },
  });

  ctx.registerTool({
    id: `${PLUGIN_ID}_set_health_test`,
    name: "vision-set-health-test",
    description:
      "设置 vision-health 用来做健康检查的测试图路径。默认用一张内建的 1x1 白色 PNG（几乎零成本）。设置本地图片或 http URL 后，每次 health 检查会用这张图。传空字符串恢复内建默认。",
    enabled: true,
    risk: "safe",
    effectKind: "write",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "本地路径 / http URL / data URL；传空恢复默认" },
      },
      required: ["image"],
    },
    async execute(args) {
      const cfg = loadCfg(ctx);
      cfg.healthTestImage = (args.image || "").trim();
      saveCfg(ctx, cfg);
      return ok(
        cfg.healthTestImage
          ? `健康检查测试图已设为：${cfg.healthTestImage}`
          : `已恢复为内建 1x1 白色 PNG`
      );
    },
  });

  ctx.registerTool({
    id: `${PLUGIN_ID}_config_path`,
    name: "vision-config-path",
    description:
      "打印当前 vision-hub 实际使用的 profiles.json 配置文件绝对路径，方便用户手动编辑或备份。",
    enabled: true,
    risk: "safe",
    effectKind: "read",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const p = cfgPath(ctx);
      return ok(`配置路径：${p}\n存在：${fs.existsSync(p)}`);
    },
  });
}

// ---------- 入口 ----------
module.exports = {
  async register(ctx) {
    // 首次接触配置（同时确保目录/文件存在）
    try {
      loadCfg(ctx);
    } catch (e) {
      ctx.log(`init cfg failed: ${e.message}`);
    }
    registerTools(ctx);
    ctx.log(`vision-hub 已启用，工具根前缀=${PLUGIN_ID}_`);
  },
  async unregister() {
    // 没有打开的窗口/定时器/子进程，无需清理
  },
};
