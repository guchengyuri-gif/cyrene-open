"use strict";

const path = require("path");
const { execFile } = require("child_process");

const RUNNER_SCRIPT = path.join(__dirname, "runner.py");

function callPaperTool(toolName, args, signal) {
  return new Promise((resolve, reject) => {
    const pythonExe = "py";
    const pyArgs = [
      "-3.12",
      RUNNER_SCRIPT,
      toolName,
      JSON.stringify(args || {})
    ];

    const child = execFile(
      pythonExe,
      pyArgs,
      { windowsHide: true, timeout: 60000, signal, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(stderr || error.message));
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.success) {
            resolve(parsed.data);
          } else {
            reject(new Error(parsed.error || "执行失败"));
          }
        } catch (e) {
          resolve(stdout.trim() || "OK");
        }
      }
    );
  });
}

module.exports = {
  async register(ctx) {
    ctx.log("注册 Paper Search (学术文献检索) 插件...");

    // 1. 全平台聚合检索
    ctx.registerTool({
      id: "paper_search_unified",
      name: "学术论文全源聚合检索",
      description: "在学术源（arXiv, PubMed, bioRxiv, medRxiv, Google Scholar, Semantic Scholar 等）中联合搜索论文。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词或学术主题" },
          max_results_per_source: { type: "number", description: "每个学术源返回的最大结果数，默认 3" },
          sources: { type: "string", description: "指定数据源（逗号隔开，如 arxiv,pubmed,semantic）" }
        },
        required: ["query"]
      },
      handler: async ({ query, max_results_per_source, sources }, { signal }) => {
        const payload = { query };
        if (max_results_per_source) payload.max_results_per_source = max_results_per_source;
        if (sources) payload.sources = sources;
        return await callPaperTool("search_papers", payload, signal);
      }
    });

    // 2. arXiv 专项检索
    ctx.registerTool({
      id: "paper_search_arxiv",
      name: "arXiv 论文检索",
      description: "在 arXiv 预印本平台搜索计算机、物理、数学、AI 等领域的学术论文。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "论文标题、关键词、作者或领域主题" },
          max_results: { type: "number", description: "返回数量（默认 5）" }
        },
        required: ["query"]
      },
      handler: async ({ query, max_results }, { signal }) => {
        return await callPaperTool("search_arxiv", { query, max_results: max_results || 5 }, signal);
      }
    });

    // 3. PubMed 专项检索
    ctx.registerTool({
      id: "paper_search_pubmed",
      name: "PubMed 生物医学文献检索",
      description: "在 PubMed 检索医学、生命科学、临床健康领域的学术文献。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "医学/生物关键词、疾病名称或药物机制" },
          max_results: { type: "number", description: "返回数量（默认 5）" }
        },
        required: ["query"]
      },
      handler: async ({ query, max_results }, { signal }) => {
        return await callPaperTool("search_pubmed", { query, max_results: max_results || 5 }, signal);
      }
    });

    // 4. Google Scholar 检索
    ctx.registerTool({
      id: "paper_search_google_scholar",
      name: "谷歌学术搜索",
      description: "在 Google Scholar 检索学术论文、会议与引用情况。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词" },
          max_results: { type: "number", description: "返回数量（默认 5）" }
        },
        required: ["query"]
      },
      handler: async ({ query, max_results }, { signal }) => {
        return await callPaperTool("search_google_scholar", { query, max_results: max_results || 5 }, signal);
      }
    });

    // 5. Semantic Scholar 检索
    ctx.registerTool({
      id: "paper_search_semantic",
      name: "Semantic Scholar 语义学术搜索",
      description: "在 Semantic Scholar 进行AI语义学术检索，支持获取论文摘要与影响因子。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "学术关键词" },
          limit: { type: "number", description: "返回数量（默认 5）" }
        },
        required: ["query"]
      },
      handler: async ({ query, limit }, { signal }) => {
        return await callPaperTool("search_semantic", { query, limit: limit || 5 }, signal);
      }
    });

    // 6. 下载并读取论文全文
    ctx.registerTool({
      id: "paper_read_full_paper",
      name: "读取学术论文全文内容",
      description: "传入 arXiv ID（如 2105.04026）读取并提取论文的纯文本正文内容（Markdown）。",
      parameters: {
        type: "object",
        properties: {
          paper_id: { type: "string", description: "arXiv 论文编号，例如 2105.04026" }
        },
        required: ["paper_id"]
      },
      handler: async ({ paper_id }, { signal }) => {
        return await callPaperTool("read_arxiv_paper", { paper_id }, signal);
      }
    });

    ctx.log("Paper Search 插件加载完毕，已就绪！");
  }
};
