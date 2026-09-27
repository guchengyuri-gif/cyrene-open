# Video Podcast Maker · Cyrene 插件

把上游 **Agents365-ai/video-podcast-maker v5.3.0**（MIT）的 Agent Skill 包装成 Cyrene 运行时插件，
让昔涟可以直接驱动「主题 → 4K 讲解视频」的完整流水线。

```
选题研究 → 脚本撰写 → 本地 TTS(edge/azure) → Remotion 渲染 → MP4 + BGM
```

支持发布平台：B站 / YouTube / 小红书 / 抖音 / 微信视频号，输出语言 zh-CN / en-US。

---

## 工具清单

| 工具 ID | 作用 | risk |
| --- | --- | --- |
| `video-podcast-maker_get_guide` | 读取 SKILL.md / references 工作流文档（可 `list=true` 列清单、`keyword` 定位片段） | safe |
| `video-podcast-maker_prereqs` | 环境自检（node / python3 / ffmpeg、当前 TTS 后端与密钥） | safe |
| `video-podcast-maker_schema` | 查询各动作的 JSON Schema（如 `tts.run`），不传 method 则列全部动作 | safe |
| `video-podcast-maker_prefs` | 读取偏好：`backend` / `bgm-path` / `get`(keys) / `migrate` | safe |
| `video-podcast-maker_run` | 白名单调度 `scripts/cli.py` 执行各阶段（tts / verify / align / audit / shorts / design / assets / capabilities / prereqs / prefs / schema） | shell |

> `run` 的 `resource` 使用枚举白名单，无法执行任意脚本。

---

## 环境依赖

| 依赖 | 状态 | 说明 |
| --- | --- | --- |
| Node.js | ✅ | Remotion 渲染与模板构建 |
| Python 3.12 | ✅ | 流水线脚本 |
| `python3` 命令 | ✅ 已补 | Windows 上已由 `python.exe` 复制为 `python3.exe` |
| ffmpeg | ✅ 已补 | 已放入 Python 安装目录（在 PATH 中） |
| Python 包 | ✅ 已装 | `edge-tts`、`azure-cognitiveservices-speech` 等（见 requirements.txt） |
| Node 包 | ✅ 已装 | `node_modules`（Remotion 等 265 个包） |
| Chromium | 视情况 | Remotion 首次渲染时可能自动下载 |

自检命令：调用 `video-podcast-maker_prereqs`，或

```bat
cd /d "%APPDATA%\live2d-cyrene\plugins\video-podcast-maker"
python3 scripts\check_prereqs.py
```

---

## 典型调用流程

1. `video-podcast-maker_get_guide`（`doc=SKILL`）→ 读主流程
2. `video-podcast-maker_get_guide`（`doc=workflow-script.md`）→ 写脚本规范
3. 产出 `videos/<项目名>/podcast.txt`（`[SECTION:xxx]` 分段）
4. `video-podcast-maker_run` → `resource=tts, action=validate, args=["--input","videos/<项目名>/podcast.txt"]`
5. `video-podcast-maker_run` → `resource=tts, action=run, args=[...]`（真正合成音频 + SRT + timing.json）
6. Remotion 渲染（模板见 `templates/`）
7. `video-podcast-maker_run` → `resource=verify`（产物验收门禁）

`cwd` 参数建议传你的项目工作区绝对路径，产物落在 `<cwd>/videos/<项目名>/`。

---

## 重新安装依赖（换机 / 恢复时）

```bat
cd /d "%APPDATA%\live2d-cyrene\plugins\video-podcast-maker"
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
npm install
```

安装包 zip 已排除 `node_modules`（约 310MB），需要时按上面命令重建。

---

## 上游信息

- 仓库：https://github.com/Agents365-ai/video-podcast-maker
- 版本：v5.3.0 · License: MIT
- 本插件为本地封装，上游代码未做逻辑修改。
