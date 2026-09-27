"use strict";

// Clash Verge 管理器 —— 按需启动 / 停止 / 探活 Clash Verge
// 目标程序：C:\Program Files\Clash Verge\clash-verge.exe（UI 主程序）
// 系统服务：clash-verge-service.exe（TUN 模式用，独立常驻）
// 探测端口：mixed=7897, socks=7898, http=7899（来自 verge.yaml）

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn, execFile } = require("node:child_process");
const net = require("node:net");

// ---------------- 常量 ----------------

const CLASH_VERGE_EXE = "C:\\Program Files\\Clash Verge\\clash-verge.exe";
const CONFIG_DIR = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "io.github.clash-verge-rev.clash-verge-rev"
);
const VERGE_YAML = path.join(CONFIG_DIR, "verge.yaml");

const DEFAULT_PORTS = { mixed: 7897, socks: 7898, http: 7899 };
const START_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 6_000;

// ---------------- 工具函数 ----------------

function readPortFromYaml() {
  // 从 verge.yaml 里抠出端口；失败则用默认值
  try {
    const txt = fs.readFileSync(VERGE_YAML, "utf8");
    const pick = (re) => {
      const m = txt.match(re);
      return m ? parseInt(m[1], 10) : null;
    };
    return {
      mixed: pick(/^verge_mixed_port:\s*(\d+)/m) || DEFAULT_PORTS.mixed,
      socks: pick(/^verge_socks_port:\s*(\d+)/m) || DEFAULT_PORTS.socks,
      http: pick(/^verge_port:\s*(\d+)/m) || DEFAULT_PORTS.http,
    };
  } catch {
    return { ...DEFAULT_PORTS };
  }
}

// tasklist 抓进程名（Windows 专属）
function tasklistContains(nameFragment) {
  return new Promise((resolve) => {
    execFile(
      "tasklist.exe",
      ["/FI", `IMAGENAME eq ${nameFragment}`, "/NH"],
      { windowsHide: true, timeout: 3000 },
      (err, stdout) => {
        if (err) return resolve(false);
        // 命中会输出一行含进程名；空则是"信息: 没有运行的任务..."
        const s = String(stdout).trim();
        if (!s || /没有运行的任务|no tasks/i.test(s)) return resolve(false);
        resolve(s.toLowerCase().includes(nameFragment.toLowerCase()));
      }
    );
  });
}

// 端口探测：能建连即视为就绪
function probePort(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, reason) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve({ ok, reason });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true, "ok"));
    sock.once("timeout", () => finish(false, "timeout"));
    sock.once("error", (e) => finish(false, e.code || e.message));
    sock.connect(port, "127.0.0.1");
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      const r = await probePort(port, 800);
      if (r.ok) return { ready: true, waitedMs: Date.now() - (deadline - timeoutMs) };
      await new Promise((r2) => setTimeout(r2, 500));
    }
    return { ready: false, waitedMs: timeoutMs };
  })();
}

// 系统代理是否处于开启状态（读注册表 Internet Settings）
function readSystemProxyState() {
  try {
    const { execFileSync } = require("node:child_process");
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$r = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue; " +
        "$EnableProxyConfig = $r.EnableProxyConfig; " +
        "$ProxyServer = $r.ProxyServer; " +
        "Write-Output (\"$EnableProxyConfig|$ProxyServer\")",
      ],
      { encoding: "utf8", timeout: 3000, windowsHide: true }
    );
    const [cfg, srv] = out.split("\n")[0].trim().split("|");
    return {
      enabled: cfg === "1",
      server: srv || null,
    };
  } catch {
    return { enabled: false, server: null };
  }
}

