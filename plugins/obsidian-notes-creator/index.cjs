"use strict";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const https = require("node:https");

const DEFAULT_API_KEY =
  process.env.OBSIDIAN_API_KEY ||
  "6bd4d876cb562ced6190699f5d1b9f76c03f266831183b526ffe4c3c2b2149c3";
const DEFAULT_BASE_URL =
  process.env.OBSIDIAN_BASE_URL || "https://127.0.0.1:27124";

function cleanVaultPath(filePath) {
  if (!filePath) return "";
  let p = filePath.replace(/\\/g, "/");
  if (p.startsWith("/")) p = p.slice(1);
  return p;
}

function ensureMdExt(filePath) {
  const p = cleanVaultPath(filePath);
  return p.endsWith(".md") ? p : `${p}.md`;
}

async function requestObsidian(method, endpoint, body = null, isJson = false) {
  const apiKey = process.env.OBSIDIAN_API_KEY || DEFAULT_API_KEY;
  const baseUrl = process.env.OBSIDIAN_BASE_URL || DEFAULT_BASE_URL;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (body !== null) {
    headers["Content-Type"] = isJson
      ? "application/json"
      : "text/markdown; charset=utf-8";
  }

  const url = `${baseUrl}${endpoint}`;
  const options = {
    method,
    headers,
  };
  if (body !== null) {
    options.body = isJson ? JSON.stringify(body) : body;
  }

  const res = await fetch(url, options);
  return res;
}

