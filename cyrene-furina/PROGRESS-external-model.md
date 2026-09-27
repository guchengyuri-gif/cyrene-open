# Cyrene 桌宠模型 · 外部模型目录改造 + 方案 C 智能调度（Idle 循环 + 拖拽 + 藿藿动作表）

> 更新：2026-09-27 01:35
> 状态：**已构建并通过全量校验（check_scheduler.cjs 全 PASS ✅），待关闭 Cyrene 后运行 `deploy_ext.bat` 部署**
> keywords: cyrene, live2d, 外部模型目录, pet-models, cyrene-model 协议, 免打包, 导入模型, app.asar, petModel
> 目的：让「导入一个 Live2D 模型」不再需要重新打包 1.4 GB 的 `app.asar`

## 一句话状态

新包 `D:\ai\program\cyrene-furina\out\app.asar`（**1,492,684,333 字节**，2026-09-27 01:33 重打）
= 上一版 external-model 包 + 4 处「方案 C 智能调度」补丁：

1. **藿藿动作表**（`live2d-actions.js` ×2，main + preload）：11 个动作（7 motion + 5 expression）
2. **渲染端拖拽脚本**（`renderer/index.html`）：mousedown/move/up → `moveBy` IPC，桌宠可拖拽
3. **主进程 ActionScheduler**（`application/default-dependencies.js`）：Idle 20-35s 随机触发 + 冷却去抖 + 模型切换监听
4. **藿藿 model3.json 补全**（外部文件 `%APPDATA%\live2d-cyrene\pet-models\huohuo\`）：注册 7 motion + 5 expression 进 `FileReferences`

校验：`check_scheduler.cjs` **全 PASS ✅**（藿藿动作表 22 项 + 拖拽 6 项 + 调度器 9 项 + IPC 通道 6 项 + preload API 4 项 + model3.json 13 项 = 60 项断言全过）。

> 补充（2026-09-27）：跨包核对历次补丁时发现，09-15 的两个补丁早已不在现网（重编译 `dist/main` 时被冲掉）——
> `chats-store.js`（会话存储：单会话缓存 + 紧凑序列化 + 去冗余 reasoning）与 harness token 补丁
> （`tool-round.js` 去三副本 / `tool-dispatcher.js` 截断阈值 30K→8K）。
> 已用等长原地覆写补进本包（asar 体积分毫未变），并同步回 `work/src`。

部署后：把模型目录放进 `%APPDATA%\live2d-cyrene\pet-models\<id>\`，在设置页填 `<id>`，
**桌宠立即切换 —— 不打包、不重启**。

---

## 1. 改了什么（3 个文件）

| 文件 | 改动 |
|---|---|
| `dist/main/main/protocols/bootstrap.js` | 新增特权协议 `cyrene-model` + 对应 handler |
| `dist/renderer/assets/renderer-DtFVcmkW.js` | `hx()` 返回 `cyrene-model://pet/<id>/<Cap>.model3.json`；调用点去掉 `ef()` 包装 |
| `dist/renderer/settings/index.html` | 桌宠模型 `<select>` → `<input list="pet-model-presets">` + `<datalist>` |

## 1.5 本轮新增（2026-09-27 · 方案 C 智能调度）

| 文件 | 改动 |
|---|---|
| `dist/main/shared/live2d-actions.js` | `LIVE2D_MODEL_ACTIONS` 加 `huohuo:` 表（11 动作：回正/歪头/点头/叹气/流泪/灵魂出窍/拿旗子 + 5 expression） |
| `dist/preload/shared/live2d-actions.js` | 同上（preload 副本） |
| `dist/renderer/index.html` | Live2D canvas 注入拖拽脚本：mousedown → `setInteractive(true)` + `setDragging(true)`；mousemove → `moveBy(dx, dy)`；mouseup → 恢复穿透；3px 阈值防误触 |
| `dist/main/main/application/default-dependencies.js` | 文件中段追加 `startLive2dActionScheduler()` 工厂：每 20-35s 随机挑一个非回正动作触发；冷却 3s 去抖；监听 `PET_MODEL_CHANGED` 切换模型时重启循环；无动作表模型自动降级不触发 |
| `Huohuo.model3.json`（外部文件） | `FileReferences.Motions` 加「动作」组（7 motion）；`FileReferences.Expressions` 加 5 expression；`Groups.Idle` 指向「动作」组 |

