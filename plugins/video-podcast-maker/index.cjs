"use strict";

// ===========================================================================
// Video Podcast Maker (视频播客生成器) —— Cyrene 运行时插件入口
//
// 上游：Agents365-ai/video-podcast-maker (v5.3.0, MIT)
// 形态：把上游的 Agent Skill（SKILL.md + scripts/ + references/）包装为
//       Cyrene 工具，让昔涟可以直接驱动整条流水线：
//
//   选题研究 → 脚本撰写 → 本地 TTS(edge/azure) → Remotion 渲染 → MP4 + BGM
//
// 暴露的工具：
//   video-podcast-maker_get_guide  : 读取 SKILL.md / references 工作流文档
//   video-podcast-maker_prereqs    : 环境依赖自检（node / python3 / ffmpeg）
//   video-podcast-maker_schema     : 查询 CLI 各动作的 JSON Schema
//   video-podcast-maker_prefs      : 读取/迁移用户偏好（backend / bgm-path）
//   video-podcast-maker_run        : 白名单调度 scripts/cli.py 执行各阶段
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const PLUGIN_ID = "video-podcast-maker";
const ROOT = __dirname;
const SCRIPTS_DIR = path.join(ROOT, "scripts");
const REFERENCES_DIR = path.join(ROOT, "references");
const CLI_SCRIPT = path.join(SCRIPTS_DIR, "cli.py");

// cli.py 中声明的资源名（白名单，避免任意脚本执行）
const RESOURCES = [
  "tts",
  "verify",
  "align",
  "audit",
  "shorts",
  "design",
  "assets",
  "prereqs",
  "capabilities",
  "prefs",
  "schema",
];

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟（TTS / 渲染可能较慢）
const MAX_OUTPUT_CHARS = 60000;

let pythonCache = null;

// ---------------------------------------------------------------------------
// Python 解释器探测：优先 python3（skill 的 prereq 名），回退 python / py
// ---------------------------------------------------------------------------
function probePython(candidate) {
  return new Promise((resolve) => {
    execFile(
      candidate.cmd,
      candidate.args.concat(["-c", "import sys;print(sys.version)"]),
      { timeout: 15000, windowsHide: true },
      (error) => resolve(!error)
    );
  });
}

async function resolvePython() {
  if (pythonCache) return pythonCache;
  const candidates = [
    { cmd: "python3", args: [] },
    { cmd: "python", args: [] },
    { cmd: "py", args: ["-3"] },
  ];
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await probePython(c)) {
      pythonCache = c;
      return c;
    }
  }
  pythonCache = { cmd: "python", args: [] };
  return pythonCache;
}

function runProcess({ cmd, args, cwd, timeoutMs, signal }) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: cwd || ROOT,
        timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        signal,
        env: Object.assign({}, process.env, { PYTHONIOENCODING: "utf-8" }),
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        resolve({
          exitCode,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          timedOut: Boolean(error && error.killed),
        });
      }
    );
  });
}

function clip(text) {
  const s = String(text || "");
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return (
    s.slice(0, MAX_OUTPUT_CHARS) +
    "\n\n...[输出过长，已截断 " +
    (s.length - MAX_OUTPUT_CHARS) +
    " 字符]"
  );
}

function formatResult(label, res) {
  const lines = [
    `【${label}】exitCode=${res.exitCode}${res.timedOut ? " (超时终止)" : ""}`,
  ];
  if (res.stdout.trim()) lines.push("--- stdout ---\n" + res.stdout.trim());
  if (res.stderr.trim()) lines.push("--- stderr ---\n" + res.stderr.trim());
  return clip(lines.join("\n\n"));
}

// ---------------------------------------------------------------------------
// 统一通过 scripts/cli.py 调度
// ---------------------------------------------------------------------------
async function runCli(parts, opts, signal) {
  const py = await resolvePython();
  const args = py.args.concat([CLI_SCRIPT]).concat(parts);
  return runProcess({
    cmd: py.cmd,
    args,
    cwd: (opts && opts.cwd) || ROOT,
    timeoutMs: (opts && opts.timeoutMs) || DEFAULT_TIMEOUT_MS,
    signal,
  });
}

