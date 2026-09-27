# 侧栏工作台 · Better Sidebar（v2.2 · 内嵌侧栏）

把 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的核心工作流搬进 **Cyrene 客户端本体**：
一个挂在**聊天窗右侧的内嵌侧栏**——文件树 + 代码编辑器 + 终端 + Git 面板。

```
┌ Cyrene 聊天窗
│   ├─ #cyrene-react-root          ← 原生聊天区（被挤到左侧）
│   └─ #cyrene-workbench-shell     ← 本插件注入的侧栏
│         └─ <iframe> → 127.0.0.1:端口 → ui.html（工作台本体）
│   └─ #cyrene-workbench-launcher  ← 右缘常驻「工作台」按钮（展开/收起都在）
└ 插件主进程（Electron main）
      ├─ HTTP 桥 /api/<channel> → 与 IPC 同一套 handler
      └─ webContents.executeJavaScript：注入 / 收起 / 收回 / 诊断
```

## 怎么打开（三种，随你顺手）

| 方式 | 操作 |
|---|---|
| 常驻按钮 | 聊天窗右缘那个竖排「工作台」胶囊：**单击**切换展开/收起，**右键**切宽度档 |
| 快捷键 | `Ctrl+Shift+B`（聊天窗聚焦时生效，不抢全局快捷键） |
| 跟昔涟说话 | 「打开工作台」「收起侧栏」「侧栏宽一点」 |

## 形态

| 能力 | 说明 |
|---|---|
| 内嵌侧栏 | 注入在 Cyrene 聊天窗右侧，**只有两档宽度，但按聊天窗实际宽度算比例**：窄 = 窗口宽 × 30%、宽 = 窗口宽 × 45%（窗口 2560 时就是 768 / 1152 px）；窗口缩放会自动重算 |
| 入口 | 右缘常驻按钮 + `Ctrl+Shift+B`；收起时 iframe 不销毁，标签与未保存内容都还在 |
| 文件树 | 懒加载、扩展名图标、右键新建/重命名/删除/复制路径/定位 |
| 编辑器 | 多标签、`Ctrl+S` 保存、`Ctrl+W` 关标签、Markdown 源码/预览 |
| 预览 | 图片 / PDF（data URL，适应窗口 / 1:1） |
| 终端 | 管道模式：能跑命令看输出；**不是真 PTY**，`vim`/`top` 用不了 |
| Git | 分支 / upstream / ahead-behind / 变更清单 / diff 增绿删红 |
| 昔涟联动 | 插件工具：开侧栏、把文件推到侧栏、查 Git、改配置、切宽度、看注入诊断 |
| 改动清单 | 常驻规则（prompt provider `change-report`）：昔涟改动文件后，会在回复结尾列出「本次改动」表格，方便你直接在工作台里打开；`changeReport: false` 可关 |

## 通道与实现边界（不粉饰）

- **为什么走 HTTP 桥**：注入进聊天窗的脚本跑在页面主世界，聊天窗的 preload 没有对插件开放的
  `ipcRenderer` 入口，所以「渲染侧 → 主进程」改走本机 HTTP（`127.0.0.1` + 每次会话随机 token，
  只绑回环地址）；「主进程 → 渲染侧」走 `webContents.executeJavaScript`；父文档 → iframe 走
  `postMessage`。三条路都真实存在，测试覆盖。
- **依赖未公开结构**：注入点 `#cyrene-react-root`（聊天窗根节点）不是官方 API。
  Cyrene 大版本升级后可能改名，届时侧栏会注入不上——那时 `better-sidebar_panel` 工具
  的 `status` 会把「没找到 #cyrene-react-root」直接报出来，不会静默失效。
- **挤压策略**：根据根节点的 `position` 自动选 `right: <宽>`（绝对/固定定位）或
  `width: calc(100% - <宽>)`；注入时会**实测**聊天区矩形并写进诊断。
- **没有做**：真 PTY、内嵌浏览器 tab、分栏拖拽、Office 预览、文件变动 watcher。

## 工具（昔涟可调用）

| 工具 id | 用途 |
|---|---|
| `better-sidebar_open` | 展开内嵌侧栏（可选 `root` 指定根目录） |
| `better-sidebar_reveal` | 把文件/目录推到侧栏打开（目录则设为根） |
| `better-sidebar_git_status` | 查仓库 Git 状态（不用开侧栏） |
| `better-sidebar_config` | 读/写配置（根目录、宽度、端口、展开状态…） |
| `better-sidebar_panel` | `show` / `hide` / `toggle` / `width`（窄 ↔ 宽两档）/ `status`（注入诊断，含当前窗口宽与两档 px） |

## 配置

存于 `%APPDATA%\live2d-cyrene\plugin-data\better-sidebar\config.json`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `root` | `""` | 工作台根目录（空则回落用户主目录） |
| `recentRoots` | `[]` | 最近根目录 |
| `panelWidth` | `420` | 宽度**偏好档**（存的是上次选中的 px，实际用的是它按当前窗口宽度吸附到的那一档） |
| `panelPort` | `0` | HTTP 桥端口，0 = 随机 |
| `panelVisible` | `true` | 是否把侧栏挂到聊天窗上（false 则完全不注入） |
| `panelCollapsed` | `false` | 挂上后是展开还是收起 |
| `changeReport` | `true` | 是否启用「回复末尾列本次改动文件」的常驻规则（`false` 关掉） |

注入诊断写在同目录的 `panelStatus.json`。

## 本地自测

```
node _panel_test.cjs     # 33 项：注册 / 注入脚本（微 DOM 真跑，含快捷键与常驻入口）/ HTTP 桥 / 收起展开 / 两档吸附 / 窗口缩放重算 / 常驻规则 / 卸载清理
node _smoke.cjs          # 宿主端冒烟：文件读写 / 搜索 / Git / 终端
```

`_panel_test.cjs` 用**假 electron + 微 DOM**，验证的是逻辑与协议；
真实聊天窗里的像素效果必须在客户端里看一眼。

## 改动了什么（v2.1）

- 宽度从四档（380/420/560/720）收敛为**两档 420 / 720**；指定任意宽度会自动吸附到最近档。
- 右缘「工作台」按钮改为**常驻**：展开时贴在侧栏左缘，收起时贴窗口右缘，永远点得到。
- 新增 `Ctrl+Shift+B` 切换显示，新增 `panel-toggle` 通道（常驻按钮与快捷键共用）。
- `better-sidebar_panel` 工具新增 `width` 动作。

## 文件

| 文件 | 作用 |
|---|---|
| `index.cjs` | 插件入口：工具、通道注册、文件/Git/终端实现 |
| `panel.cjs` | 内嵌侧栏宿主：HTTP 桥 + 注入脚本 + 窗口钩子 |
| `ui.html` | 工作台前端（内嵌模式与独立窗口模式共用） |
| `_deploy.cjs` | 把本目录部署到 `%APPDATA%\live2d-cyrene\plugins\better-sidebar` 并核对哈希 |
