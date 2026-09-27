"use strict";

// ===========================================================================
// Chinese Novelist (中文长篇小说创作助手) —— Cyrene 运行时插件入口
//
// 基于 PenglongHuang/chinese-novelist-skill (v2.0)
//
// 核心能力：
//   1) 三层递进式问答与大纲/档案规划 (Phase 1 & 2)
//   2) 大师级网文技法库 (悬念十三式、去AI味24禁忌、对话权力博弈、内容自然扩充)
//   3) 章节字数达标度(3000-5000字)与去AI味深度质检引擎 (Phase 4)
//   4) 02-写作计划.json 状态机管理与长篇断点续写 (Phase 3)
//   5) user-preferences.json 跨项目用户偏好记忆 (Phase 0)
//   6) 本地可视化创作控制台 (ui.html)
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");

const PLUGIN_ID = "chinese-novelist";
const DEFAULT_WORKSPACE = "D:\\ai\\program\\chinese-novelist";

// ---------------------------------------------------------------------------
// 去 AI 味高频禁用套路词库
// ---------------------------------------------------------------------------
const AI_CLICHE_RULES = [
  { pattern: /这一刻/g, suggestion: "删去或替换为具体的动作转折，如「刀锋已至眼前」" },
  { pattern: /心中不禁(?:涌起|一颤|暗道|感叹)?|不禁心生|不由得/g, suggestion: "展示而非讲述：直接描写生理反应或肢体动作（如「手指猛地攥紧」）" },
  { pattern: /深吸了一?口气|倒吸一口(?:凉气|冷气)/g, suggestion: "网文高频套路，建议改为眼神变幻、下意识退后半步或屏住呼吸" },
  { pattern: /不可否认(?:的是)?|毋庸置疑/g, suggestion: "说明性论文腔，直接陈述事实或由角色说出" },
  { pattern: /值得一提的是|总的来说|综上所述|事实上/g, suggestion: "强行总结的AI味，严禁出现在小说正文中" },
  { pattern: /眼神中闪过(?:一丝|一道)|眼中闪过/g, suggestion: "脸谱化白描，建议替换为具体动作（如「眼皮一跳」、「视线偏了偏」）" },
  { pattern: /嘴角勾起(?:一抹|一丝)?(?:冷笑|微笑|弧度)?/g, suggestion: "滥用邪魅笑，改为冷哼、撇嘴或面无表情地抬起眼" },
  { pattern: /仿佛在诉说着|空气仿佛凝固/g, suggestion: "抒情过度假大空，描写具体的环境细节（如「只有油灯芯噼啪爆了个火花」）" },
  { pattern: /不知不觉中/g, suggestion: "被动模糊的过渡词，明确指出时间或事件推移" },
  { pattern: /宛如一尊|宛若天神/g, suggestion: "陈旧夸张修辞，用侧面旁人的恐惧反应衬托" },
  { pattern: /脑海中一片空白/g, suggestion: "俗套描写，替换为耳鸣、呼吸停滞等具体生理细节" }
];

// 悬念钩子常见触发词（用于分析章末 300 汉字）
const HOOK_TRIGGERS = [
  "突然", "猛然", "就在这时", "瞳孔", "门外", "冷汗", "停住", "是谁", "怎么会",
  "到底", "难道", "真相", "杀气", "秘密", "信封", "血迹", "脚步声", "倒下", "微笑", "危险"
];

let pluginWin = null;
let ctxRef = null;

// ---------------------------------------------------------------------------
// 辅助工具函数
// ---------------------------------------------------------------------------

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getPreferencesPath(workspaceDir) {
  const root = workspaceDir || DEFAULT_WORKSPACE;
  ensureDir(root);
  return path.join(root, "user-preferences.json");
}

function loadPreferences(workspaceDir) {
  const p = getPreferencesPath(workspaceDir);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (_) {}
  }
  return {
    favoriteGenres: ["都市现实", "玄幻修真", "悬疑惊悚", "科幻"],
    defaultPerspective: "第三人称有限视角",
    defaultTone: "节奏明快、爽点密集、开头即高潮",
    targetWordsPerChapter: 3500,
    targetChapters: 20,
    antiAiStrictness: "high",
    lastUpdated: new Date().toISOString()
  };
}

