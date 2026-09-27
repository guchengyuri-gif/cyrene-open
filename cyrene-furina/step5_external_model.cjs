'use strict';
/*
 * step5：外部模型目录改造（幂等）
 *
 * 目标：以后导入 Live2D 模型不需要重新打包 app.asar
 *
 *  1) 主进程 protocols/bootstrap.js
 *     - 注册特权协议 cyrene-model（standard/secure/supportFetchAPI/stream/corsEnabled）
 *     - 注册 handler：userData/pet-models/<id>/<file> 优先，回退 app.asar 内 dist/renderer/models/<id>/<file>
 *       · 带 path.resolve + startsWith 穿越防护
 *       · 用 net.fetch(pathToFileURL(...)) 返回，兼容 asar 内读取
 *
 *  2) 渲染层 renderer bundle
 *     - hx() 返回 cyrene-model://pet/<id>/<Cap>.model3.json
 *     - 去掉 ef(...) 包装（ef 是 baseURL 字符串拼接，会把绝对 URL 拼坏）
 *
 *  3) 设置页 settings/index.html
 *     - <select id="pet-model"> → <input id="pet-model" list="pet-model-presets"> + <datalist>
 *       （JS 绑定只读 .value / 听 change，input 完全兼容；且 input 不会被未知 value 清空）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TREE = 'D:/ai/program/cyrene-furina/work/src';
const done = [];
const skip = [];

/* ============================================================
 * 1) 主进程：注册协议 + handler
 * ============================================================ */
const BOOT = path.join(TREE, 'dist/main/main/protocols/bootstrap.js');
{
  let b = fs.readFileSync(BOOT, 'utf8');

  if (b.includes('cyrene-model')) {
    skip.push('bootstrap.js（已含 cyrene-model）');
  } else {
    // --- 1a) 特权注册 ---
    const SCHEME_ANCHOR = '        { scheme: "moment-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },\n';
    const SCHEME_ADD = '        { scheme: "cyrene-model", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },\n';
    if (b.split(SCHEME_ANCHOR).length - 1 !== 1) throw new Error('bootstrap: moment-media scheme 锚点命中数异常');
    b = b.replace(SCHEME_ANCHOR, SCHEME_ANCHOR + SCHEME_ADD);

    // --- 1b) handler（插在 local-font handler 之后、函数结尾之前）---
    const HANDLER_ANCHOR = '        }));\n    });\n}\n//# sourceMappingURL=bootstrap.js.map';
    const HANDLER = [
      '    electron_1.protocol.handle("cyrene-model", (request) => {',
      '        let host;',
      '        let rel;',
      '        try {',
      '            const parsed = new URL(request.url);',
      '            host = decodeURIComponent(parsed.hostname);',
      '            rel = decodeURIComponent(parsed.pathname).replace(/^\\/+/, "");',
      '        }',
      '        catch {',
      '            return new Response("Invalid model URL", { status: 404 });',
      '        }',
      '        if (host !== "pet" || !rel)',
      '            return new Response("Invalid model URL", { status: 404 });',
      '        const roots = [',
      '            path.join(electron_1.app.getPath("userData"), "pet-models"),',
      '            path.join(electron_1.app.getAppPath(), "dist", "renderer", "models"),',
      '        ];',
      '        for (const root of roots) {',
      '            const base = path.resolve(root);',
      '            const file = path.resolve(base, rel);',
      '            if (file !== base && !file.startsWith(base + path.sep))',
      '                continue;',
      '            try {',
      '                if (!fs.statSync(file).isFile())',
      '                    continue;',
      '            }',
      '            catch {',
      '                continue;',
      '            }',
      '            return electron_1.net.fetch((0, url_1.pathToFileURL)(file).toString());',
      '        }',
      '        return new Response("Model file not found", { status: 404 });',
      '    });',
      '',
    ].join('\n');
    if (b.split(HANDLER_ANCHOR).length - 1 !== 1) throw new Error('bootstrap: 函数结尾锚点命中数异常');
    b = b.replace(HANDLER_ANCHOR, '        }));\n    });\n' + HANDLER + '}\n//# sourceMappingURL=bootstrap.js.map');

    fs.writeFileSync(BOOT, b, 'utf8');
    execFileSync(process.execPath, ['--check', BOOT], { stdio: 'pipe' });
    done.push('bootstrap.js（协议注册 + handler，已过 node --check）');
  }
}