// 打开 Clash Verge UI（不阻塞）
function spawnClashVerge() {
  return new Promise((resolve) => {
    if (!fs.existsSync(CLASH_VERGE_EXE)) {
      return resolve({ ok: false, error: `找不到可执行文件: ${CLASH_VERGE_EXE}` });
    }
    const child = spawn(CLASH_VERGE_EXE, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.unref();
    resolve({ ok: true, pid: child.pid });
  });
}

// 关闭 Clash Verge UI 进程（不动 service）
function killClashVergeUI() {
  return new Promise((resolve) => {
    execFile(
      "taskkill.exe",
      ["/IM", "clash-verge.exe", "/F"],
      { windowsHide: true, timeout: 5000 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

// 关掉系统代理（用户级）
function disableSystemProxy() {
  try {
    const { execFileSync } = require("node:child_process");
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; " +
        "Set-ItemProperty -Path $p -Name EnableProxyConfig -Value 0 -Type DWord; " +
        "Remove-ItemProperty -Path $p -Name ProxyServer -ErrorAction SilentlyContinue; " +
        "Remove-ItemProperty -Path $p -Name ProxyOverride -ErrorAction SilentlyContinue; " +
        "Get-ItemProperty $p | Out-Null",
      ],
      { encoding: "utf8", timeout: 3000, windowsHide: true }
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 用 curl 或 Node https 探活外部站点（走本机系统代理自动生效）
async function probeExternalUrl(url, timeoutMs) {
  const start = Date.now();
  const { execFileSync } = require("node:child_process");
  try {
    execFileSync(
      "curl.exe",
      [
        "-s", "-o", "NUL",
        "-w", "%{http_code}",
        "--max-time", String(Math.floor(timeoutMs / 1000)),
        "-I", url,
      ],
      { encoding: "utf8", timeout: timeoutMs + 1000, windowsHide: true }
    );
    return { ok: true, ms: Date.now() - start };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e.message.split("\n")[0] };
  }
}

// ---------------- 主状态聚合 ----------------

async function collectStatus() {
  const ports = readPortFromYaml();
  const [uiRunning, svcRunning, mixedProbe, socksProbe, httpProbe, sysProxy] =
    await Promise.all([
      tasklistContains("clash-verge.exe"),
      tasklistContains("clash-verge-service.exe"),
      probePort(ports.mixed),
      probePort(ports.socks),
      probePort(ports.http),
      Promise.resolve(readSystemProxyState()),
    ]);

  return {
    exePath: CLASH_VERGE_EXE,
    configDir: CONFIG_DIR,
    exeExists: fs.existsSync(CLASH_VERGE_EXE),
    uiRunning,
    serviceRunning: svcRunning,
    ports,
    mixedReachable: mixedProbe.ok,
    socksReachable: socksProbe.ok,
    httpReachable: httpProbe.ok,
    systemProxy: sysProxy,
    overallReady: uiRunning && mixedProbe.ok,
  };
}

function summarize(status, extra = {}) {
  const lines = [];
  lines.push(`Clash Verge UI: ${status.uiRunning ? "运行中" : "未运行"}`);
  lines.push(`Clash Verge 服务: ${status.serviceRunning ? "运行中" : "未运行"}`);
  lines.push(`端口 mixed=${status.ports.mixed}(${status.mixedReachable ? "可达" : "不可达"}), socks=${status.ports.socks}(${status.socksReachable ? "可达" : "不可达"}), http=${status.ports.http}(${status.httpReachable ? "可达" : "不可达"})`);
  lines.push(`系统代理: ${status.systemProxy.enabled ? "已开启 → " + status.systemProxy.server : "未开启"}`);
  if (status.exeExists) {
    lines.push(`程序: ${status.exePath}`);
  } else {
    lines.push(`⚠️ 未找到 clash-verge.exe，请先安装 Clash Verge`);
  }
  if (extra.note) lines.push(extra.note);
  return lines.join("\n");
}

// ---------------- 模块入口 ----------------

module.exports = {
  async register(ctx) {
    // ---------- status ----------
    ctx.registerTool({
      id: "clash-manager_status",
      name: "查询 Clash 状态",
      description:
        "查询 Clash Verge 当前运行状态：UI 是否在跑、服务是否在跑、代理端口是否可达、系统代理是否开启。" +
        "用户问「代理开了没」「Clash 在不在跑」「能上网了吗」，或需要判断是否要先启动 Clash 时使用。" +
        "只读工具，安全。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const s = await collectStatus();
        return {
          text: summarize(s),
          status: s,
        };
      },
    });

    // ---------- start ----------
    ctx.registerTool({
      id: "clash-manager_start",
      name: "启动 Clash",
      description:
        "启动 Clash Verge UI 主程序，并等待 mixed 端口就绪。" +
        "用户说「开代理」「打开 Clash」「连外网」「访问 google/github」，或你判断某个工具/请求需要代理时使用。" +
        "如果已经运行则直接返回当前状态，不会重复启动。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          waitMs: {
            type: "number",
            description: "等待 mixed 端口就绪的最长毫秒数，默认 30000，最大 60000",
          },
        },
        required: [],
      },
      async execute(args) {
        const waitMs = Math.min(
          Math.max(1000, (args && args.waitMs) || START_TIMEOUT_MS),
          60_000
        );

        const before = await collectStatus();
        // 已经在跑就直接返回
        if (before.uiRunning && before.mixedReachable) {
          return {
            text: summarize(before, { note: "已就绪，无需启动。" }),
            started: false,
            alreadyRunning: true,
            status: before,
          };
        }

        if (!before.exeExists) {
          return {
            text: `未找到 ${before.exePath}\n请确认已安装 Clash Verge。`,
            started: false,
            alreadyRunning: false,
            status: before,
          };
        }

        const spawnRes = await spawnClashVerge();
        if (!spawnRes.ok) {
          return {
            text: `启动失败: ${spawnRes.error}`,
            started: false,
            alreadyRunning: false,
            status: before,
          };
        }

        const wait = await waitForPort(before.ports.mixed, waitMs);
        const after = await collectStatus();

        if (wait.ready) {
          return {
            text: summarize(after, {
              note: `✓ Clash 已启动，mixed:${after.ports.mixed} 就绪（用时 ${Math.round(wait.waitedMs / 100) * 0.1}s）。`,
            }),
            started: true,
            alreadyRunning: false,
            status: after,
          };
        }

        return {
          text: summarize(after, {
            note: `⚠️ Clash UI 已拉起（PID ${spawnRes.pid}），但 mixed 端口 ${after.ports.mixed} 在 ${waitMs}ms 内没就绪。可能是首次启动要读 profile / 服务未就绪，稍等几秒再查一次。`,
          }),
          started: true,
          portReady: false,
          status: after,
        };
      },
    });

    // ---------- stop ----------
    ctx.registerTool({
      id: "clash-manager_stop",
      name: "停止 Clash",
      description:
        "关闭 Clash Verge UI 主程序，并关闭 Windows 系统代理设置（不影响 clash-verge-service.exe 服务）。" +
        "用户说「关代理」「关掉 Clash」「断开外网」「回到直连」时使用。",
      enabled: true,
      risk: "safe",
      effectKind: "write",
      inputSchema: {
        type: "object",
        properties: {
          alsoDisableSystemProxy: {
            type: "boolean",
            description: "是否同时关闭系统代理（默认 true）",
          },
        },
        required: [],
      },
      async execute(args) {
        const alsoDisable =
          args && args.alsoDisableSystemProxy !== undefined
            ? args.alsoDisableSystemProxy
            : true;

        const before = await collectStatus();
        if (!before.uiRunning && !before.systemProxy.enabled) {
          return {
            text: summarize(before, { note: "Clash UI 未运行，系统代理也关闭，无需操作。" }),
            stopped: false,
            alreadyStopped: true,
            status: before,
          };
        }

        const killRes = await killClashVergeUI();
        let proxyRes = { ok: true, skipped: !alsoDisable };
        if (alsoDisable && before.systemProxy.enabled) {
          proxyRes = disableSystemProxy();
        }

        const after = await collectStatus();
        return {
          text: summarize(after, {
            note: `✓ 已停止。\n  - UI 进程: ${killRes.ok ? "已结束" : "未在运行（或已自然退出）"}\n  - 系统代理: ${proxyRes.skipped ? "未操作" : proxyRes.ok ? "已关闭" : "关闭失败: " + proxyRes.error}`,
          }),
          stopped: true,
          alreadyStopped: false,
          status: after,
        };
      },
    });

    // ---------- test ----------
    ctx.registerTool({
      id: "clash-manager_test",
      name: "测试代理连通性",
      description:
        "通过系统代理探测外部站点（默认 github.com）是否可达，返回 HTTP 状态码与耗时。" +
        "用户说「代理通了吗」「能上 google 吗」，或刚启动完 Clash 想验证时使用。",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "要探测的 URL，默认 https://github.com/",
          },
          timeoutMs: {
            type: "number",
            description: "超时毫秒数，默认 6000，最大 15000",
          },
        },
        required: [],
      },
      async execute(args) {
        const url =
          (args && args.url) || "https://github.com/";
        const timeoutMs = Math.min(
          Math.max(1000, (args && args.timeoutMs) || TEST_TIMEOUT_MS),
          15_000
        );

        const status = await collectStatus();
        const res = await probeExternalUrl(url, timeoutMs);

        const lines = [];
        lines.push(`目标: ${url}`);
        lines.push(
          `结果: ${res.ok ? `✓ 可达 (${res.ms}ms)` : `✗ 失败 (${res.ms}ms) — ${res.error || "unknown"}`}`
        );
        lines.push(
          `Clash UI: ${status.uiRunning ? "在跑" : "未运行"} | 系统代理: ${status.systemProxy.enabled ? "已开启 → " + status.systemProxy.server : "未开启"}`
        );
        if (!status.systemProxy.enabled && !res.ok) {
          lines.push("提示: 系统代理未开启，可能连不上，可先运行 clash-manager_start。");
        }

        return {
          text: lines.join("\n"),
          reachable: res.ok,
          ms: res.ms,
          url,
          status,
        };
      },
    });

    // ---------- prompt provider ----------
    // 让昔涟每一轮都知道代理状态，方便主动判断要不要提醒用户开 Clash。
    // 只在「相关场景」时输出，非相关时返回空字符串，避免污染上下文。
    if (typeof ctx.registerPromptProvider === "function") {
      ctx.registerPromptProvider({
        id: "clash-status",
        modes: ["chat", "work", "code", "learn"],
        async provide({ userText, signal }) {
          if (signal && signal.aborted) return "";
          const text = String(userText || "").toLowerCase();
          const triggers = [
            "proxy", "代理", "翻墙", "上网", "外网", "github", "google", "youtube",
            "google.com", "bilibili.com", "twitter", "x.com", "clash",
            "npm install", "pip install", "git clone", "访问",
            "https://", "fetch", "download", "下载",
          ];
          if (!triggers.some((t) => text.includes(t))) return "";

          try {
            const s = await collectStatus();
            if (!s.exeExists) return "";
            const state = s.overallReady
              ? `就绪(mixed:${s.ports.mixed})`
              : s.uiRunning
                ? "UI 在跑但端口未就绪"
                : s.serviceRunning
                  ? "服务在跑，UI 未运行"
                  : "未运行";
            return `【Clash】${state}；系统代理 ${s.systemProxy.enabled ? "已开启 → " + s.systemProxy.server : "未开启"}。可用工具：clash-manager_start / _stop / _status / _test`;
          } catch {
            return "";
          }
        },
      });
    }

    ctx.log("[clash-manager] 已注册 status / start / stop / test + prompt provider");
  },

  async unregister() {
    // 无后台资源要清理，start 出去的 clash-verge.exe 生命周期归用户，插件不接管
  },
};
