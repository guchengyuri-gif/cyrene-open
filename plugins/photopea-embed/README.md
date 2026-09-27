# photopea-embed

给 Cyrene 用的插件：在独立窗口里打开 **Photopea**（免费网页版 Photoshop），并支持把本地图片直接送进窗口编辑。

## 为什么是这个做法

| 事实 | 验证方式 |
| --- | --- |
| Photopea 官方 API 就是为「被嵌进别的页面」设计的，免费 | 官方文档 `photopea.com/api`：*Such URL can be opened directly, or used as a `src` of an `iframe`* |
| 它不禁止被 iframe 嵌入 | `curl -I https://www.photopea.com` → **无** `X-Frame-Options`、**无** 拦截性 `Content-Security-Policy` |
| Chromium 内核下确实能嵌 | 实测：`<iframe src="https://www.photopea.com">` 成功加载，frames 中出现 `https://www.photopea.com/`，无 `Refused to display` |
| `file://` 父页面 + iframe 的通信不可靠 | 实测：`file://` 测试页里 Photopea 未回任何 `done` 消息 |

结论：**窗口直接 `loadURL('https://www.photopea.com')`**，而不是「本地 HTML 里套 iframe」。让 Photopea 跑在它自己的 https 源下，功能完整、没有 storage 权限的坑。

## 结构

```text
photopea-embed/
  manifest.json    # 插件元信息
  index.cjs        # 入口：工具注册 + 弹窗管理
  README.md
  _smoke.cjs       # 本地冒烟测试（不影响插件加载，打包时可删）
```

## 安装

插件启用前处于停用状态，不会自动生效。两种装法选一个：

**方式 A：直接复制（开发期）**

```cmd
xcopy /E /I "D:\ai\program\photopea-embed" "%APPDATA%\live2d-cyrene\plugins\photopea-embed"
```

**方式 B：打包成 zip 后从插件面板导入**

```powershell
Compress-Archive -Path "D:\ai\program\photopea-embed\*" -DestinationPath "D:\ai\program\photopea-embed-0.1.0.zip" -Force
```

注意 zip 内必须**直接**是 `manifest.json`、`index.cjs` 这一层，不能再多套一层目录。

装好后到聊天窗口的「插件」面板里启用它。

## 使用

- 插件卡片上点「打开」→ 弹出 Photopea 窗口
- 或者在对话里说「帮我打开 PS / 想修图」，昔涟会调用 `photopea-embed_open` 工具（可带 `imagePath` 直接载入一张图）

## 已知限制

- **送图上限 2MB**：图片是以 base64 data URI 经官方 `#config` 参数传进去的，URL 太长不可靠。更大的图请在窗口里用「文件 → 打开」。
- **窗口安全性**：远程页面以 `nodeIntegration:false` + `contextIsolation:true` + `sandbox:true` 加载，页面里的 JS 拿不到 Node 权限。
- **未在 Electron 内实测**：Chromium 下的嵌入已验证，但「Cyrene 弹窗加载远程 https 页面」这一步只能装上去之后实测。若窗口空白，开发者工具里看是否被主进程的窗口策略拦了。
- Photopea 对个人使用免费；商用授权条款以官方为准。

## 卸载

在插件面板停用即可；不需要时删掉 `%APPDATA%\live2d-cyrene\plugins\photopea-embed\`。