/* ============================================================
 * 2) 渲染层：hx() 返回协议 URL，去掉 ef() 包装
 * ============================================================ */
{
  const ADIR = path.join(TREE, 'dist/renderer/assets');
  let target = null;
  for (const f of fs.readdirSync(ADIR)) {
    if (!/^renderer-[^/]+\.js$/.test(f) || f.startsWith('renderer-base-')) continue;
    const s = fs.readFileSync(path.join(ADIR, f), 'utf8');
    if (s.includes('function hx(r)')) { target = path.join(ADIR, f); break; }
  }
  if (!target) throw new Error('renderer: 找不到含 hx() 的 bundle');

  let r = fs.readFileSync(target, 'utf8');
  const name = path.basename(target);

  if (r.includes('cyrene-model://pet/')) {
    skip.push(name + '（已含协议 URL）');
  } else {
    const HX_OLD = 'function hx(r){const t=r.replace(/[^a-zA-Z0-9_-]/g,""),e=t.charAt(0).toUpperCase()+t.slice(1);return`models/${t}/${e}.model3.json`}';
    const HX_NEW = 'function hx(r){const t=r.replace(/[^a-zA-Z0-9_-]/g,"")||"cyrene",e=t.charAt(0).toUpperCase()+t.slice(1);return`cyrene-model://pet/${t}/${e}.model3.json`}';
    const EF_OLD = 'const t=ef(hx(r)),e=new Yv(';
    const EF_NEW = 'const t=hx(r),e=new Yv(';

    if (r.split(HX_OLD).length - 1 !== 1) throw new Error(name + ': hx() 锚点命中数异常');
    if (r.split(EF_OLD).length - 1 !== 1) throw new Error(name + ': ef(hx(r)) 锚点命中数异常');

    r = r.replace(HX_OLD, HX_NEW).replace(EF_OLD, EF_NEW);
    if (!r.includes('cyrene-model://pet/') || r.includes(EF_OLD)) throw new Error(name + ': 替换结果自检失败');
    fs.writeFileSync(target, r, 'utf8');
    done.push(name + '（hx()→协议 URL，已去掉 ef 包装）');
  }
}

/* ============================================================
 * 3) 设置页：select → input + datalist
 * ============================================================ */
{
  const SETTINGS = path.join(TREE, 'dist/renderer/settings/index.html');
  let html = fs.readFileSync(SETTINGS, 'utf8');

  if (html.includes('id="pet-model-presets"')) {
    skip.push('settings/index.html（已是 input + datalist）');
  } else {
    const re = /([ \t]*)<select id="pet-model"[^>]*>([\s\S]*?)<\/select>/;
    const m = html.match(re);
    if (!m) throw new Error('settings: 找不到 <select id="pet-model">');
    const indent = m[1];

    const opts = [];
    const ore = /<option value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g;
    let om;
    while ((om = ore.exec(m[2])) !== null) opts.push({ v: om[1], t: om[2].trim() });
    if (!opts.length) throw new Error('settings: pet-model 里没有解析到 option');

    const lines = [
      indent + '<input id="pet-model" class="setting-select" type="text" list="pet-model-presets" autocomplete="off" spellcheck="false" placeholder="模型 ID（如 cyrene / furina）" />',
      indent + '<datalist id="pet-model-presets">',
      ...opts.map((o) => indent + '  <option value="' + o.v + '">' + o.t + '</option>'),
      indent + '</datalist>',
    ];
    html = html.replace(re, lines.join('\n'));
    if (!html.includes('id="pet-model-presets"') || html.includes('<select id="pet-model"')) {
      throw new Error('settings: 替换结果自检失败');
    }
    fs.writeFileSync(SETTINGS, html, 'utf8');
    done.push('settings/index.html（select → input + datalist，保留 ' + opts.length + ' 个候选：' + opts.map((o) => o.v).join('/') + '）');
  }
}

/* ============================================================ */
console.log('\n===== step5 结果 =====');
done.forEach((d) => console.log('  [改] ' + d));
skip.forEach((s) => console.log('  [跳] ' + s));
console.log('[done] 外部模型目录改造完成');
