# progress-inject —— 项目进度注入

## 这个插件解决什么问题

Cyrene 的插件系统**没有「新开对话」事件**（宿主只提供 `host:plugins:ready`、`host:plugins:stopping`、`host:turn:started/finished`、`host:tool:finished`、`host:scheduler:finished`）。
而新开一个对话 = 全新上下文，旧对话的原文一个字都不会自动进来。

结果就是：长项目（gal、小说）一换对话就「断片」，而且靠记忆恢复的数字还可能过时。

本插件换了个思路：**不追「新对话」这个事件，而是在每一轮对话开始时，把磁盘上的进度文件直接喂给昔涟。**

## 工作机制

```
后台线程（每 60 秒一次，不占用对话轮次）
  └─ 扫描 D:\ai\program，找出所有 PROGRESS.md
       └─ 只认带 `> keywords:` 行的文件（本项目约定的显式标记）

每轮对话开始时（prompt provider，只读内存缓存，实测 0~1ms）
  ├─ 用户这句话命中了某个项目的 keywords → 注入该文件全文（单项目上限 6000 字符）
  ├─ 没命中，且模式是 work / learn / code → 注入一份简短索引（上限 1500 字符）
  └─ 没命中，且模式是 chat → 注入空字符串（不打扰闲聊）

工具
  ├─ progress-inject_list  查看扫到了哪些进度文件
  └─ progress-inject_write 把进度写回项目根目录（覆盖前自动存 .bak）
```

## 安装位置与文件

| 项 | 路径 |
| --- | --- |
| 源码（本仓库） | `D:\ai\program\cyrene-plugins\out\progress-inject\` |
| 安装后 | `%APPDATA%\live2d-cyrene\plugins\progress-inject\` |
| 冒烟测试 | `D:\ai\program\cyrene-plugins\_src\smoke-progress-inject.cjs` |

安装 = 把本目录复制到插件目录（等价于 zip 导入），然后在聊天窗口的「插件」面板里**手动启用**（新导入的插件一律默认停用）。

## PROGRESS.md 的格式约定

插件靠 `> keywords:` 这一行做匹配，**这一行不能少**（write 工具会拒绝写入缺少它的内容）。

```markdown
# <项目名> 进度

> 更新：2026-09-13
> keywords: <6~12 个逗号分隔的触发词>
> 状态：进行中 / 暂停 / 已完成

## 一句话状态
<一句话说清现在做到哪了>      ← 索引模式只注入这一句

## 已完成
- ...

## 进行中（下一步做什么）
- ...

## 待决 / 卡点
- ...

