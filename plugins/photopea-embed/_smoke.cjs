"use strict";

// 冒烟测试：模拟 ctx 注册，检查工具 id 前缀、schema、清理函数不抛错。
// 运行：node D:\ai\program\photopea-embed\_smoke.cjs

const path = require("path");
const plugin = require(path.join(__dirname, "index.cjs"));

const tools = [];
const logs = [];

const ctx = {
  registerTool: (t) => tools.push(t),
  registerIpc: () => {},
  log: (...a) => logs.push(a.join(" ")),
};

(async () => {
  await plugin.register(ctx);

  if (tools.length === 0) throw new Error("没有注册任何工具");

  for (const t of tools) {
    if (!t.id.startsWith("photopea-embed_")) throw new Error("工具 id 前缀不合规：" + t.id);
    if (typeof t.description !== "string" || t.description.length < 10)
      throw new Error("工具缺少写给 AI 看的 description：" + t.id);
    if (!t.inputSchema || t.inputSchema.type !== "object") throw new Error("schema 不合法：" + t.id);
    console.log("OK tool:", t.id, "| effectKind:", t.effectKind, "| risk:", t.risk);
  }

  await plugin.unregister();
  await plugin.unregister(); // 必须可重复调用
  console.log("logs:", JSON.stringify(logs));
  console.log("smoke test passed");
})().catch((err) => {
  console.error("FAIL:", err && err.stack ? err.stack : err);
  process.exit(1);
});
