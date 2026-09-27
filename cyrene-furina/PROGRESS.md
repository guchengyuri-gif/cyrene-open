# Cyrene 桌宠模型 · 芙宁娜（vts）导入

> 更新：2026-09-26 22:35
> 状态：**已构建完成并通过全量校验，待用户关闭 Cyrene 后双击 `deploy.bat` 部署**
> keywords: cyrene, live2d, 芙宁娜, furina, 桌宠, 模型, petModel, app.asar, 卡顿补丁, vts, 多模型
> 用途：把芙宁娜 vts 版 Live2D 模型打进 Cyrene 的 `app.asar`，同时保留多模型修复与 09-26 卡顿补丁。

## 一句话状态

新包已构建并通过**全量逐条校验**：
`D:\ai\program\cyrene-furina\out\app.asar`，1,492,668,664 字节，sha256 `a14efa203640a3dc4e958d5518f0f05e3125174606d4ee17173544185ea0b17c`。
内含 furina 模型 + 设置页选项 + 动作表，且**多模型修复与卡顿补丁完整保留**（不是二选一）。
部署动作需要用户在 Cyrene 完全退出后自己按一下（`deploy.bat`）——因为替换的是 Cyrene 正在运行的那个文件。

## 1. 关键事实（全部实测，非推断）

| 事实 | 结论 |
|---|---|
| `models/` 只收 id 为 `[A-Za-z0-9_-]` 的目录，加载路径死板 | `petModel="furina"` → 只读 `models/furina/Furina.model3.json`（渲染层 `hx()`） |
| 设置页下拉是硬编码 HTML，不扫描已装模型 | 必须手改 `dist/renderer/settings/index.html` |
| `petModel` 无白名单 | facade 只校验非空字符串；IPC 收到即存盘并通知桌宠重载 |
| 动作表按模型分表，未知模型回退昔涟表 | `LIVE2D_MODEL_ACTIONS`，在 `dist/main/shared/` 与 `dist/preload/shared/` 各一份（内容相同） |
| 动作解析靠 `Name` 字段 | `motionIndexMap` = `{group: Map(Name→index)}`；expression 也按 Name 匹配 |
| 待机动画由名为 **`Idle`** 的动作组驱动 | `MotionManager.groups = { idle: "Idle" }`，运动结束后 `startRandomMotion("Idle")` |
| moc3 内核兼容 | furina 与 cyrene 的 moc3 都是 **MOC3 v5** |
| 渲染层模型加载失败**不会崩** | 只 `console.warn/error`，界面表现为空白桌宠 |

## 2. 做了什么

1. **提取干净源**：从**现网安装版** asar（19:15，含多模型修复 + 已打补丁的 task-trace）`extractAll` 到 `work/src`（53,514 文件 / 1.28GB）。
   - ⚠️ 没有用旧的 `D:\ai\program\cyrene-asar-extract`：那份 `dist/main` 是**未打补丁**的旧镜像，且夹带 `dist-backup-pre-multimodel/`（197MB 垃圾）。
2. **组装 furina 模型**（`stage/furina/` → `work/src/dist/renderer/models/furina/`）：
   - 从 vts 版复制：`芙宁娜.moc3→furina.moc3`、`芙宁娜.physics3.json→furina.physics3.json`、`芙宁娜.cdi3.json→furina.cdi3.json`、`芙宁娜.8192/texture_00.png→furina.8192/texture_00.png`，`motions/` 4 个、`expressions/` 17 个（中文名保留，昔涟模型也是中文名，实测可行）。
   - 新写 `Furina.model3.json`：补上原文件缺失的 `Motions`（`Idle`=待机动画 / `Tap`=摊手+变芒+变荒）与 `Expressions`（17 个），`Groups` 保留 LipSync 并**新增 EyeBlink**（`ParamEyeLOpen/ParamEyeROpen`，cdi3 确认存在）。
3. **设置页**：在 `#pet-model` 已选项后插入 `<option value="furina">芙宁娜</option>`。
4. **动作表**：给 `LIVE2D_MODEL_ACTIONS` 加 `furina` 表（保留 10 个原 alias，映射到芙宁娜实际资源），两份 JS 均过 `node --check`。
5. **重新打包**：`@electron/asar` `createPackage`（48.6s）。

## 3. 校验证据（step4_verify.cjs，结论 PASS）

- furina 条目 26 个；model3 内 25 个引用**全部解析成功**（missing 0）
- `[PATCH] task-runtime onEvent batched: true` / `task-session-store compact: true` / 原始 marker 已消失
- 设置页 `value="furina"` 与 `value="cyrene"` 同时存在
- 两份动作表都含 `furina:` 表
- **与现网安装版逐条内容对比：`only in OLD = 0`、`content differs = 0`、`only in NEW = 26（恰好 furina）`**

## 4. 部署 / 回滚

1. **完全退出 Cyrene**（托盘图标右键 → 退出；当前有 8 个 Cyrene 进程）
2. 双击 `D:\ai\program\cyrene-furina\deploy.bat`
   - 自动：查进程 → 备份现网 asar 到 `backup\app.asar.before-furina` → 复制 → **sha256 双向校验**
3. 启动 Cyrene → 设置 → 桌宠模型 → 选「**芙宁娜**」（会立即重载桌宠）
4. 回滚：`rollback.bat`（同为关掉 Cyrene 后运行）

## 5. 风险与注意

> 2026-09-27 补充：本目录的产物已升级为 `out/app.asar`（外部模型版），并在其中补齐了 09-15 的两个补丁
> （chats-store 会话存储 / harness token）。新包 sha256 `165DAE43…352B6F`，详见 `PROGRESS-external-model.md`。

- **Cyrene 每次自动更新/重建 asar 都会冲掉本改动**（与 09-26 卡顿补丁同命运），需重跑本目录流程。
- 体积：新包 1.39GB（+131MB）。`work/src` 占 1.3GB、`stage` 131MB，可删（重建时跑 step1~3 即可）。
- 芙宁娜**没有**昔涟那套表情（墨镜/问号/闪耀等），动作表里的 alias→资源 映射是**近似**的，不是语义完全对应。
- 模型版权属米哈游，作者注明仅限个人使用、禁止商用与二次配布。

## 6. 文件清单

| 路径 | 说明 |
|---|---|
| `out\app.asar` | **最终产物**（1,492,668,664 B） |
| `stage\furina\` | 组装好的模型目录（含自写的 Furina.model3.json） |
| `work\src\` | 提取的源树（已注入，供重建） |
| `step1_extract.cjs` / `step2_inject.cjs` / `step3_pack.cjs` / `step4_verify.cjs` | 可重跑的四步流水线 |
| `deploy.bat` / `deploy.cjs` / `rollback.bat` / `rollback.cjs` | 部署与回滚 |
| `probe_*.cjs` / `check_state.cjs` / `inspect_asar.cjs` | 诊断脚本（可删） |
