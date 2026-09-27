# Obsidian Notes Creator 插件

为 Cyrene 原生打造的 **专业双链考点学习笔记生成器与 Obsidian 知识库全功能工具箱**。

无需外部子进程，直接通过 Obsidian Local REST API 与本地 Obsidian 知识库极速联动，提供结构化双链考点笔记制作、全文检索、增删查改及当前活跃笔记感知等能力。

---

## 核心亮点

1. **工业级 6 段式双链笔记格式**：
   - 自动生成 YAML Frontmatter（Title、Date、Tags 双链索引）
   - 🗺️ **全景逻辑脑图**（Mermaid Flowchart 知识架构）
   - 💡 **核心要点解析**（精准考点切片 + 考查频次与深度解析）
   - ⚖️ **核心概念辨析表**（易混概念多维对比表）
   - ❓ **深度复习思考题**（基础记忆、进阶法理、反思辨析三层设问）
   - 📅 **7天落地执行与复习打卡清单**（艾宾浩斯复习节奏打卡）
2. **知识库全功能矩阵**：
   - 读写、覆盖、追加笔记
   - 知识库目录结构树浏览
   - 毫秒级知识库全文搜索
   - 实时感知 Obsidian 当前打开的笔记（无需手动复制代码）
3. **零进程损耗，随启随用**：
   - 原生 Node.js 运行时直连本地 API，不占额外内存，开箱即用。

---

## 工具列表

| 工具 ID | 名称 | 权限模式 | 说明 |
| :--- | :--- | :--- | :--- |
| `obsidian-notes-creator_create_study_note` | 生成双链考点笔记 | `write` | 组装 6 段式结构化双链笔记并存入知识库 |
| `obsidian-notes-creator_get_active_note` | 获取当前活动笔记 | `safe` / `read` | 读取 Obsidian 当前正在浏览的文档内容 |
| `obsidian-notes-creator_search_notes` | 全文搜索笔记 | `safe` / `read` | 在整个知识库中搜索关键词或考点 |
| `obsidian-notes-creator_read_note` | 读取笔记全文 | `safe` / `read` | 读取指定相对路径的 Markdown 文本 |
| `obsidian-notes-creator_write_note` | 写入或覆盖笔记 | `write` | 创建或覆盖单篇笔记（自动补全目录） |
| `obsidian-notes-creator_append_note` | 追加内容到笔记 | `write` | 向已有笔记末尾追加重点或补充 |
| `obsidian-notes-creator_vault_list` | 列出目录内容 | `safe` / `read` | 浏览知识库子目录及文件树 |

---

## 安装方式

1. **直接导入**：在 Cyrene 聊天窗口左下角打开「插件面板」→ 点击「导入插件」→ 选择 `obsidian-notes-creator.zip`。
2. **解压导入**：将 `obsidian-notes-creator` 文件夹直接放入 `%APPDATA%\live2d-cyrene\plugins\` 目录中并刷新。
