# Cyrene 客户端（开源版）

> 基于 Electron 的 AI 伴侣客户端，内置「昔涟」人格，支持对话、工具调用、Live2D 桌宠、插件扩展与记忆系统。

## ⚠️ 本体归属声明

- 本仓库开源内容仅为 **用户侧扩展**：插件、Skill、提示词、工程脚手架、MCP 服务。
- **Cyrene 客户端本体**（`Cyrene.exe` + `app.asar`）由原作者维护，**不在本仓库范围内**，请通过官方渠道获取。
- 本仓库所有扩展均依赖特定版本的 Cyrene 本体（当前验证版本：见 `app.asar` 构建时间戳）。

---

## 📦 仓库结构

```
cyrene-open/
├── README.md              # 本文件
├── LICENSE                # MIT
├── .gitignore
├── plugins/               # 插件（每个子目录一个插件，含 cyrene-plugin.json）
│   ├── dsh-bridge/        #   DSH 桌面端协作桥（文件信箱）
│   ├── better-sidebar/    #   侧栏工作台（文件树+编辑器+终端+Git）
│   ├── ripples-of-aion/   #   岁月涟漪记忆（回忆/检索/时间线）
│   ├── progress-inject/   #   项目进度索引自动注入
│   ├── task-board/        #   任务看板
│   └── self-improving-agent/  # 经验沉淀与纠错捕获
├── skills/                # Skill（可启用的能力包，invoke_skill 按需加载）
│   ├── cyrene-diagram/    #   SVG 学习卡片设计契约
│   ├── cyrene-original-voice/  # 原作语气校准
│   ├── cyrene-plugin-dev/ #   插件开发指南
│   ├── cyrene-work-hygiene/    # Work 模式多文件交付规范
│   ├── agent-reach/       #   全网调研路由
│   ├── docx/ xlsx/ pdf/ pptx/  # Office 文档生成
│   ├── skill-creator/     #   Skill 创建/优化
│   └── self-improving-agent/
├── prompts/               # 提示词（角色/模式/风格）
│   ├── soul.md            #   昔涟核心人格
│   ├── canon_quotes.md    #   原作台词基准
│   ├── canon_quotes_lite.md  # 精简版（常驻注入）
│   ├── work_*.md / learn_*.md / code_*.md / chat_*.md / phone_*.md / plan_*.md
│   ├── cyrene_harness.md  #   工具循环执行人格
│   ├── tool_usage.md      #   工具使用规范
│   ├── worldbook/         #   世界观设定
│   └── styles/            #   风格变体
├── mcp-servers/           # 本地 MCP 服务（install_mcp_server 接入）
│   ├── agent-reach/       #   全网调研多后端路由
│   ├── deepsb-imagegen/   #   GPT-Image 文生图/图生图
│   ├── firecrawl-lite/    #   网页抓取/搜索
│   ├── obsidian-vault/    #   Obsidian vault 读写
│   ├── chinese-novelist/  #   中文小说生成
│   ├── screenwriting/     #   剧本写作
│   ├── behind-eyes/       #   行为分析
│   └── grok-imagegen/     #   Grok 图像生成
├── cyrene-furina/         # Live2D 桌宠改造脚手架（芙宁娜外部模型目录）
│   ├── deploy.bat / deploy.cjs
│   ├── step1_extract.cjs ... step6_verify_ext.cjs  # 提取→注入→打包→校验
│   ├── check_scheduler.cjs  # 全量校验
│   ├── PROGRESS.md / PROGRESS-external-model.md
│   └── out/app.asar       # 构建产物（1.4GB，已 gitignore）
├── scripts/               # 辅助脚本（补丁/探针/扫描）
├── config/                # 配置示例（无密钥）
│   ├── model-config.example.json
│   └── image_channels.example.json
└── docs/                  # 文档
    ├── ARCHITECTURE.md    #   架构说明
    ├── PLUGIN-API.md      #   插件 API 参考
    └── SKILL-GUIDE.md     #   Skill 开发指南
```

---

## 🧩 主要功能

### 一、对话与人格

- **可定制 AI 人格**：内置昔涟人格，通过 `soul.md` + `canon_quotes*.md` + WorldBook + 三层记忆持续塑造；
- **多模式切换**：Work / Learn / Code / Chat / Phone / Plan 六种模式，各有独立提示词与工具集；
- **多模型路由**：支持 DeepSeek 等模型，配置见 `config/model-config.example.json`；
- **流式回复**：打字机效果 + Markdown 渲染；
- **语音合成**：TTS 接入（GPT-SoVITS 等）；
- **多会话管理**：按项目分组，支持历史对话语义检索。

### 二、工具生态

