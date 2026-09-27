"use strict";

const path = require("path");
const { execFile } = require("child_process");

const PS_SCRIPT = path.join(__dirname, "actions.ps1");

function runAction(args, signal) {
  return new Promise((resolve, reject) => {
    const psArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      PS_SCRIPT,
      ...args,
    ];

    const child = execFile(
      "powershell.exe",
      psArgs,
      { windowsHide: true, timeout: 15000, signal },
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(stderr || error.message));
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(JSON.stringify(parsed));
        } catch (e) {
          resolve(stdout.trim() || "OK");
        }
      }
    );
  });
}

module.exports = {
  async register(ctx) {
    ctx.log("注册 Computer Use 桌面操控插件...");

    // 1. 获取屏幕分辨率与当前鼠标坐标
    ctx.registerTool({
      id: "computer-use_get_screen_info",
      name: "获取屏幕与鼠标状态",
      description: "获取主显示器分辨率尺寸与当前鼠标光标所在坐标 (X, Y)。在规划鼠标点击与截屏前调用。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_args) {
        return await runAction(["-Action", "screen-info"], ctx.signal);
      },
    });

    // 2. 截取屏幕
    ctx.registerTool({
      id: "computer-use_screenshot",
      name: "截取当前桌面屏幕",
      description: "截取当前主显示器完整屏幕，保存为本地 PNG 图片。path 可选，不传则自动保存在系统临时目录。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "图片输出的绝对路径（可选，如 D:\\ai\\program\\output\\shot.png）",
          },
        },
        required: [],
      },
      async execute(args) {
        const cmdArgs = ["-Action", "screenshot"];
        if (args && args.path) {
          cmdArgs.push("-Path", args.path);
        }
        return await runAction(cmdArgs, ctx.signal);
      },
    });

    // 3. 鼠标点击
    ctx.registerTool({
      id: "computer-use_mouse_click",
      name: "鼠标点击",
      description: "在指定屏幕坐标 (x, y) 或当前鼠标位置执行点击。支持左键(left)、右键(right)、中键(middle)及双击(doubleClick)。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "number", description: "屏幕横坐标 X（可选，默认当前位置）" },
          y: { type: "number", description: "屏幕纵坐标 Y（可选，默认当前位置）" },
          button: {
            type: "string",
            enum: ["left", "right", "middle"],
            description: "鼠标按键：left（左键，默认）、right（右键）、middle（滚轮中键）",
          },
          doubleClick: {
            type: "boolean",
            description: "是否双击（默认 false）",
          },
        },
        required: [],
      },
      async execute(args) {
        const cmdArgs = ["-Action", "click"];
        if (typeof args.x === "number") cmdArgs.push("-X", String(Math.round(args.x)));
        if (typeof args.y === "number") cmdArgs.push("-Y", String(Math.round(args.y)));
        if (args.button) cmdArgs.push("-Button", args.button);
        if (args.doubleClick) cmdArgs.push("-DoubleClick");
        return await runAction(cmdArgs, ctx.signal);
      },
    });

    // 4. 鼠标移动
    ctx.registerTool({
      id: "computer-use_mouse_move",
      name: "鼠标移动",
      description: "将鼠标光标移动到指定的屏幕坐标 (x, y)。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "number", description: "目标横坐标 X" },
          y: { type: "number", description: "目标纵坐标 Y" },
        },
        required: ["x", "y"],
      },
      async execute(args) {
        return await runAction(
          ["-Action", "move", "-X", String(Math.round(args.x)), "-Y", String(Math.round(args.y))],
          ctx.signal
        );
      },
    });

    // 5. 鼠标拖拽
    ctx.registerTool({
      id: "computer-use_mouse_drag",
      name: "鼠标拖拽",
      description: "按住鼠标左键，从起点 (startX, startY) 拖拽到终点 (endX, endY) 后松开。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          startX: { type: "number", description: "起点横坐标 X" },
          startY: { type: "number", description: "起点纵坐标 Y" },
          endX: { type: "number", description: "终点横坐标 X" },
          endY: { type: "number", description: "终点纵坐标 Y" },
        },
        required: ["startX", "startY", "endX", "endY"],
      },
      async execute(args) {
        return await runAction(
          [
            "-Action",
            "drag",
            "-StartX",
            String(Math.round(args.startX)),
            "-StartY",
            String(Math.round(args.startY)),
            "-EndX",
            String(Math.round(args.endX)),
            "-EndY",
            String(Math.round(args.endY)),
          ],
          ctx.signal
        );
      },
    });

    // 6. 鼠标滚轮
    ctx.registerTool({
      id: "computer-use_mouse_scroll",
      name: "鼠标滚轮滚动",
      description: "滚动鼠标滚轮。delta 正数向上滚动，负数向下滚动（单位通常为 120 的倍数，例如 120 为上一格，-120 为下一格）。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          delta: {
            type: "number",
            description: "滚动量，向上为正（如 120），向下为负（如 -120）",
          },
        },
        required: ["delta"],
      },
      async execute(args) {
        return await runAction(
          ["-Action", "scroll", "-ScrollDelta", String(Math.round(args.delta))],
          ctx.signal
        );
      },
    });

    // 7. 键盘键入文本（支持完整中文字符）
    ctx.registerTool({
      id: "computer-use_keyboard_type",
      name: "键入文本",
      description: "在当前激活的窗口/输入框中输入文本内容。通过剪贴板安全粘贴，完美支持中文、长文本与特殊符号。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "需要输入的文本内容" },
        },
        required: ["text"],
      },
      async execute(args) {
        const b64 = Buffer.from(args.text, "utf8").toString("base64");
        return await runAction(["-Action", "type", "-Base64Text", b64], ctx.signal);
      },
    });

    // 8. 键盘按键与快捷键
    ctx.registerTool({
      id: "computer-use_keyboard_press",
      name: "按下按键或快捷键",
      description: "在当前窗口发送按键或快捷键。常用按键如 Enter, Escape, Backspace, Tab, Up, Down, Left, Right, 或快捷键组合（如 ^c 代表 Ctrl+C，^v 代表 Ctrl+V，%{F4} 代表 Alt+F4）。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "按键名称（如 Enter, Escape, Backspace, Tab）或快捷键格式",
          },
        },
        required: ["key"],
      },
      async execute(args) {
        return await runAction(["-Action", "key", "-Key", args.key], ctx.signal);
      },
    });

    ctx.log("Computer Use 插件已成功就绪 ♪");
  },

  async unregister() {
    // 清理逻辑
  },
};