function savePreferences(workspaceDir, data) {
  const p = getPreferencesPath(workspaceDir);
  const current = loadPreferences(workspaceDir);
  const next = Object.assign({}, current, data, { lastUpdated: new Date().toISOString() });
  fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** 纯汉字字数统计（对齐 scripts/check_chapter_wordcount.py） */
function countChineseWords(rawText) {
  if (!rawText) return 0;
  let text = String(rawText);
  text = text.replace(/#{1,6}\s*/g, "");
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/\*(.*?)\*/g, "$1");
  text = text.replace(/~~(.*?)~~/g, "$1");
  text = text.replace(/`(.*?)`/g, "$1");
  text = text.replace(/\[(.*?)\]\((.*?)\)/g, "$1");
  const matches = text.match(/[\u4e00-\u9fa5]/g);
  return matches ? matches.length : 0;
}

/** 章节正文提取 */
function extractMainContent(fullContent) {
  if (!fullContent) return "";
  const lines = fullContent.split("\n");
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith("#") && l.includes("章")) {
      startIdx = i + 1;
      break;
    }
  }
  return lines.slice(startIdx).join("\n");
}

/** 章节全方位质量审查与去 AI 味分析 */
function auditText(content, minWords = 3000, maxWords = 5000) {
  const mainContent = extractMainContent(content);
  const wordCount = countChineseWords(mainContent);

  // 1. 字数达标判定
  let wordStatus = "pass";
  let wordMessage = `纯汉字统计：${wordCount} 字`;
  if (wordCount < minWords) {
    wordStatus = "too_short";
    wordMessage = `字数不足！当前 ${wordCount} 字，未达最低门槛 ${minWords} 字（建议扩充细节与博弈）。`;
  } else if (wordCount > maxWords + 1000) {
    wordStatus = "too_long";
    wordMessage = `单章字数偏多（${wordCount} 字），超过建议上限 ${maxWords} 字，读者阅读疲劳。`;
  } else {
    wordMessage += ` (✓ 达标，处于 ${minWords}-${maxWords} 黄金篇幅区间)`;
  }

  // 2. 去 AI 味违禁词扫描
  const aiFindings = [];
  for (const rule of AI_CLICHE_RULES) {
    const matches = mainContent.match(rule.pattern);
    if (matches && matches.length > 0) {
      aiFindings.push({
        cliche: matches[0],
        count: matches.length,
        suggestion: rule.suggestion
      });
    }
  }

  // 3. 章尾悬念钩子检测
  const tailLength = 300;
  const tailText = mainContent.slice(-tailLength);
  const hasQuestion = /[？?]/.test(tailText);
  const hasEllipsis = /[…\.]{2,}/.test(tailText);
  const matchedTriggers = HOOK_TRIGGERS.filter(t => tailText.includes(t));

  let hookScore = 0;
  if (hasQuestion) hookScore += 35;
  if (hasEllipsis) hookScore += 20;
  if (matchedTriggers.length > 0) hookScore += Math.min(45, matchedTriggers.length * 15);

  let hookAssessment = "章尾悬念充足，具备优秀的翻页拉力";
  if (hookScore < 30) {
    hookAssessment = "章尾悬念较弱！建议加入突发事件、未解反转、危险伏笔或人物异常言行作为断章钩子";
  } else if (hookScore < 60) {
    hookAssessment = "章尾留有一定线索，但可进一步强化危机感或冲突感";
  }

  // 综合质量评分 (满分 100)
  let overallScore = 100;
  if (wordCount < minWords) overallScore -= Math.min(40, Math.round((minWords - wordCount) / 100));
  overallScore -= Math.min(30, aiFindings.reduce((acc, cur) => acc + cur.count * 4, 0));
  if (hookScore < 30) overallScore -= 15;
  overallScore = Math.max(10, Math.min(100, overallScore));

  return {
    score: overallScore,
    wordCount: wordCount,
    wordStatus: wordStatus,
    wordMessage: wordMessage,
    aiFindings: aiFindings,
    aiCount: aiFindings.reduce((a, b) => a + b.count, 0),
    hookScore: hookScore,
    hookTriggers: matchedTriggers,
    hookAssessment: hookAssessment,
    tailExcerpt: tailText.trim()
  };
}

/** 读取插件内置的流程与技法文档 */
function readPluginDoc(subPath) {
  const full = path.join(__dirname, subPath);
  if (fs.existsSync(full)) {
    return fs.readFileSync(full, "utf8");
  }
  return null;
}