## 关键约定
- ...
```

匹配规则：用户这句话里**包含**任一 keyword 子串即算命中（大小写必须一致，中文天然一致）。
`keywords` 行留空时，退化为用所在目录名当关键词。

## 想改扫描范围

改 `index.cjs` 顶部的 `DEFAULT_CONFIG.roots`（支持多个根目录），然后：

- 在插件面板点「刷新插件」，或
- 停用再启用该插件

其他可调项：`maxDepth`（下探层数）、`refreshSeconds`（重扫间隔）、`maxFullChars`（单项目全文上限）。

## 已知边界

- **只扫 `PROGRESS.md` 这一个文件名**，且必须带 `> keywords:` 行；其他名字的进度文件不会被注入。
- **扫描是启发式的、不是索引**：`maxDepth: 3`，且跳过 `node_modules` / `.git` / `dist` / `build` / `templates` 等目录，以及以 `.` 或 `_` 开头的目录。若项目埋得更深，需调大 `maxDepth`。
- **提供的是「事实」，不是「指令」**：注入内容只描述磁盘上有什么，不指挥模型做任何事。
- **不消耗模型额度**：本插件不调用 LLM（与「每轮自动总结」那种方案的区别就在这里）。
- 若某轮命中多个项目（例如一句话同时提到 gal 和小说），两个文件的全文都会注入，受 16000 字符总上限约束。

## 卸载

插件面板停用 → 删除 `%APPDATA%\live2d-cyrene\plugins\progress-inject\`。
项目里的 `PROGRESS.md` 不受影响，可以留着。

---

## v1.1.0 · Git 自动同步（2026-09-13 新增）

写入 PROGRESS.md 之后，插件会自动把它提交到所在的 git 仓库。

### 硬约束（用户明确要求）

- 永远只 `git add` / `git commit` **PROGRESS.md 这一个文件路径**，绝不触碰项目里的其他内容；
- 只有仓库已配置上游分支（`@{u}`）时才 `push`；**没有远程的仓库只做本地提交，不往外传任何东西**。

### 触发时机

1. `progress-inject_write` 写入之后（立即同步，并把结果写回工具返回值）；
2. 后台扫描发现 PROGRESS.md 的 mtime 变化（外部被别的会话改也会被接住）；
3. 插件启动时（把上次遗留的未提交进度补上）；
4. 手动调用 `progress-inject_sync` 工具。

### 相关配置

可在 `DEFAULT_CONFIG` 修改，或被 `ctx.storage` 里的 config 覆盖。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `gitEnabled` | true | false = 完全不碰版本库 |
| `gitAutoSync` | true | 扫描发现变化时自动提交 |
| `gitSyncOnStart` | true | 插件启动时补提交 |
| `gitPush` | true | 仅对已配置上游的仓库生效 |
| `gitTimeoutMs` | 15000 | 单条 git 命令超时 |
| `gitPushTimeoutMs` | 40000 | push 超时 |
| `gitCommitPrefix` | `chore(progress): ` | 提交信息前缀 |

### 实现要点（踩过的坑）

- commit 信息通过 `-F -` 从 **stdin** 传入（UTF-8），规避 Windows 命令行参数的中文编码问题；
- 仓库根用 `cwd` 传入而不是拼进参数，因此中文目录名（如小说项目目录）没有编码风险；
- 环境变量设 `GIT_TERMINAL_PROMPT=0` + `GIT_ASKPASS=echo`，凭据失效时快速失败而不是弹窗卡死；
- push 失败时自动用 `-c http.proxy=` 绕过仓库里可能残留的失效代理再试一次；
- 同一文件的并发同步复用同一个 Promise（不是「跳过」），调用方总能拿到真实结果。

### 测试脚本

- `node test-git-sync.cjs` —— register 契约 / 扫描 / 同步 / unregister 幂等
- `node test-write-flow.cjs` —— 写入后自动提交 +「无远程只本地提交」分支 + 中文目录名

---

## v1.2.0 · 共享进度库

除了「提交到各自仓库」，插件还会把**没有自己远程仓库**的项目进度发布到一个公共仓库，
方便在一个地方总览所有项目。

| 项 | 值 |
| --- | --- |
| 共享仓库 | `https://github.com/guchengyuri-gif/project`（默认，可用 `sharedRepo` 改） |
| 分支 | `main`（`sharedBranch`） |
| 本地镜像 | `<roots[0]>/.progress-hub`（`sharedDir`；点开头，扫描器会自动跳过） |
| 库内布局 | `<项目名>/PROGRESS.md` + 根目录自动生成的 `README.md` 总览 |

**发布规则（自动判断，不需要配置名单）**

- 项目自己的仓库**有远程上游（`@{u}`）** → 留在自己家里，跳过共享库（例：gal 项目）。
- 项目自己的仓库**没有远程上游** → 复制 `PROGRESS.md` 到共享库的 `<项目名>/` 目录后提交推送。
- 只想传一个文件：共享库里除 `PROGRESS.md` 与自动生成的 `README.md` 外，不会有任何项目内容。

**文件夹名怎么来的**：取项目目录名，并去掉 `20260911-181500-` 这类时间戳前缀，再清掉 Windows 非法字符。
例如 `20260911-181500-大小姐的首席护卫绝不认输` → `大小姐的首席护卫绝不认输`。
需要指定名字时用 `sharedSlugs`：`{ "项目目录名": "想要的文件夹名" }`。

**身份与网络**

- 本机全局 git 身份是空的，所以共享库优先沿用来源项目仓库里的 `user.name` / `user.email`；
  都没有时回落到 `gitFallbackName` / `gitFallbackEmail`。
- 推送失败会依次尝试：绕过失效代理（`http.proxy=`）→ `pull --rebase` 后重推。
- 多个项目同时发布时用串行队列，避免抢 `.git/index.lock`。

**新增配置项**

```js
sharedEnabled: true,                    // 总开关
sharedRepo: "https://github.com/...",   // 共享仓库地址
sharedBranch: "main",
sharedDir: "",                          // 留空 = <roots[0]>/.progress-hub
sharedSkip: [],                         // 明确排除的项目目录名（小写）
sharedReadme: true,                     // 维护根目录 README.md 总览
sharedSlugs: {},                        // 目录名 -> 库内文件夹名
gitFallbackName: "ADMIN",
gitFallbackEmail: "3465608670@qq.com",
```

**测试**：`node test-shared-hub.cjs`（19 项，用本地裸库模拟远端，含后台自动发布分支）。

> 注意：写入 / 同步现在会连带推送共享库，所以针对写入路径的测试(`test-write-flow.cjs`)
> 全部改在临时沙盒里跑，**不会碰真实项目文件**。
