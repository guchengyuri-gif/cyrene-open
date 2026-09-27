# vision-hub — 视觉模型集合插件

给 Cyrene 接入多个 OpenAI 兼容的视觉模型接口，支持**手动指定**或**自动轮转兜底**，附健康检查与增删改。

## 特性

- **8 个 AI 工具**：`list` / `ask` / `auto` / `health` / `add` / `remove` / `set_health_test` / `config_path`
- 配置存 `%APPDATA%\live2d-cyrene\plugin-data\vision-hub\profiles.json`，插件卸载不丢数据
- 全部走 OpenAI 兼容 `/chat/completions` 协议，OpenAI / DeepSeek / GLM / Qwen / 各种中转站 / 本地 Ollama / LM Studio 全通吃
- 图片支持三种来源：本地绝对路径（≤20MB）/ http(s) URL / data URL（base64）
- 健康检查默认用内建 1x1 白色 PNG（几十字节，成本几乎为零）
- `vision-auto` 按 `priority` 升序逐个尝试，第一个成功即返回
- 每个 profile 独立 `timeoutMs`，失败自动切换到下一个

## 已内置的 seed profile

首次启用时会从插件自带的 `profiles.json` 复制到配置目录，含：

| name | baseUrl | model | priority |
|---|---|---|---|
| `glm-x5m5x` | `https://api.x5m5x.com/v1` | `glm-5.3-flash` | 1 |

## 工具速查

| 工具 id | 用途 | 副作用 |
|---|---|---|
| `vision-hub_list` | 列出所有 profile（apiKey 脱敏） | read |
| `vision-hub_ask` | 手动指定 profile 看图回答 | read |
| `vision-hub_auto` | 自动轮转兜底（按 priority） | read |
| `vision-hub_health` | 遍历 enabled=true 的 profile 测活 | read |
| `vision-hub_add` | 新增/更新 profile（同名则 patch 更新） | write |
| `vision-hub_remove` | 删除 profile | write |
| `vision-hub_set_health_test` | 设置健康检查用的测试图（空=恢复内建默认） | write |
| `vision-hub_config_path` | 打印配置文件绝对路径 | read |

## 使用示例（对话中触发）

- 「帮我看看这张图是什么」→ AI 会用 `vision-hub_auto`
- 「用 glm-x5m5x 看看 D:\path\to\img.png 里有什么」→ AI 会用 `vision-hub_ask`
- 「给我加个视觉模型，qwen-vl-max，https://dashscope.aliyuncs.com/compatible-mode/v1，key sk-xxx」→ AI 会用 `vision-hub_add`
- 「跑一遍视觉健康检查」→ AI 会用 `vision-hub_health`
- 「删掉 glm-x5m5x」→ AI 会用 `vision-hub_remove`

## 配置文件结构

```json
{
  "healthTestImage": "",
  "profiles": [
    {
      "name": "glm-x5m5x",
      "baseUrl": "https://api.x5m5x.com/v1",
      "apiKey": "sk-xxxx",
      "model": "glm-5.3-flash",
      "enabled": true,
      "priority": 1,
      "timeoutMs": 60000
    }
  ]
}
```

- `priority`：数字越小越先被 `vision-hub_auto` 尝试
- `enabled: false`：跳过该 profile（auto 与 health 都会跳过）
- `timeoutMs`：单个请求超时，默认 60s
- `healthTestImage`：留空则用内建 1x1 白色 PNG；也可填本地路径/http URL/data URL

## 新增示例：Qwen VL

对话里说：

> 用 vision-hub_add 加一个 qwen-vl-max，baseUrl 是 https://dashscope.aliyuncs.com/compatible-mode/v1，key 是 sk-xxxx，priority 5

## 新增示例：本地 Ollama

```
vision-hub_add name=ollama-vl baseUrl=http://localhost:11434/v1 apiKey=local model=llava:7b priority=20 timeoutMs=120000
```

## 排查

- **首次启用报"配置读取失败"**：删掉 `%APPDATA%\live2d-cyrene\plugin-data\vision-hub\`，重启 Cyrene 让它从 seed 重建
- **health 全部超时**：检查每个 baseUrl 是否可访问、key 是否有效、priority 顺序是否合理
- **AI 不用工具**：确保对话上下文里有"看图/识别/视觉"等触发词，或明确说"用 vision-hub"
- **改了 profiles.json 不生效**：工具每次调用都会重新读文件，应该立即生效；如果没生效，聊天窗口"刷新插件"

## 打包分发

```powershell
Compress-Archive -Path D:\ai\program\plugins\vision-hub\* -DestinationPath D:\ai\program\vision-hub-1.0.0.zip
```

## 文件清单

```
vision-hub/
  manifest.json       # 插件元数据
  index.cjs           # 入口，注册 8 个工具
  profiles.json       # 首次启用的 seed 配置
  README.md           # 本文件
```

## 卸载

删除 `%APPDATA%\live2d-cyrene\plugins\vision-hub\`（保留 `plugin-data\vision-hub\` 即可保留配置）即可完全卸载。