/** 列出工作区下的所有小说工程 */
function scanProjects(workspaceDir) {
  const root = workspaceDir || DEFAULT_WORKSPACE;
  ensureDir(root);
  const results = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const projectDir = path.join(root, ent.name);
    const planFile = path.join(projectDir, "02-写作计划.json");
    const outlineFile = path.join(projectDir, "01-大纲.md");
    const charFile = path.join(projectDir, "00-人物档案.md");

    let planData = null;
    if (fs.existsSync(planFile)) {
      try {
        planData = JSON.parse(fs.readFileSync(planFile, "utf8"));
      } catch (_) {}
    }

    // 统计章节文件
    const chapterFiles = fs.readdirSync(projectDir)
      .filter(f => /^第\d+章.*\.md$/.test(f))
      .sort();

    let totalWords = 0;
    for (const cf of chapterFiles) {
      try {
        const text = fs.readFileSync(path.join(projectDir, cf), "utf8");
        totalWords += countChineseWords(extractMainContent(text));
      } catch (_) {}
    }

    results.push({
      folderName: ent.name,
      path: projectDir,
      title: (planData && planData.title) || ent.name.replace(/^\d{8}-\d{6}-/, ""),
      hasPlan: fs.existsSync(planFile),
      hasOutline: fs.existsSync(outlineFile),
      hasCharacters: fs.existsSync(charFile),
      chapterCount: chapterFiles.length,
      targetChapters: (planData && planData.totalChapters) || (planData && planData.chapters ? planData.chapters.length : 20),
      totalWords: totalWords,
      currentStatus: (planData && planData.status) || (chapterFiles.length > 0 ? "writing" : "planned"),
      planData: planData
    });
  }

  return results.sort((a, b) => b.folderName.localeCompare(a.folderName));
}

// ---------------------------------------------------------------------------
// 插件核心生命周期
// ---------------------------------------------------------------------------

