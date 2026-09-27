# Cyrene 客户端（开源扩展仓库）

> 基于 Electron 的 AI 伴侣客户端「Cyrene」的**用户侧扩展**开源仓库：插件、Skill、提示词、MCP 服务、桌宠改造脚手架。

## ⚠️ 本体归属声明

- 本仓库开源内容仅为**用户侧扩展**（plugins / skills / prompts / mcp-servers / 桌宠改造脚本）。
- **Cyrene 客户端本体**（`Cyrene.exe` + `app.asar`）由原作者维护，**不在本仓库范围内**，请通过官方渠道获取。
- 部分扩展（如 `cyrene-furina` 桌宠改造）直接作用于本体 `app.asar`，依赖特定构建版本；升级客户端后可能需要重跑改造流水线。
- 第三方模型（Live2D、素材）版权归原作者，请自行注意使用范围。

---

## 📦 仓库结构

```
cyrene-open/
├── README.md
├── LICENSE                    # MIT
├── .gitignore
├── plugins/                   # 插件（31 个，每个子目录含 manifest.json）
├── skills/                    # Skill（48 个，含官方内置 + 社区技能包）
├── prompts/                   # 提示词（人格 / 模式 / 语气基准 / 世界观）
├── mcp-servers/               # MCP 服务配置与说明
├── cyrene-furina/             # Live2D 桌宠改造脚手架（芙宁娜 / 外部模型目录 + 智能调度）
├── scripts/                   # 辅助脚本（补丁 / 探针 / 扫描）
├── config/                    # 配置示例（无密钥，*.example.json）
├── docs/                      # 文档（架构 / 插件 API / Skill 指南）
└── tools/                     # 一次性工具脚本
```

---

## 🧩 插件清单（plugins/，31 个）

### 协作与工程化

| 插件 | 说明 |
|------|------|
| `better-sidebar` | 聊天窗右侧内嵌「侧栏工作台」：文件树 + 代码/Markdown 编辑器 + 终端 + Git 面板 |
| `dsh-bridge` | 与 DSH 桌面端的文件信箱协作桥（to-cyrene / to-dsh 目录），支持归档、连接器管理 |
| `progress-inject` | 项目进度索引自动注入：按关键词命中展开磁盘上的 `PROGRESS*.md` |
| `task-board` | 任务看板可视化（多任务状态跟踪） |
| `create-plan` | 计划模式配套：把多步骤任务结构化为可执行计划 |
| `computer-use` | 屏幕截图 + 鼠标键盘控制（桌面自动化） |
| `photopea-embed` | 内嵌 Photopea 图片编辑器 |
| `infinite-canvas` | 无限画布（白板 / 拼贴 / 思维导图） |

### 记忆与人格

| 插件 | 说明 |
|------|------|
| `ripples-of-aion` | 「岁月涟漪」记忆：跨会话回忆、实体属性时间线、主动遗忘 |
| `subscription-oauth` | 订阅制 OAuth 登录管理 |

### MCP 桥接（把外部 MCP 服务接进 Cyrene）

| 插件 | 上游服务 |
|------|---------|
| `mcp-deepsb-imagegen` | 带派 API GPT-Image（文生图 + 图生图编辑，角色一致性立绘差分） |
| `mcp-grok-imagegen` | Grok 图像生成 |
| `mcp-awesome-imagegen` | Awesome ImageGen 聚合 |
| `mcp-firecrawl` | Firecrawl 网页抓取 / 搜索 / 站点地图 |
| `mcp-playwright` | Playwright 浏览器自动化（24 个工具） |
| `mcp-obsidian-vault` | Obsidian vault 读写 |
| `mcp-screenwriting` | 剧本写作（开源编剧技能库） |
| `mcp-renpy` | Ren'Py 视觉小说引擎 |
| `mcp-repomix` | 仓库打包（codebase → 单一上下文文件） |
| `mcp-behindeyes` | 行为分析（对话中的情绪 / 意图推断） |
| `mcp-openclaw-bridge` | OpenClaw 桥 |
| `mcp-skills-gateway` | Skill 网关（统一路由） |