function listReferenceDocs() {
  try {
    return fs
      .readdirSync(REFERENCES_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch (_) {
    return [];
  }
}

module.exports = {
  async register(ctx) {
    const py = await resolvePython();
    ctx.log(
      `Video Podcast Maker 插件已注册（python: ${py.cmd}，脚本目录: ${SCRIPTS_DIR}）`
    );

    // -----------------------------------------------------------------------
    // 工具 1：读取工作流指南（SKILL.md / references/*.md）
    // -----------------------------------------------------------------------
    ctx.registerTool({
      id: `${PLUGIN_ID}_get_guide`,
      name: "获取视频播客制作指南",
      description:
        "读取 video-podcast-maker 的官方工作流文档。适用场景：准备制作知识讲解视频、叙事播客、动画信息图视频，或需要了解流水线各阶段（研究/脚本/TTS/渲染/发布）的规范与命令。doc 可选：SKILL（默认，主流程说明）、README；也可传 references 下的文档名（如 workflow-script.md、platform-matrix.md）。传 list=true 可列出全部可用文档。",
      risk: "safe",
      effectKind: "read",
      parameters: {
        type: "object",
        properties: {
          doc: {
            type: "string",
            description:
              "文档名。SKILL=主技能说明（默认）；其余为 references 目录下的文件名，如 workflow-script.md / workflow-production.md / workflow-publish.md / platform-matrix.md / script-polish.md / natural-narration.md / visual-taste.md / design-guide.md / design-learning.md / workflow-assets.md / troubleshooting.md / zh-polyphones.md",
          },
          list: {
            type: "boolean",
            description: "true 时只返回可用文档清单",
          },
          keyword: {
            type: "string",
            description:
              "可选关键词；提供时只返回文档中命中关键词附近的段落，避免整篇过长",
          },
        },
        required: [],
      },
      async execute(params) {
        const docs = listReferenceDocs();
        if (params && params.list) {
          return (
            "可用文档：\n- SKILL (主技能说明)\n- README\n- " +
            docs.map((d) => `references/${d}`).join("\n- ")
          );
        }

        const raw = (params && params.doc) || "SKILL";
        let filePath;
        let label;
        if (/^SKILL$/i.test(raw)) {
          filePath = path.join(ROOT, "SKILL.md");
          label = "SKILL.md";
        } else if (/^README(_CN)?$/i.test(raw)) {
          filePath = path.join(ROOT, "README.md");
          label = "README.md";
          if (!fs.existsSync(filePath)) {
            filePath = path.join(ROOT, "README_CN.md");
            label = "README_CN.md";
          }
        } else {
          const name = path.basename(raw);
          if (!docs.includes(name)) {
            return `未找到文档「${raw}」。可用文档：\n- SKILL\n- README\n- ${docs
              .map((d) => `references/${d}`)
              .join("\n- ")}`;
          }
          filePath = path.join(REFERENCES_DIR, name);
          label = `references/${name}`;
        }

        if (!fs.existsSync(filePath)) {
          return `文档 ${label} 不存在。`;
        }
        let content = fs.readFileSync(filePath, "utf8");

        const kw = params && params.keyword;
        if (kw && String(kw).trim()) {
          const needle = String(kw);
          const lower = content.toLowerCase();
          const idx = lower.indexOf(needle.toLowerCase());
          if (idx < 0) {
            return `${label} 中未找到关键词「${needle}」。`;
          }
          const start = Math.max(0, idx - 1500);
          const end = Math.min(content.length, idx + 3500);
          content =
            `（${label} 中「${needle}」附近片段）\n\n` +
            content.slice(start, end);
        } else {
          content = `（${label} 全文）\n\n` + content;
        }
        return clip(content);
      },
    });

    // -----------------------------------------------------------------------
    // 工具 2：环境依赖自检
    // -----------------------------------------------------------------------
    ctx.registerTool({
      id: `${PLUGIN_ID}_prereqs`,
      name: "视频播客环境自检",
      description:
        "检查视频播客生成流水线所需的本地环境依赖（node / python3 / ffmpeg，以及当前 TTS 后端所需的密钥）。制作视频前先调用一次，确认环境就绪。",
      risk: "safe",
      effectKind: "read",
      parameters: {
        type: "object",
        properties: {
          backend: {
            type: "string",
            description:
              "可选，指定 TTS 后端进行校验：edge（免费本地）或 azure（需密钥）",
          },
        },
        required: [],
      },
      async execute(params, meta) {
        const parts = ["prereqs"];
        if (params && params.backend) {
          parts.push("--backend", String(params.backend));
        }
        const res = await runCli(parts, {}, meta && meta.signal);
        return formatResult("环境自检", res);
      },
    });

    // -----------------------------------------------------------------------
    // 工具 3：查询 CLI 动作的 JSON Schema
    // -----------------------------------------------------------------------
    ctx.registerTool({
      id: `${PLUGIN_ID}_schema`,
      name: "查询视频播客 CLI 参数规范",
      description:
        "查询流水线各动作的参数规范（JSON Schema）。调用 video-podcast-maker_run 之前，如果对某个动作的参数不确定，先用本工具查询。method 例如 tts.run / tts.validate / verify / align / audit.beats / shorts.gen / design.add / assets.init / prefs.get；不传 method 时列出全部可用动作。",
      risk: "safe",
      effectKind: "read",
      parameters: {
        type: "object",
        properties: {
          method: {
            type: "string",
            description:
              "动作名，如 tts.run。留空则列出全部动作及其说明。",
          },
        },
        required: [],
      },
      async execute(params, meta) {
        const parts = ["schema"];
        if (params && params.method) parts.push(String(params.method));
        const res = await runCli(parts, {}, meta && meta.signal);
        return formatResult("参数规范", res);
      },
    });

    // -----------------------------------------------------------------------
    // 工具 4：用户偏好（后端 / BGM 路径）
    // -----------------------------------------------------------------------
    ctx.registerTool({
      id: `${PLUGIN_ID}_prefs`,
      name: "视频播客用户偏好",
      description:
        "读取视频播客制作偏好（TTS 后端、BGM 路径、目标平台、语言、字幕、视觉主题等）。action=backend 查询当前 TTS 后端（edge/azure）；bgm-path 查询内置 BGM 路径；get 读取偏好项（keys 指定偏好分组，默认 global，可传 global + 其他分组）；migrate 迁移旧版偏好文件。",
      risk: "safe",
      effectKind: "read",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "动作：backend（默认）/ bgm-path / get / migrate",
            enum: ["backend", "bgm-path", "get", "migrate"],
          },
          keys: {
            type: "array",
            items: { type: "string" },
            description:
              "action=get 时指定偏好分组名，默认 [\"global\"]。",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "透传给该动作的附加参数（极少用）",
          },
        },
        required: [],
      },
      async execute(params, meta) {
        const action = (params && params.action) || "backend";
        const parts = ["prefs", action];
        if (action === "get") {
          const keys =
            params && Array.isArray(params.keys) && params.keys.length
              ? params.keys
              : ["global"];
          for (const k of keys) parts.push(String(k));
          parts.push("--format", "json");
        }
        const extra = (params && params.args) || [];
        for (const a of extra) parts.push(String(a));
        const res = await runCli(parts, {}, meta && meta.signal);
        return formatResult("用户偏好", res);
      },
    });

    // -----------------------------------------------------------------------
    // 工具 5：白名单调度（核心执行入口）
    // -----------------------------------------------------------------------
    ctx.registerTool({
      id: `${PLUGIN_ID}_run`,
      name: "执行视频播客流水线动作",
      description:
        "驱动 video-podcast-maker 的流水线动作。resource 指定阶段：tts（配音合成/校验）、verify（产物验收）、align（时间轴对齐）、audit（节拍同步审计，action=beats）、shorts（短视频切片，action=gen）、design（视觉设计库）、assets（素材引擎）、capabilities（能力清单）。args 为透传给该动作的命令行参数数组。执行前建议先用 video-podcast-maker_get_guide 读工作流、用 video-podcast-maker_schema 确认参数。",
      risk: "shell",
      effectKind: "write",
      parameters: {
        type: "object",
        properties: {
          resource: {
            type: "string",
            description: "阶段/资源名",
            enum: RESOURCES,
          },
          action: {
            type: "string",
            description:
              "子动作，可选。例如 tts 的 run/validate、shorts 的 gen、design 的 list/show/add/delete、assets 的 init/add/list/validate",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description:
              "透传给该动作的命令行参数数组，例如 [\"--project\", \"videos/my-topic\", \"--voice\", \"zh-CN-XiaoxiaoNeural\"]",
          },
          cwd: {
            type: "string",
            description:
              "工作目录（可选）。默认插件目录；项目产物通常位于 <cwd>/videos/<项目名>/，建议传你的项目工作区绝对路径。",
          },
          timeoutMs: {
            type: "number",
            description: "超时毫秒数，默认 600000（10 分钟）",
          },
        },
        required: ["resource"],
      },
      async execute(params, meta) {
        const resource = String((params && params.resource) || "").trim();
        if (!RESOURCES.includes(resource)) {
          return `不支持的资源「${resource}」。可用：${RESOURCES.join(", ")}`;
        }
        const parts = [resource];
        if (params && params.action) parts.push(String(params.action));
        const extra = (params && params.args) || [];
        if (!Array.isArray(extra)) {
          return "args 必须是字符串数组。";
        }
        for (const a of extra) parts.push(String(a));

        const res = await runCli(
          parts,
          { cwd: params && params.cwd, timeoutMs: params && params.timeoutMs },
          meta && meta.signal
        );
        return formatResult(`cli.py ${parts.join(" ")}`, res);
      },
    });

    ctx.log(`${PLUGIN_ID}: 5 个工具注册完成。`);
  },

  async unregister() {},
};
