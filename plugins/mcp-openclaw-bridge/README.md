# mcp-openclaw-bridge

把 **OpenClaw Agent Bridge** 这个 MCP server 包成一个可随时开关的 Cyrene 插件。
启用时才会拉起底层进程并注册工具；停用时进程树会被回收，内存还给系统。

## 底层启动命令

```text
openclaw-mcp --openclaw-url http://127.0.0.1:18789 --gateway-token openclaw-secret-token-2026
```


## 安装

把本目录（或同名 zip）导入 Cyrene：聊天窗口 → 插件面板 → 导入插件，
导入后在列表里手动开启即可。开关一次就等于启停这个 MCP。

## 工具

启用后会按底层 MCP 实际暴露的工具动态注册，工具 id 形如
`mcp-openclaw-bridge_<toolName>`。

## 注意

- 工具副作用无法预判，统一按 write 走权限门控，必要时会向你确认。
- 停用插件会执行 `taskkill /T /F` 回收整棵子进程树。