### 创作与生产力

| 插件 | 说明 |
|------|------|
| `chinese-novelist` | 中文小说生成 |
| `harness-novel` | 长篇小说创作 harness（大纲 / 章节 / 人物卡） |
| `obsidian-notes-creator` | Obsidian 笔记快速创建 |
| `video-podcast-maker` | 视频播客制作（TTS + 素材合成；素材文件未入库，需自备） |
| `indextts-tts` | IndexTTS 语音合成 |
| `vision-hub` | 视觉模型 Hub：多 profile 轮转兜底（OpenAI 兼容 API） |
| `paper-search-mcp` | 学术论文检索 |
| `clash-manager` | Clash 代理规则管理 |
| `cyrene-wallpaper` | 动态壁纸 |
| `grill-me` | 拷问模式（压力测试式对话） |

---

## 📚 Skill 清单（skills/，48 个）

Skill 是按需加载的能力包（`invoke_skill` 触发），分三类：

### 昔涟官方内置（随 Cyrene 本体发布，此处为快照）

| Skill | 说明 |
|-------|------|
| `cyrene-diagram` | 手写 SVG 学习卡片设计契约（粉白主题 / 防重叠布局） |
| `cyrene-original-voice` | 原作语气校准（场景检测 + 强制注入语气规则） |
| `cyrene-plugin-dev` | 插件开发指南（API 规范 / 入门 / 示例走读） |
| `cyrene-work-hygiene` | Work 模式多文件交付规范 |
| `cyrene-plan-mode` | 计划模式（318 行覆盖检查 + 执行交接） |
| `cyrene-exam-paper` | 出题 Skill（数学 / 物理 / 语言 / 编程 / 概念） |
| `cyrene-learn-tutor` | 学习导师（苏格拉底产婆术 / 场景推导） |
| `cyrene-obsidian-workspace` | Obsidian vault 工作区管理 |

### 工程实践（as-* 系列，15 个）

`as-api-and-interface-design` · `as-code-review-and-quality` · `as-code-simplification` · `as-context-engineering` · `as-debugging-and-error-recovery` · `as-doubt-driven-development` · `as-frontend-ui-engineering` · `as-git-workflow-and-versioning` · `as-incremental-implementation` · `as-planning-and-task-breakdown` · `as-security-and-hardening` · `as-source-driven-development` · `as-spec-driven-development` · `as-using-agent-skills`

### 编码 / 审查（ecc-* 系列，8 个）

`ecc-agent-introspection-debugging` · `ecc-ai-regression-testing` · `ecc-code-tour` · `ecc-codebase-onboarding` · `ecc-coding-standards` · `ecc-plan-canvas` · `ecc-security-review` · `ecc-tdd-workflow`

### 流程方法论（sp-* 系列，9 个）

`sp-brainstorming` · `sp-dispatching-parallel-agents` · `sp-requesting-code-review` · `sp-subagent-driven-development` · `sp-systematic-debugging` · `sp-using-git-worktrees` · `sp-using-superpowers` · `sp-verification-before-completion` · `sp-writing-plans`

### 文档 / 工具

| Skill | 说明 |
|-------|------|
| `docx` | Word 文档生成（OpenXML SDK，.NET） |
| `xlsx` | Excel 工作簿（公式 / 格式 / 校验） |
| `pdf` | PDF 创建 / 检查 / 填表 / 排版（本地 Python 渲染） |
| `pptx-generator` | PowerPoint 生成（PptxGenJS + XML 工作流） |
| `office-design` | 跨格式品牌主题（Word/Excel/PDF/PPT 统一） |
| `skill-creator` | Skill 创建 / 优化 / 评估 |
| `self-improving-agent` | 经验沉淀与纠错捕获 |
| `agent-reach` | 全网调研路由（15 平台多后端） |
| `write-expense-report` | 记账 / 支出报告生成 |

---

## 💬 提示词（prompts/）

