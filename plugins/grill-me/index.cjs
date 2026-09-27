"use strict";

module.exports = {
  async register(ctx) {
    ctx.log("注册 Grill Me 反向提问决策树插件...");

    ctx.registerTool({
      id: "grill-me_analyze_demand",
      name: "启动反向提问决策树分析",
      description: "当需求模糊、未定边界或面临多种架构选型时调用。对需求进行决策树解构，提出关键澄清问题并附带推荐选项。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          raw_requirement: { type: "string", description: "用户的原始需求或想法描述" },
          domain: { type: "string", description: "涉及的领域，如前端交互/数据存储/业务逻辑" },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                aspect: { type: "string", description: "考量维度：边界条件/异常处理/架构偏好" },
                question: { type: "string", description: "向用户提出的关键问题" },
                options: { type: "array", items: { type: "string" }, description: "推荐备选项" },
                recommendation: { type: "string", description: "推荐的方案与原因" }
              },
              required: ["aspect", "question", "options", "recommendation"]
            }
          }
        },
        required: ["raw_requirement", "questions"]
      },
      async execute(params) {
        return JSON.stringify({
          status: "active",
          message: "已构建反向提问决策树，请向用户呈现实时追问与选项。",
          requirement: params.raw_requirement,
          questions: params.questions
        });
      }
    });
  }
};