module.exports = {
  async register(ctx) {
    ctxRef = ctx;
    const workspace = DEFAULT_WORKSPACE;
    ensureDir(workspace);

    // =========================================================================
    // 工具 1：获取分阶段全流程指引与 Prompt
    // =========================================================================
    ctx.registerTool({
      id: "chinese-novelist_get_guide",
      name: "获取小说创作各阶段指引与模板",
      description: "获取 chinese-novelist-skill 官方阶段指引文档。适用场景：需要指导小说三层问答(Phase 1)、大纲与人物档案规划(Phase 2)、分章疯狂撰写与去AI味(Phase 3)、自动校验修复(Phase 4)及断点续写(Phase 0)。参数 phase 可选：phase0, phase1_layer1, phase1_layer2, phase1_layer3, phase2, phase3, phase4, shared, all；keyword 可选模糊搜索。",
      risk: "safe",
      effectKind: "read",
      parameters: {
        type: "object",
        properties: {
          phase: {
            type: "string",
            description: "阶段标识：phase0（初始化与偏好）、phase1_layer1（核心定位3问）、phase1_layer2（深度定制5问）、phase1_layer3（爆款标题）、phase2（大纲规划）、phase3（疯狂创作）、phase4（自动校验）、shared（共享基建）、all（全部）",
            enum: ["phase0", "phase1_layer1", "phase1_layer2", "phase1_layer3", "phase2", "phase3", "phase4", "shared", "all"]
          },
          keyword: {
            type: "string",
            description: "可选搜索关键词（如「问答」「串行」「校验」「钩子」）"
          }
        }
      },
      async execute(params) {
        const p = params.phase || "all";
        const map = {
          phase0: "references/flows/phase0-initialization.md",
          phase1_layer1: "references/flows/phase1-layer1-core.md",
          phase1_layer2: "references/flows/phase1-layer2-customize.md",
          phase1_layer3: "references/flows/phase1-layer3-title.md",
          phase2: "references/flows/phase2-planning.md",
          phase3: "references/flows/phase3-writing.md",
          phase4: "references/flows/phase4-validation.md",
          shared: "references/flows/shared-infrastructure.md"
        };

        if (p !== "all" && map[p]) {
          const content = readPluginDoc(map[p]);
          return content || `未找到阶段文档: ${p}`;
        }

        // 汇总返回主要指引
        const skillDoc = readPluginDoc("references/flows/shared-infrastructure.md") || "";
        const p1Doc = readPluginDoc("references/flows/phase1-layer1-core.md") || "";
        const p2Doc = readPluginDoc("references/flows/phase2-planning.md") || "";
        const p3Doc = readPluginDoc("references/flows/phase3-writing.md") || "";

        return `【chinese-novelist 核心创作工作流总览】\n\n` +
               `### 阶段0：初始化与偏好（phase0）\n自动加载 user-preferences.json，探测断点续写。\n\n` +
               `### 阶段1：三层递进问答（phase1_layer1/2/3）\n- L1: 题材、主角、核心冲突（必答）\n- L2: 世界观、视角基调、受众、篇幅（可选）\n- L3: 爆款书名生成\n\n` +
               `### 阶段2：规划确认（phase2）\n生成 7 列章节规划大纲、三维人物小传与 02-写作计划.json。\n\n` +
               `### 阶段3：疯狂创作（phase3）\n每章严格执行：写前分析 → 撰写(3000-5000字) → 润色去AI味 → 字数与章末钩子检查。\n\n` +
               `### 阶段4：自动校验修复（phase4）\n全稿字数达标度与情节连贯性审计，自动微调不合格章节。`;
      }
    });

    // =========================================================================
    // 工具 2：获取大师级网文技法手册
    // =========================================================================
    ctx.registerTool({
      id: "chinese-novelist_get_technique",
      name: "获取小说技法库与去AI味手册",
      description: "获取内置的经典网文技法与规范。适用场景：需要章尾悬念十三式(hooks)、去AI味24禁忌(de_ai)、人物塑造(character)、对话博弈(dialogue)、情节结构(plot)、3000字自然扩充(expansion)、爆款书名(title)或大纲人物模板(templates)。",
      risk: "safe",
      effectKind: "read",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "技法分类：hooks(悬念钩子十三式)、de_ai(去AI味禁忌与重构)、character(三维人物塑造)、dialogue(对话节奏与博弈)、plot(情节节拍与结构)、expansion(内容自然扩充)、title(起名法宝)、templates(模板合集)",
            enum: ["hooks", "de_ai", "character", "dialogue", "plot", "expansion", "title", "templates"],
            default: "hooks"
          }
        },
        required: ["category"]
      },
      async execute(params) {
        const cat = params.category || "hooks";
        const fileMap = {
          hooks: "references/guides/hook-techniques.md",
          de_ai: "references/guides/chapter-guide.md",
          character: "references/guides/character-building.md",
          dialogue: "references/guides/dialogue-writing.md",
          plot: "references/guides/plot-structures.md",
          expansion: "references/guides/content-expansion.md",
          title: "references/guides/title-guide.md",
          templates: "references/guides/outline-template.md"
        };

        const rel = fileMap[cat] || "references/guides/chapter-guide.md";
        const content = readPluginDoc(rel);
        if (content) return content;
        return `未找到指定分类手册：${cat}`;
      }
    });

    // =========================================================================
    // 工具 3：初始化小说工程目录
    // =========================================================================
    ctx.registerTool({
      id: "chinese-novelist_init_project",
      name: "初始化小说项目工程",
      description: "一键在本地创建符合 chinese-novelist 标准的项目文件夹，并生成 01-大纲.md、00-人物档案.md、02-写作计划.json 骨架。参数：title(必填书名), genre(题材), protagonist(主角名), targetChapters(目标章节数, 默认20), workspaceDir(工作区根目录)。",
      risk: "safe",
      effectKind: "write",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "小说书名（如《大小姐的首席护卫绝不认输》）" },
          genre: { type: "string", description: "题材类型（如都市异能、仙侠悬疑等）" },
          protagonist: { type: "string", description: "主角姓名与核心设定" },
          targetChapters: { type: "number", description: "规划章节总数，默认 20" },
          perspective: { type: "string", description: "叙事视角（第三人称有限视角 / 第一人称）" },
          coreConflict: { type: "string", description: "主线核心冲突与驱动力" },
          workspaceDir: { type: "string", description: "小说存放根目录，缺省为 D:\\ai\\program\\chinese-novelist" }
        },
        required: ["title"]
      },
      async execute(params) {
        const root = params.workspaceDir || DEFAULT_WORKSPACE;
        ensureDir(root);

        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const sanitizedTitle = (params.title || "未命名故事").replace(/[\\/:*?"<>|]/g, "_");
        const folderName = `${ts}-${sanitizedTitle}`;
        const projectDir = path.join(root, folderName);
        ensureDir(projectDir);

        const totalChapters = Number(params.targetChapters) || 20;

        // 1. 生成 00-人物档案.md
        const charContent = `# 人物档案 · ${params.title}\n\n` +
          `## 主角档案\n- **姓名**：${params.protagonist || "待定"}\n` +
          `- **外貌特征**：\n- **核心性格**：\n- **金手指/能力**：\n- **深层动机与软肋**：\n\n` +
          `## 核心反派\n- **姓名**：\n- **身份与地位**：\n- **与主角的根本冲突**：\n\n` +
          `## 重要配角\n- **配角 1**：\n- **配角 2**：\n`;
        fs.writeFileSync(path.join(projectDir, "00-人物档案.md"), charContent, "utf8");

        // 2. 生成 01-大纲.md (标准 7 列模板)
        let outlineContent = `# 全书总纲 · ${params.title}\n\n` +
          `- **题材**：${params.genre || "未设定"}\n` +
          `- **视角**：${params.perspective || "第三人称有限视角"}\n` +
          `- **核心冲突**：${params.coreConflict || "未设定"}\n` +
          `- **规划章节**：${totalChapters} 章\n\n` +
          `## 7 列分章节拍规划\n\n` +
          `| 章节 | 章节标题 | 核心事件 | 核心冲突 | 情绪曲线 | 悬念钩子 | 篇幅规划 |\n` +
          `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

        for (let i = 1; i <= Math.min(5, totalChapters); i++) {
          outlineContent += `| 第${String(i).padStart(2, "0")}章 | 待规划标题 | 核心事件简介 | 遭遇阻碍 | 压抑→爆发 | 章尾生死悬念/反转 | 3500字 |\n`;
        }
        fs.writeFileSync(path.join(projectDir, "01-大纲.md"), outlineContent, "utf8");

        // 3. 生成 02-写作计划.json
        const chaptersList = [];
        for (let i = 1; i <= totalChapters; i++) {
          chaptersList.push({
            chapterNumber: i,
            title: `第${String(i).padStart(2, "0")}章`,
            status: "pending", // pending | in_progress | completed
            wordCount: 0,
            summary: ""
          });
        }

        const planJson = {
          version: "2.0",
          title: params.title,
          genre: params.genre || "",
          protagonist: params.protagonist || "",
          totalChapters: totalChapters,
          status: "planned",
          currentChapterIndex: 1,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          chapters: chaptersList
        };
        fs.writeFileSync(path.join(projectDir, "02-写作计划.json"), JSON.stringify(planJson, null, 2), "utf8");

        return {
          ok: true,
          message: `✅ 小说项目工程创建成功！`,
          projectDir: projectDir,
          folderName: folderName,
          totalChapters: totalChapters,
          filesCreated: ["00-人物档案.md", "01-大纲.md", "02-写作计划.json"]
        };
      }
    });

    // =========================================================================
    // 工具 4：章节字数与去 AI 味深度质检
    // =========================================================================
    ctx.registerTool({
      id: "chinese-novelist_audit_chapter",
      name: "章节字数与去AI味深度质检",
      description: "检查章节是否符合工业级网文质量标准。严格统计纯汉字量（排除标点和Markdown），要求 3000-5000 字；全量扫描去 AI 味高频套路词（这一刻、心中不禁、深吸一口气等）；分析章尾 300 汉字悬念钩子与拉力并评分。可传入 content 纯文本或 file_path 绝对路径。",
      risk: "safe",
      effectKind: "read",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "待质检的章节 Markdown 文本内容（二选一）" },
          file_path: { type: "string", description: "待质检的章节文件本地绝对路径（二选一）" },
          min_words: { type: "number", description: "单章最低字数要求，默认 3000" },
          max_words: { type: "number", description: "单章建议最高字数，默认 5000" }
        }
      },
      async execute(params) {
        let text = params.content || "";
        if (!text && params.file_path) {
          if (fs.existsSync(params.file_path)) {
            text = fs.readFileSync(params.file_path, "utf8");
          } else {
            return `❌ 文件不存在：${params.file_path}`;
          }
        }
        if (!text) return "❌ 请传入章节内容 (content) 或有效的文件路径 (file_path)。";

        const minW = Number(params.min_words) || 3000;
        const maxW = Number(params.max_words) || 5000;
        const result = auditText(text, minW, maxW);

        let report = `### 📊 章节质检审计报告 (评分: ${result.score}/100)\n\n`;
        report += `* **字数状态**：${result.wordMessage}\n`;
        report += `* **AI痕迹扫描**：共发现 ${result.aiCount} 处常见套路词/AI味表达\n`;

        if (result.aiFindings.length > 0) {
          for (const f of result.aiFindings) {
            report += `  - 命中词 **「${f.cliche}」** (出现 ${f.count} 次) → 建议：${f.suggestion}\n`;
          }
        } else {
          report += `  - ✓ 未检出明显高频 AI 味套路，行文质感优良。\n`;
        }

        report += `* **章尾悬念断章评估** (钩子指数: ${result.hookScore}/100)：\n`;
        report += `  - ${result.hookAssessment}\n`;
        if (result.hookTriggers.length > 0) {
          report += `  - 检出情绪触发词：${result.hookTriggers.join("、")}\n`;
        }

        return report;
      }
    });

    // =========================================================================
    // 工具 5：维护 02-写作计划.json 状态机
    // =========================================================================
    ctx.registerTool({
      id: "chinese-novelist_manage_plan",
      name: "管理小说写作计划与状态",
      description: "读写 02-写作计划.json 追踪连载进度。支持 action: read（查看进度）、update_chapter（更新单章完成状态、字数和剧情摘要）、next_pending（获取下一个待写章节）。支持断点续写防遗忘。",
      risk: "safe",
      effectKind: "write",
      parameters: {
        type: "object",
        properties: {
          project_dir: { type: "string", description: "小说工程绝对目录路径" },
          action: {
            type: "string",
            description: "操作类型：read（读取进度）、update_chapter（更新章节）、next_pending（定位下一章）",
            enum: ["read", "update_chapter", "next_pending"],
            default: "read"
          },
          chapter_number: { type: "number", description: "章节序号（update_chapter 必填）" },
          status: {
            type: "string",
            description: "章节状态：pending（待写）、in_progress（撰写中）、completed（已完成）",
            enum: ["pending", "in_progress", "completed"]
          },
          word_count: { type: "number", description: "该章实际汉字数" },
          summary: { type: "string", description: "该章核心剧情一句话摘要（用于后续章节连贯记忆）" }
        },
        required: ["project_dir"]
      },
      async execute(params) {
        const planPath = path.join(params.project_dir, "02-写作计划.json");
        if (!fs.existsSync(planPath)) {
          return `❌ 未在指定目录下找到 02-写作计划.json：${params.project_dir}`;
        }

        let planData;
        try {
          planData = JSON.parse(fs.readFileSync(planPath, "utf8"));
        } catch (err) {
          return `❌ 解析 02-写作计划.json 失败：${err.message}`;
        }

        const act = params.action || "read";

        if (act === "read") {
          const completed = (planData.chapters || []).filter(c => c.status === "completed");
          const inProgress = (planData.chapters || []).filter(c => c.status === "in_progress");
          const pending = (planData.chapters || []).filter(c => c.status === "pending");
          const totalW = (planData.chapters || []).reduce((acc, c) => acc + (c.wordCount || 0), 0);

          return {
            title: planData.title,
            totalChapters: planData.totalChapters || (planData.chapters ? planData.chapters.length : 0),
            completedCount: completed.length,
            inProgressCount: inProgress.length,
            pendingCount: pending.length,
            totalWords: totalW,
            nextChapter: pending.length > 0 ? pending[0].chapterNumber : null,
            chapters: planData.chapters
          };
        }

        if (act === "next_pending") {
          const pending = (planData.chapters || []).find(c => c.status === "pending" || c.status === "in_progress");
          if (!pending) {
            return `🎉 全书所有章节已全部创作完成！总字数累计已结稿。`;
          }
          return {
            chapterNumber: pending.chapterNumber,
            title: pending.title,
            status: pending.status,
            message: `断点续写建议：接下来应当开始写第 ${pending.chapterNumber} 章`
          };
        }

        if (act === "update_chapter") {
          const num = Number(params.chapter_number);
          if (!num) return `❌ 请提供合法的 chapter_number`;

          const target = (planData.chapters || []).find(c => c.chapterNumber === num);
          if (!target) return `❌ 未在写作计划中找到第 ${num} 章`;

          if (params.status) target.status = params.status;
          if (params.word_count !== undefined) target.wordCount = Number(params.word_count);
          if (params.summary) target.summary = params.summary;

          planData.updatedAt = new Date().toISOString();
          fs.writeFileSync(planPath, JSON.stringify(planData, null, 2), "utf8");

          return {
            ok: true,
            message: `第 ${num} 章状态更新为 [${target.status}]（${target.wordCount || 0}字）`,
            chapter: target
          };
        }

        return `未知 action: ${act}`;
      }
    });

    // =========================================================================
    // 工具 6：用户跨项目创作偏好记忆
    // =========================================================================
    ctx.registerTool({
      id: "chinese-novelist_preferences",
      name: "读取与更新用户创作偏好",
      description: "管理 user-preferences.json。跨小说工程记忆用户喜好的题材、视角基调、单章目标字数、去AI味严格度等，避免重复提问。action 可选 get / set。",
      risk: "safe",
      effectKind: "read",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set"], default: "get" },
          preferences: {
            type: "object",
            description: "需要保存的偏好键值对（action 为 set 时有效）"
          },
          workspaceDir: { type: "string", description: "小说根目录路径" }
        }
      },
      async execute(params) {
        const root = params.workspaceDir || DEFAULT_WORKSPACE;
        if (params.action === "set" && params.preferences) {
          const updated = savePreferences(root, params.preferences);
          return { ok: true, message: "偏好记忆已更新", preferences: updated };
        }
        return loadPreferences(root);
      }
    });

    // =========================================================================
    // 工具 7：列出当前所有小说工程与进度
    // =========================================================================
    ctx.registerTool({
      id: "chinese-novelist_list_projects",
      name: "列出小说工程与连载进度",
      description: "扫描指定工作区目录（缺省为 D:\\ai\\program\\chinese-novelist）中的所有小说工程，展示书名、已写章节数、规划总章节数、累计汉字字数和断点续写章节。",
      risk: "safe",
      effectKind: "read",
      parameters: {
        type: "object",
        properties: {
          workspaceDir: { type: "string", description: "小说存放根目录" }
        }
      },
      async execute(params) {
        const list = scanProjects(params.workspaceDir || DEFAULT_WORKSPACE);
        if (list.length === 0) {
          return "当前工作区尚未创建任何小说工程。可以用 chinese-novelist_init_project 工具创建第一部作品！";
        }
        return list.map(p => ({
          title: p.title,
          folder: p.folderName,
          progress: `${p.chapterCount} / ${p.targetChapters} 章`,
          totalWords: `${p.totalWords} 字`,
          status: p.currentStatus,
          path: p.path
        }));
      }
    });

    // =========================================================================
    // IPC 注册（供 UI 窗口调用）
    // =========================================================================
    ctx.registerIpc("getState", async () => {
      const prefs = loadPreferences(DEFAULT_WORKSPACE);
      const projects = scanProjects(DEFAULT_WORKSPACE);
      return {
        workspace: DEFAULT_WORKSPACE,
        preferences: prefs,
        projects: projects
      };
    });

    ctx.registerIpc("savePreferences", async (newPrefs) => {
      const saved = savePreferences(DEFAULT_WORKSPACE, newPrefs);
      return { ok: true, preferences: saved };
    });

    ctx.registerIpc("auditDraft", async (draftText) => {
      return auditText(draftText || "", 3000, 5000);
    });

    ctx.registerIpc("openFolder", async (folderPath) => {
      const target = folderPath || DEFAULT_WORKSPACE;
      try {
        require("electron").shell.openPath(target);
        return { ok: true, path: target };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

    if (typeof ctx.onDispose === "function") {
      ctx.onDispose(() => {
        if (pluginWin && !pluginWin.isDestroyed()) pluginWin.close();
        pluginWin = null;
        ctxRef = null;
      });
    }

    ctx.log("Chinese Novelist 插件已完成注册");
  },

  async open() {
    if (pluginWin && !pluginWin.isDestroyed()) {
      pluginWin.focus();
      return;
    }
    const { BrowserWindow } = require("electron");
    pluginWin = new BrowserWindow({
      width: 820,
      height: 800,
      minWidth: 700,
      minHeight: 600,
      autoHideMenuBar: true,
      backgroundColor: "#fff7fb",
      title: "Chinese Novelist · 中文长篇小说创作控制台",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    pluginWin.on("closed", () => {
      pluginWin = null;
    });
    await pluginWin.loadFile(path.join(__dirname, "ui.html"));
  },

  async unregister() {
    if (pluginWin && !pluginWin.isDestroyed()) pluginWin.close();
    pluginWin = null;
    ctxRef = null;
  }
};