### 调度器行为

- **Idle 循环**：每 20-35 秒随机挑一个非「回正」动作触发，让桌宠不聊天时也有生命感
- **冷却去抖**：同一 action target 3 秒内不重复触发（防 Idle 循环和我主动调 `play_live2d_action` 撞车）
- **模型切换**：监听 `PET_MODEL_CHANGED`，切换后立即重启 timer（不用等 20-35s）
- **降级**：模型没有动作表（fuxuan/jingliu/kafuka/furina_vts）时自动不触发，不报错
- **Map 防膨胀**：`lastFired` 条目 60s 后自动清空

### 拖拽行为

- 鼠标按住桌宠 canvas 左键拖动 3px 以上 → 进入拖拽态（关穿透 + 光标 grabbing）
- 拖动中 → `moveBy(dx, dy)` 让主进程相对移动窗口
- 松手 → 恢复穿透 + 光标恢复
- 主进程 `movePetWindowTo` 已内置多显示器边界校验 + 坐标持久化，拖完重启不丢位置

### 为什么必须去掉 `ef()`

渲染层原本写的是 `const t = ef(hx(r))`，而 `ef`（来自 `renderer-base-*.js` 的 `r` 导出）实现是：

```js
function i(r){const t=r.replace(/^\/+/,"");return o()+t}   // o() = file:///.../dist/renderer/
```

**它只是字符串拼接**。若让 `hx()` 直接返回 `cyrene-model://…`，会被拼成
`file:///…/dist/renderer/cyrene-model://…` 从而彻底失效。所以调用点改成 `hx(r)` 直连。

同时已确认 `Yv.loadModel()` 对 `modelPath` **不做任何加工**（`Nv.from(t)` 与 `fetch(t)` 都直接用），
所以协议 URL 能一路走到 XHR / fetch。

### 协议查找顺序

```
cyrene-model://pet/<id>/<file>
  → 1) %APPDATA%\live2d-cyrene\pet-models\<id>\<file>      （外部，优先）
  → 2) <app.asar>\dist\renderer\models\<id>\<file>          （asar 内置，回退）
```

内置的 `cyrene` / `furina` 照常可用；外部放了同名模型就会覆盖内置的。

---

## 2. 导入一个模型（3 步）

### 命名规则（唯一要记的一件事）

模型 ID 只允许 `[A-Za-z0-9_-]`，并且 model3.json 必须叫 **「ID 首字母大写」**：

| 模型 ID | 目录 | 必须存在的文件 |
|---|---|---|
| `cyrene` | `pet-models\cyrene\` | `Cyrene.model3.json` |
| `furina` | `pet-models\furina\` | `Furina.model3.json` |
| `My_Model` | `pet-models\My_Model\` | `My_Model.model3.json` |

> model3.json **内部**引用的 moc3 / texture / motion 文件名**不用改**，保持原样。

### 方式 A：用脚本（推荐，自动改名 + 自动校验）

```
node D:\ai\program\cyrene-furina\install_model.cjs "D:\你的模型目录" [模型ID]
```

或者把模型目录**直接拖到** `install_model.bat` 上。模型 ID 省略时会从目录名推断。

### 方式 B：手动

1. 新建 `%APPDATA%\live2d-cyrene\pet-models\<id>\`
2. 把模型文件全部复制进去
3. 把 `xxx.model3.json` 改名为 `<Id首字母大写>.model3.json`
4. Cyrene → 设置 → 桌宠模型 → 填 `<id>` → 回车（桌宠立即重载）

---

## 3. 部署 / 回滚

1. **完全退出 Cyrene**（托盘图标右键 → 退出；改 asar 前必须关闭）
2. 双击 `deploy_ext.bat`
   - 自动：检查进程 → 备份现网 asar 到 `backup\app.asar.before-external-model` → 复制 → sha256 双向校验
3. 启动 Cyrene 验证：默认昔涟、切芙宁娜、导入外部模型

回滚：双击 `rollback_ext.bat`（同样先退出 Cyrene）。
回滚点 = 当前现网的芙宁娜包，回滚后完全恢复原状；`pet-models` 目录不会被删。

---

## 4. 校验证据（已全部实测）

**本地 Electron 43.1.0 实验台（lab v3，模拟 pet 窗口：`file://` + contextIsolation）**