module.exports = {
  register(ctx) {
    // 1. 核心工具：结构化双链考点学习笔记
    ctx.registerTool({
      id: "obsidian-notes-creator_create_study_note",
      name: "生成双链考点笔记",
      description:
        "【Obsidian Notes Creator 核心工具】将教材/考点/长文结构化为标准双链笔记（全景图谱Mermaid+深度解析+辨析对比表+复习题+7天落地清单）并直接存入 Obsidian 知识库。",
      risk: "write",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          note_path: {
            type: "string",
            description: '笔记保存的相对路径（例如 "法硕背诵/刑法/罪刑法定原则.md"）',
          },
          title: {
            type: "string",
            description: "笔记标题",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: '笔记标签数组（例如 ["法硕", "刑法", "重点考点"]）',
          },
          mindmap_mermaid: {
            type: "string",
            description:
              "全景逻辑架构脑图或流程图的 Mermaid 语法代码（无需包含 ```mermaid 标记）",
          },
          core_analysis: {
            type: "string",
            description: "核心要点与深度案例解析 Markdown 文本",
          },
          concept_comparison_table: {
            type: "string",
            description: "易混淆概念辨析对比表格 Markdown 文本",
          },
          review_questions: {
            type: "string",
            description:
              "10 道深度复习思考题 Markdown 文本（按基础、进阶、反思三层）",
          },
          action_plan_7days: {
            type: "string",
            description: "7 天落地执行打卡清单 Markdown 文本",
          },
        },
        required: ["note_path", "title", "core_analysis"],
      },
      async execute(args) {
        const filePath = ensureMdExt(args.note_path);
        const title = args.title;
        const tags = Array.isArray(args.tags) ? args.tags : [];
        const dateStr = new Date().toISOString().split("T")[0];

        // 规范组装 Obsidian Notes Creator 双链格式
        let doc = "---\n";
        doc += `title: "${title}"\n`;
        doc += `date: ${dateStr}\n`;
        if (tags.length > 0) {
          doc += `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}\n`;
        }
        doc += "---\n\n";

        doc += `# ${title}\n\n`;

        if (args.mindmap_mermaid && args.mindmap_mermaid.trim()) {
          doc += `## 🗺️ 全景知识架构图\n\n`;
          doc += `\`\`\`mermaid\n${args.mindmap_mermaid.trim()}\n\`\`\`\n\n`;
        }

        doc += `## 💡 核心要点解析\n\n${args.core_analysis.trim()}\n\n`;

        if (
          args.concept_comparison_table &&
          args.concept_comparison_table.trim()
        ) {
          doc += `## ⚖️ 核心概念与易混辨析表\n\n${args.concept_comparison_table.trim()}\n\n`;
        }

        if (args.review_questions && args.review_questions.trim()) {
          doc += `## ❓ 深度复习思考题\n\n${args.review_questions.trim()}\n\n`;
        }

        if (args.action_plan_7days && args.action_plan_7days.trim()) {
          doc += `## 📅 7天落地执行与复习打卡清单\n\n${args.action_plan_7days.trim()}\n\n`;
        }

        const encodedPath = filePath
          .split("/")
          .map((part) => encodeURIComponent(part))
          .join("/");
        const endpoint = `/vault/${encodedPath}`;

        const res = await requestObsidian("PUT", endpoint, doc, false);
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(
            `写入学习笔记失败 (${res.status}): ${errText || res.statusText}`
          );
        }

        return `✅ 结构化双链学习笔记《${title}》已成功存入 Obsidian 知识库！\n📂 相对路径: [[${filePath}]]\n🏷️ 包含标签: ${tags.join(", ") || "无"}\n📏 总字符数: ${doc.length} 字`;
      },
    });

    // 2. 浏览目录
    ctx.registerTool({
      id: "obsidian-notes-creator_vault_list",
      name: "列出目录内容",
      description:
        "列出 Obsidian 知识库中指定目录的文件和文件夹列表。不传 path 默认列出根目录。",
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: '知识库内的相对目录路径（例如 "" 或 "法硕/刑法"）',
          },
        },
      },
      async execute(args) {
        const rawPath = cleanVaultPath(args.path || "");
        let endpoint = "/vault/";
        if (rawPath) {
          const parts = rawPath
            .split("/")
            .map((p) => encodeURIComponent(p))
            .join("/");
          endpoint = `/vault/${parts}/`;
        }
        const res = await requestObsidian("GET", endpoint);
        if (!res.ok) {
          throw new Error(`获取目录列表失败: HTTP ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        return JSON.stringify(data, null, 2);
      },
    });

    // 3. 读取笔记
    ctx.registerTool({
      id: "obsidian-notes-creator_read_note",
      name: "读取笔记全文",
      description:
        '读取 Obsidian 知识库中指定笔记文件的全文 Markdown 内容。相对路径如 "宪法/国家制度.md"。',
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: '笔记在知识库中的相对路径（如 "1982年宪法的特点.md"）',
          },
        },
        required: ["path"],
      },
      async execute(args) {
        const filePath = ensureMdExt(args.path);
        const encodedPath = filePath
          .split("/")
          .map((p) => encodeURIComponent(p))
          .join("/");
        const endpoint = `/vault/${encodedPath}`;

        const res = await requestObsidian("GET", endpoint);
        if (res.status === 404) {
          throw new Error(`笔记不存在: ${filePath}`);
        }
        if (!res.ok) {
          throw new Error(`读取笔记失败: HTTP ${res.status} ${res.statusText}`);
        }
        return await res.text();
      },
    });

    // 4. 写入/覆盖笔记
    ctx.registerTool({
      id: "obsidian-notes-creator_write_note",
      name: "写入或覆盖笔记",
      description:
        "在 Obsidian 知识库中创建或覆盖一篇笔记。如果父级目录不存在会自动创建。",
      risk: "write",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "笔记在知识库中的相对保存路径",
          },
          content: {
            type: "string",
            description: "要写入的完整 Markdown 内容",
          },
        },
        required: ["path", "content"],
      },
      async execute(args) {
        const filePath = ensureMdExt(args.path);
        const encodedPath = filePath
          .split("/")
          .map((p) => encodeURIComponent(p))
          .join("/");
        const endpoint = `/vault/${encodedPath}`;

        const res = await requestObsidian("PUT", endpoint, args.content, false);
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`写入失败 (${res.status}): ${err}`);
        }
        return `✅ 笔记已成功写入: [[${filePath}]]`;
      },
    });

    // 5. 追加笔记
    ctx.registerTool({
      id: "obsidian-notes-creator_append_note",
      name: "追加内容到笔记",
      description: "向 Obsidian 知识库中的指定笔记末尾追加内容。",
      risk: "write",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "笔记在知识库中的相对路径",
          },
          content: {
            type: "string",
            description: "要追加的 Markdown 内容",
          },
        },
        required: ["path", "content"],
      },
      async execute(args) {
        const filePath = ensureMdExt(args.path);
        const encodedPath = filePath
          .split("/")
          .map((p) => encodeURIComponent(p))
          .join("/");
        const endpoint = `/vault/${encodedPath}`;

        const res = await requestObsidian(
          "POST",
          endpoint,
          `\n${args.content}`,
          false
        );
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`追加内容失败 (${res.status}): ${err}`);
        }
        return `✅ 内容已成功追加至: [[${filePath}]]`;
      },
    });

    // 6. 全文搜索
    ctx.registerTool({
      id: "obsidian-notes-creator_search_notes",
      name: "全文搜索笔记",
      description:
        "在 Obsidian 整个知识库中根据关键词或概念进行全文搜索，返回匹配的笔记列表与相关度。",
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词或概念短语",
          },
        },
        required: ["query"],
      },
      async execute(args) {
        const endpoint = `/search/simple/?query=${encodeURIComponent(args.query)}`;
        const res = await requestObsidian("POST", endpoint);
        if (!res.ok) {
          throw new Error(`搜索失败 (${res.status}): ${res.statusText}`);
        }
        const data = await res.json();
        return JSON.stringify(data, null, 2);
      },
    });

    // 7. 获取当前活动笔记
    ctx.registerTool({
      id: "obsidian-notes-creator_get_active_note",
      name: "获取当前活动笔记",
      description:
        "获取 Obsidian 客户端当前打开并正在浏览的笔记文件名与全文内容。",
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {},
      },
      async execute() {
        const res = await requestObsidian("GET", "/active/");
        if (!res.ok) {
          throw new Error(
            `获取当前活动笔记失败 (${res.status})。请确认 Obsidian 窗口中是否有已打开的笔记。`
          );
        }
        const locationHeader = res.headers.get("content-location") || "";
        const fileName =
          decodeURIComponent(locationHeader) || "当前活跃笔记";
        const content = await res.text();
        return `# 当前打开的笔记: [[${fileName}]]\n\n${content}`;
      },
    });
  },

  unregister(ctx) {
    // 卸载钩子
  },
};
