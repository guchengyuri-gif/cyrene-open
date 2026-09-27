"use strict";

const fs = require("fs");
const path = require("path");

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  async register(ctx) {
    ctx.log("注册 Create Plan 分步规划硬刹车插件...");

    ctx.registerTool({
      id: "create-plan_generate",
      name: "生成分步规划与验收清单",
      description: "大任务执行前的‘硬刹车’。在项目 .plans 目录下生成标准的执行规划文档，包含里程碑步骤与验收指标，得到用户确认后方可动工。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "规划主题标识，如 auth-system, refactor-ui"
          },
          summary: {
            type: "string",
            description: "任务总览与核心目标"
          },
          phases: {
            type: "array",
            items: {
              type: "object",
              properties: {
                phase_name: { type: "string", description: "阶段名称" },
                tasks: {
                  type: "array",
                  items: { type: "string" },
                  description: "该阶段的具体子任务清单"
                }
              },
              required: ["phase_name", "tasks"]
            },
            description: "拆解的执行阶段与详细子任务"
          },
          acceptance_criteria: {
            type: "array",
            items: { type: "string" },
            description: "验收标准与质量硬门控"
          },
          risks_and_mitigation: {
            type: "string",
            description: "潜在风险与回滚/防御策略"
          },
          project_dir: {
            type: "string",
            description: "工程绝对根目录，默认 D:/ai/program"
          }
        },
        required: ["topic", "summary", "phases", "acceptance_criteria"]
      },
      async execute(params) {
        try {
          const rootDir = params.project_dir || "D:/ai/program";
          const plansDir = path.join(rootDir, ".plans");
          if (!fs.existsSync(plansDir)) {
            fs.mkdirSync(plansDir, { recursive: true });
          }

          const dateStr = getTodayString();
          const cleanTopic = params.topic.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
          const filename = `${dateStr}-${cleanTopic}.md`;
          const filePath = path.join(plansDir, filename);

          let md = `# 规划文档: ${params.topic}\n\n`;
          md += `> 创建日期: ${dateStr}\n`;
          md += `> 状态: 待用户确认 (PENDING_APPROVAL)\n\n`;
          md += `## 1. 任务背景与核心目标\n${params.summary}\n\n`;
          md += `## 2. 里程碑阶段与任务拆解 (Phase Breakdown)\n\n`;

          params.phases.forEach((p) => {
            md += `### ${p.phase_name}\n`;
            p.tasks.forEach((t) => {
              md += `- [ ] ${t}\n`;
            });
            md += "\n";
          });

          md += `## 3. 验收指标 (Acceptance Criteria)\n`;
          params.acceptance_criteria.forEach((ac) => {
            md += `- [ ] ${ac}\n`;
          });
          md += "\n";

          if (params.risks_and_mitigation) {
            md += `## 4. 风险评估与防御策略\n${params.risks_and_mitigation}\n\n`;
          }

          md += `---\n**硬刹车提醒**：在用户明确确认本规划文档前，请勿执行破坏性代码变更。\n`;

          fs.writeFileSync(filePath, md, "utf-8");

          return JSON.stringify({
            status: "success",
            message: "规划文档已生成，硬刹车已启动。请向用户汇报阶段与验收点，等待确认后再执行。",
            plan_file: filePath,
            total_phases: params.phases.length,
            acceptance_count: params.acceptance_criteria.length
          });
        } catch (err) {
          return JSON.stringify({ status: "error", error: err.message });
        }
      }
    });

    ctx.registerTool({
      id: "create-plan_list",
      name: "列出当前工程所有规划文档",
      description: "检查当前项目中已存在的分步计划文档及执行进度。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          project_dir: {
            type: "string",
            description: "工程绝对根目录，默认 D:/ai/program"
          }
        }
      },
      async execute(params) {
        try {
          const rootDir = params.project_dir || "D:/ai/program";
          const plansDir = path.join(rootDir, ".plans");
          if (!fs.existsSync(plansDir)) {
            return JSON.stringify({ plans: [], message: "暂无规划目录或文件" });
          }
          const files = fs.readdirSync(plansDir).filter((f) => f.endsWith(".md"));
          const list = files.map((f) => {
            const p = path.join(plansDir, f);
            const content = fs.readFileSync(p, "utf-8");
            const firstLine = content.split("\n")[0] || f;
            return { file: f, path: p, title: firstLine.replace(/^#\s*/, "") };
          });
          return JSON.stringify({ count: list.length, plans: list });
        } catch (err) {
          return JSON.stringify({ status: "error", error: err.message });
        }
      }
    });
  }
};