| 项目 | 结果 |
|---|---|
| 协议读外部目录（含 `My_Model` 这种大写+下划线 ID） | ✅ 200，path 大小写/下划线完整保留 |
| 协议回退读 asar 内文件 | ✅ 200 |
| 协议返回 PNG 二进制（XHR arraybuffer） | ✅ 200，bytes=70 |
| 编码穿越 `..%2F..%2F` 攻击 | ✅ 403 拦下 |
| 缺失模型 | ✅ 404 |
| `fetch` / `XMLHttpRequest` 两条通道 | ✅ 都通 |

**新包全量校验（step6_verify_ext.cjs → PASS ✅）**

- 条目数 53540，与现网一致；`only in OLD = 0`、`only in NEW = 0`
- `content differs = 6`，恰好是 3 个改造文件 + 3 个补丁文件（chats-store / tool-round / tool-dispatcher）
- 补丁在位（逐条断言）：chats-store v2（缓存·紧凑·去冗余）、tool-dispatcher 阈值 8K、tool-round 去三副本、
  task-runtime onEvent 批处理、task-session-store 紧凑落盘
- 旧功能回归：furina 26 条 / cyrene 21 条 / 两份动作表 —— 全部保留
- 三处改造标记逐条断言通过

---

## 5. 风险与注意

- **Cyrene 自动更新/重装会冲掉这个改造**（和芙宁娜、卡顿补丁同命运）。更新后按顺序重跑：
  `step5_external_model.cjs`（幂等，可重复跑）→ `step3_pack.cjs` → `step6_verify_ext.cjs` → `deploy_ext.bat`。
- **外部模型目录在 `%APPDATA%` 下，升级不会动它**，所以模型只需放一次，之后只补 asar。
- 模型 ID 里非 `[A-Za-z0-9_-]` 的字符会被过滤；过滤后为空则回退到 `cyrene`。
- `pet-models` 中的同名模型会**覆盖** asar 内置模型（有意设计，方便自己改昔涟而不动 asar）。
- 模型版权归原作者，请自行注意使用范围。

---

## 6. 文件清单

| 路径 | 说明 |
|---|---|
| `out\app.asar` | **最终产物**（1,492,670,258 B） |
| `install_model.cjs` / `.bat` | 模型导入工具（自动改名 + 自检） |
| `deploy_ext.bat` / `deploy_ext.cjs` | 部署（含备份 + sha256 双向校验） |
| `rollback_ext.bat` / `rollback_ext.cjs` | 回滚 |
| `step5_external_model.cjs` | 改造脚本（幂等，作用于 `work/src`） |
| `apply_chats_patch.cjs` | chats-store 补丁等长写入 / 还原（支持任意 asar 路径，`--revert` 回滚） |
| `sync_patches_to_src.cjs` | 把包内已打补丁的 3 个文件回写 `work/src`（重建时保补丁） |
| `check_patches.cjs` / `check_all_patches.cjs` | 补丁在位核查（单个包 / 跨包全量对照历次备份） |
| `step6_verify_ext.cjs` | 产物校验（逐条对比现网） |
| `check_patch.cjs` | 源树改造自检 |
| `backup\app.asar.before-external-model` | 部署时生成的回滚点 |
| `backup\src_before_external_model\` | 改造前的 3 个源文件 |
| `lab\` | Electron 实验台（协议可行性验证，可删） |