- **本地文件工具**：读写文件/目录/图片/网页，带权限档位（只读 / 受限写 / 完全访问）；
- **Shell 与验证**：Windows cmd / Git Bash 双 shell，后台任务（`shell_job`）、代码验证（typecheck/test/build/lint）；
- **代码智能**：AST 搜索与改写（ast-grep）、全文正则/字面搜索、跨会话检索；
- **联网能力**：网页搜索、抓取（含 Firecrawl MCP）、URL 下载；
- **Office 文档生成**：Word / Excel / PDF / Markdown，内置多种预设风格；
- **MCP 扩展**：`install_mcp_server` 一行接入任意 MCP 服务；
- **技能系统（Skill）**：`invoke_skill` 按需加载能力包。

### 三、插件系统

- **Cyrene 插件框架**：TypeScript 插件，通过 `window.CyreneBridge` 与宿主通信；
- **插件清单**：每个插件一个子目录 + `cyrene-plugin.json`；
- **本仓库内置插件**：
  - `dsh-bridge`：与 DSH 桌面端的文件信箱协作桥（to-cyrene / to-dsh）；
  - `better-sidebar`：聊天窗右侧内嵌工作台（文件树 + 编辑器 + 终端 + Git）；
  - `ripples-of-aion`：岁月涟漪记忆插件（回忆/检索/时间线/遗忘）；
  - `progress-inject`：项目进度索引自动注入（按关键词命中展开 `PROGRESS*.md`）；
  - `task-board`：任务看板可视化；
  - `self-improving-agent`：经验沉淀与纠错捕获。

### 四、记忆系统

- **三层记忆**：
  - L0 核心画像（用户长期信息：称呼、职业、兴趣、语言）；
  - L1 近期状态（当前目标、偏好、项目）；
  - L2 对话记忆（带 slug 的片段，支持全文读取）；
- **语义检索**：`user_memory` / `recall_history` / `imported_docs`（已导入文档）；
- **岁月涟漪**：`ripples-of-aion` 插件提供跨会话回忆、实体属性时间线、主动遗忘；
- **记忆写入**：`write_memory` 支持按 L0/L1/L2 分层写入。

### 五、Live2D 桌宠

- **Live2D 模型加载**：`Live2D_Furina_v2`（芙宁娜）等模型，支持外部模型目录改造；
- **动作表**：眨眼、戴墨镜、星星眼、圈圈眼、开心眼、闪闪发光、问号等；
- **智能调度**：Idle 循环 + 拖拽 + 动作表（见 `cyrene-furina/PROGRESS-external-model.md`）；
- **桌宠联动**：`play_live2d_action` 工具调用，与对话自然联动。

### 六、多模态能力

- **视觉模型 Hub**：`vision-hub` 插件支持多 profile 轮转（OpenAI 兼容 API），用于图片识别/分析；
- **图像生成**：接入 GPT-Image（带派 API），支持文生图 + 图生图编辑（角色一致性立绘差分）；
- **音频**：TTS 语音合成、`read_image_url` 公网图片直读。

### 七、工程化能力

- **Git 工具链**：`git_status/diff/log/commit/switch_branch/push/revert`，侧栏工作台内嵌 Git 面板；
- **DSH 协作桥**：`dsh-bridge` 插件实现与 DSH 桌面端的文件信箱协作，支持归档、连接器管理；
- **侧栏工作台**：`better-sidebar` 在聊天窗右侧注入内嵌侧栏，支持文件树、代码/Markdown 编辑器、终端、Git 状态；
- **项目进度登记**：`progress-inject` 插件自动索引磁盘上的 `PROGRESS*.md`，按关键词命中展开；
- **任务看板**：`task-board` 插件可视化多任务状态。

---

## 🚀 安装与使用

### 前置条件

1. **Cyrene 客户端本体**（通过官方渠道获取，不在本仓库）；
2. **Node.js ≥ 18**（插件/MCP 服务依赖）；
3. **Git**（部分插件依赖 Git 操作）。

### 安装插件

将 `plugins/` 下的子目录复制到 Cyrene 插件目录（默认 `%APPDATA%/Cyrene/plugins/`），重启客户端即可。

### 安装 MCP 服务

在 Cyrene 对话中直接说「帮我装 xxx mcp」，或手动调用 `install_mcp_server` 工具。

### 配置模型

复制 `config/model-config.example.json` 到 `config/model-config.json`，填入 API Key。

### Live2D 桌宠改造

```bat
cd cyrene-furina
deploy_ext.bat
```

详见 `cyrene-furina/PROGRESS-external-model.md`。

---

## ⚙️ 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Cyrene 本体 | 最新稳定版 | 官方渠道获取 |
| Node.js | ≥ 18 | 插件/MCP 服务 |
| Git | ≥ 2.30 | 部分插件依赖 |
| Windows | 10 1809+ | 主要验证平台 |

---

## 📄 许可证

MIT License（见 `LICENSE` 文件）。

Cyrene 客户端本体遵循其原授权协议，本仓库开源内容不改变本体的许可证。

---

## 🙏 致谢

- Cyrene 本体开发团队
- Electron 社区
- 各 MCP 服务上游项目