| 文件 | 用途 |
|------|------|
| `soul.md` | 昔涟核心人格（性格 / 语气 / 价值观） |
| `canon_quotes.md` | 原作台词基准（完整版，用于语气学习） |
| `canon_quotes_lite.md` | 精简版（常驻注入，1–2 KB） |
| `work_*.md` / `code_*.md` / `learn_*.md` / `chat_*.md` / `phone_*.md` / `plan_*.md` | 六种模式各自的 identity + system + remark |
| `cyrene_harness.md` | 工具循环执行人格（Work / Code 共用） |
| `tool_usage.md` | 工具 / Skill / 子代理统一使用规范 |
| `worldbook/` | 世界观设定（按场景触发注入） |
| `styles/` | 风格变体 |

---

## 🐱 Live2D 桌宠改造（cyrene-furina/）

本目录提供完整的**桌宠模型改造流水线**，让「导入一个 Live2D 模型」不需要重新打包 1.4 GB 的 `app.asar`：

- **外部模型目录**：模型放进 `%APPDATA%\live2d-cyrene\pet-models\<id>\`，设置页填 `<id>`，桌宠立即切换（不打包、不重启）。
- **方案 C 智能调度**：Idle 20–35s 随机触发 + 冷却去抖 + 模型切换监听。
- **拖拽支持**：渲染端 mousedown/move/up → `moveBy` IPC，桌宠可拖动。
- **动作表**：按模型分表（昔涟 / 芙宁娜 / 藿藿），含 motion + expression 映射。

### 流水线脚本

| 脚本 | 作用 |
|------|------|
| `step1_extract.cjs` | 从现网 asar 提取源树 |
| `step2_inject.cjs` | 注入模型 / 设置页 / 动作表 |
| `step3_pack.cjs` | 重新打包 asar |
| `step4_verify.cjs` | 逐条校验（22 项断言） |
| `step5_external_model.cjs` | 外部模型目录改造（幂等） |
| `step6_verify_ext.cjs` | 改造后校验（60 项断言） |
| `deploy_ext.bat` / `deploy_ext.cjs` | 部署（含备份 + sha256 双向校验） |
| `rollback_ext.bat` / `rollback_ext.cjs` | 回滚 |
| `check_scheduler.cjs` | 全量校验（调度器 + 拖拽 + IPC） |
| `apply_chats_patch.cjs` | 会话存储补丁（等长覆写，支持 `--revert`） |
| `sync_patches_to_src.cjs` | 把包内补丁回写源树（重建时保补丁） |
| `install_model.cjs` / `.bat` | 模型导入工具（自动改名 + 自检） |

> ⚠️ 构建产物（`out/app.asar` 1.4 GB、`work/` 1.3 GB、`stage/` 131 MB、`backup/` 2.7 GB）已全部 gitignore，不在仓库中。
> 详见 `cyrene-furina/PROGRESS.md` 与 `PROGRESS-external-model.md`。

---

## ⚙️ 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Cyrene 本体 | 最新稳定版 | 官方渠道获取 |
| Node.js | ≥ 18 | 插件 / MCP 服务 |
| Git | ≥ 2.30 | 部分插件依赖 |
| Windows | 10 1809+ | 主要验证平台 |

## 🚀 安装与使用

1. 安装 Cyrene 本体（官方渠道）。
2. 将 `plugins/` 下的子目录复制到 Cyrene 插件目录（默认 `%APPDATA%\live2d-cyrene\plugins\`），重启客户端。
3. 将 `skills/` 下的子目录复制到 `%APPDATA%\live2d-cyrene\skills\`（或 Cyrene 安装目录的 `skills/`）。
4. 复制 `prompts/` 下的文件到 Cyrene 安装目录的 `prompts/`（覆盖前先备份）。
5. 配置模型：复制 `config/model-config.example.json` → `config/model-config.json`，填入 API Key。
6. MCP 服务：在 Cyrene 对话中说「帮我装 xxx mcp」，或手动调用 `install_mcp_server`。
7. 桌宠改造：按 `cyrene-furina/` 内文档操作（需完全退出 Cyrene 后部署）。

## 📄 许可证

MIT License（见 `LICENSE` 文件）。

Cyrene 客户端本体遵循其原授权协议，本仓库开源内容不改变本体的许可证。
