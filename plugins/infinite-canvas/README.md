# 无限画布 Infinite Canvas · Cyrene 插件

在 Cyrene 里直接打开「无限画布」（canvas.zikl.dev）创作站，并把 ZikL 的生图接口注册成昔涟可以直接调用的工具。

- 插件 id：`infinite-canvas`
- 版本：1.0.0
- 入口：`index.cjs`

## 安装

**方式一（推荐）**：聊天窗口 → 插件 → 右上角「+」→ 选 `infinite-canvas-1.0.0.zip`。
**方式二**：把 `infinite-canvas/` 整个目录复制到 `%APPDATA%\live2d-cyrene\plugins\`。

安装后**默认停用**，需要在插件面板手动点「启用」。

## 首次配置

启用后在对话里对昔涟说：

> 配置无限画布，apiKey 是 sk-xxxx，接口地址用 https://img.mzfe.de/v1

或者点插件卡片的「打开」，在窗口顶部直接填：

| 字段 | 说明 |
| --- | --- |
| 接口地址 | `https://img.mzfe.de/v1` 或 `https://img.zikl.dev/v1`（两者实测等价） |
| API Key | ZikL 的密钥，`sk-` 开头 |
| 输出目录 | 留空则存到 `桌面\无限画布出图` |

> ⚠️ `canvas.zikl.dev` 是**画布网站**，不是 API。API 只有 `img.mzfe.de` / `img.zikl.dev` 两个域名。

## 注册的工具

| 工具 id | 作用 |
| --- | --- |
| `infinite-canvas_open` | 打开无限画布窗口 |
| `infinite-canvas_models` | 列出可用生图模型 |
| `infinite-canvas_balance` | 查账户额度 |
| `infinite-canvas_generate` | 文生图 |
| `infinite-canvas_edit` | 图生图 / 改图（角色一致性差分） |
| `infinite-canvas_config` | 读 / 写插件配置 |

## 实测数据（2026-09-13）

- 可用模型 4 个：`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`、`gpt-image-2.5`、`gpt-image-2`
- 文生图 1024×1024：HTTP 200，约 **34 秒**，返回 b64_json，单张约 **1.5 MB PNG**
- 改图 `/v1/images/edits`：HTTP 200，约 **37 秒**
- 额度端点：`/v1/dashboard/billing/subscription` 可用；`/v1/usage` 返回 404（本插件已规避）

## 已知限制

- **只支持生图**：该站没有对话补全端点，不能当聊天模型用。
- **改图偶发较慢**：`/images/edits` 40~90 秒属正常，插件默认超时 240 秒。
- **画布站的内网配置**：窗口里嵌的 canvas.zikl.dev 有自己的设置面板，需要在那里再填一次 Key——插件无法替它写入（跨域 localStorage 隔离）。
- 密钥存在插件私有存储中，卸载插件默认保留。

## 卸载

插件面板点「停用」或删除目录即可。输出目录 `桌面\无限画布出图` 不会被删除。
