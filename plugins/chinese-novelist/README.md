# Chinese Novelist (中文长篇小说创作助手)

基于开源项目 [PenglongHuang/chinese-novelist-skill](https://github.com/PenglongHuang/chinese-novelist-skill)（v2.0 重构版）构建的 Cyrene 客户端原生插件。

## ✨ 核心亮点

- 🎯 **三层递进式问答**：Layer 1 核心定位（题材/主角/冲突，必答）+ Layer 2 深度定制（世界观/视角/基调，可选）+ Layer 3 爆款书名生成。
- 📋 **规划体系标准化**：自动生成 7 列章节规划大纲、三维人物小传档案以及机器可读的 `02-写作计划.json`。
- 🧠 **跨项目偏好记忆**：自动维护 `user-preferences.json`，跨工程记忆你的创作倾向。
- ⏸️ **断点智能续写**：长篇中途中断后，自动检测未完成进度并从断点继续连载。
- 🔍 **章节深度质检引擎**：
  - 纯汉字量计算（过滤 Markdown 标签与代码，达标区间 3000-5000 字）
  - 24 种去 AI 味套路表达扫描（“这一刻”、“心中不禁”、“深吸一口气”等）
  - 章尾 300 汉字悬念断章钩子评估与拉力打分
- 🎨 **可视化控制台**：自带独立设置与质检看板窗口，支持章节实时质检与目录一键直达。

## 🛠️ 注册的 Agent 工具

| 工具名 | 说明 |
| :--- | :--- |
| `chinese-novelist_get_guide` | 获取创作阶段指引（Phase 0 至 Phase 4 全流程规范与 Prompt 模板） |
| `chinese-novelist_get_technique` | 获取大师级网文技法手册（悬念十三式、去 AI 味禁忌、人物塑造、对话博弈等） |
| `chinese-novelist_init_project` | 一键初始化小说工程目录并生成大纲、档案与写作计划骨架 |
| `chinese-novelist_audit_chapter` | 章节字数达标度与去 AI 味深度质检审计 |
| `chinese-novelist_manage_plan` | 维护 `02-写作计划.json` 状态机与断点定位 |
| `chinese-novelist_preferences` | 读取与更新跨工程共享的用户创作偏好记忆 |
| `chinese-novelist_list_projects` | 扫描并列出工作区内所有小说工程的连载进度与字数 |

## ⚖️ 许可

基于原项目 MIT 许可证授权。
