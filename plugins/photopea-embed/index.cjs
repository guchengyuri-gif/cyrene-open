"use strict";

/**
 * photopea-embed — 在 Cyrene 里打开 Photopea（免费在线 PS）
 *
 * 设计要点：
 * 1. 窗口直接加载 https://www.photopea.com —— 让 Photopea 跑在它自己的 https 源下，
 *    功能完整（不用 file:// 父页面 + iframe，那种组合下它的初始化不可靠）。
 * 2. 远程页面绝不给 Node 权限：nodeIntegration:false / contextIsolation:true / sandbox:true。
 * 3. 可选把本地图片以 data URI 形式，通过官方 #config 参数在打开时载入。
 */

const fs = require("fs");
const path = require("path");

const PLUGIN_ID = "photopea-embed";
const PHOTOPEA_URL = "https://www.photopea.com";
// 超过这个大小就不再塞进 URL（base64 会膨胀约 1/3，太长的 URL 不可靠）
const MAX_INLINE_BYTES = 2 * 1024 * 1024;

let win = null;

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".psd": "image/vnd.adobe.photoshop",
  ".avif": "image/avif",
  ".heic": "image/heic",
};

function mimeOf(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function toDataUri(filePath) {
  const buf = fs.readFileSync(filePath);
  return "data:" + mimeOf(filePath) + ";base64," + buf.toString("base64");
}

function buildUrl(files) {
  if (!files || files.length === 0) return PHOTOPEA_URL;
  return PHOTOPEA_URL + "#" + encodeURIComponent(JSON.stringify({ files: files }));
}

async function openWindow(url) {
  const { BrowserWindow } = require("electron");

  if (win && !win.isDestroyed()) {
    win.focus();
    await win.loadURL(url);
    return win;
  }

  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 800,
    minHeight: 600,
    title: "Photopea",
    autoHideMenuBar: true,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.on("closed", () => {
    win = null;
  });

  await win.loadURL(url);
  return win;
}

module.exports = {
  async register(ctx) {
    ctx.log("photopea-embed enabled");

    ctx.registerTool({
      id: PLUGIN_ID + "_open",
      name: "打开 Photopea 编辑器",
      description:
        "在独立窗口中打开 Photopea（免费的网页版 Photoshop，无需安装、无需登录）。" +
        "当用户说想修图、抠图、做图、合成、加文字、调色，或提到 PS / Photoshop / 在线 PS 时使用。" +
        "支持可选参数 imagePath：本地图片的绝对路径，打开时直接载入该图片。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          imagePath: {
            type: "string",
            description: "要直接载入编辑的本地图片绝对路径（可选）",
          },
        },
        required: [],
      },
      async execute(args) {
        const files = [];
        if (args && args.imagePath) {
          const p = String(args.imagePath);
          if (!fs.existsSync(p)) return "找不到这个文件：" + p;
          let st;
          try {
            st = fs.statSync(p);
          } catch (err) {
            return "读取文件信息失败：" + err.message;
          }
          if (!st.isFile()) return "这不是一个文件：" + p;
          if (st.size > MAX_INLINE_BYTES) {
            await openWindow(PHOTOPEA_URL);
            return (
              "这张图有 " +
              (st.size / 1048576).toFixed(1) +
              "MB，超过直传上限 2MB，所以只打开了空的 Photopea 窗口。" +
              "请在窗口里用「文件 → 打开」载入：" +
              p
            );
          }
          try {
            files.push(toDataUri(p));
          } catch (err) {
            return "读取图片失败：" + err.message;
          }
        }
        await openWindow(buildUrl(files));
        return files.length
          ? "已打开 Photopea 窗口，并载入了图片：" + args.imagePath
          : "已打开 Photopea 窗口。";
      },
    });
  },

  async unregister() {
    if (win && !win.isDestroyed()) win.close();
    win = null;
  },

  async open() {
    await openWindow(PHOTOPEA_URL);
  },
};
