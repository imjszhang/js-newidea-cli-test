#!/usr/bin/env node
/**
 * outline-cli.js —— 通过 js-eyes 远程驱动 outline-bridge.js 的命令行。
 *
 * v0.7.0 全自动版：底层经 page-world 注入调用 React 组件上暴露的 handlers，
 * 不再走"打开 Slate 编辑器 + 等用户手动点替换原文"的半自动流程。
 *
 * 使用示例：
 *   node outline-cli.js doctor
 *   node outline-cli.js tree --json
 *   node outline-cli.js find "摘要"
 *   node outline-cli.js rename 0.2.0.0 "新要点文本"
 *   node outline-cli.js add-child 0.2 "新子节点"
 *   node outline-cli.js remove 0.2.0.0
 *   node outline-cli.js cta 下载提纲
 *   node outline-cli.js cta 生成全文 --confirm    # 离开 /outline，必须显式 --confirm
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BrowserAutomation } = require('@js-eyes/client-sdk');

const BRIDGE_PATH = path.join(__dirname, 'outline-bridge.js');
const TARGET_URL_FRAGMENT = 'review.newidea.pro/outline';

const COMMANDS = {
  doctor:      { kind: 'special', help: '连通性 + 注入 + probe 汇总' },
  tree:        { kind: 'special', help: '打印提纲（默认缩进文本，--json 原始结构）' },
  get:         { kind: 'call', api: 'get', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p] },
  find:        { kind: 'call', api: 'find', argSpec: [{ name: 'keyword', required: true }], toArgs: (_o, [kw]) => [{ contains: kw }] },
  select:      { kind: 'call', api: 'select', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p] },
  expand:      { kind: 'call', api: 'expand', argSpec: [{ name: 'path', required: true }], toArgs: (o, [p]) => [p, { deep: !!o.deep }] },
  collapse:    { kind: 'call', api: 'collapse', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p] },
  'scroll-to': { kind: 'call', api: 'scrollIntoView', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p] },
  rename:      { kind: 'call', api: 'rename', argSpec: [{ name: 'path', required: true }, { name: 'text', required: true }], toArgs: (_o, [p, t]) => [p, t] },
  edit:        { kind: 'call', api: 'editBody', argSpec: [{ name: 'path', required: true }, { name: 'text', required: true }], toArgs: (_o, [p, t]) => [p, t] },
  'node-key':  { kind: 'call', api: 'nodeKey', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p] },
  'add-child': { kind: 'call', api: 'addChild', argSpec: [{ name: 'path', required: true }, { name: 'text', required: false }], toArgs: (_o, pos) => pos.length >= 2 ? [pos[0], pos[1]] : [pos[0]] },
  'add-after': { kind: 'call', api: 'addSibling', argSpec: [{ name: 'path', required: true }, { name: 'text', required: false }], toArgs: (_o, pos) => [pos[0], pos[1] || '', { where: 'after' }] },
  'add-before':{ kind: 'call', api: 'addSibling', argSpec: [{ name: 'path', required: true }, { name: 'text', required: false }], toArgs: (_o, pos) => [pos[0], pos[1] || '', { where: 'before' }] },
  remove:      { kind: 'call', api: 'remove', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p] },
  cta:         { kind: 'special', help: '点击全局 CTA（返回首页/下载提纲/生成全文）；后者需 --confirm' },
  state:       { kind: 'call', api: 'state', argSpec: [], toArgs: () => [] },
  probe:       { kind: 'call', api: 'probe', argSpec: [], toArgs: () => [] },
};

const DESTRUCTIVE_CTAS = new Set(['生成全文', '返回首页']);

function parseArgv(argv) {
  const opts = { tab: null, json: false, deep: false, verbose: false, help: false, confirm: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--deep') opts.deep = true;
    else if (a === '--confirm') opts.confirm = true;
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--tab') opts.tab = parseInt(argv[++i], 10);
    else if (a.startsWith('--tab=')) opts.tab = parseInt(a.slice('--tab='.length), 10);
    else positional.push(a);
  }
  return { opts, positional };
}

function printHelp() {
  const lines = ['Usage: outline-cli <command> [args] [options]', '', 'Commands:'];
  for (const [name, def] of Object.entries(COMMANDS)) {
    const args = (def.argSpec || []).map((s) => s.required ? `<${s.name}>` : `[${s.name}]`).join(' ');
    lines.push(`  ${name.padEnd(12)} ${args.padEnd(24)} ${def.help || ''}`);
  }
  lines.push(
    '',
    'Options:',
    '  --tab <id>     强制指定 tab id（默认自动匹配 review.newidea.pro/outline）',
    '  --json         JSON 输出',
    '  --deep         expand 深度展开',
    '  --confirm      仅用于破坏性 cta（生成全文 / 返回首页）',
    '  -v, --verbose  打印细节',
    '  -h, --help     显示帮助',
  );
  console.log(lines.join('\n'));
}

class Session {
  constructor(opts) { this.opts = opts; this.bot = null; this.tabId = null; }
  log(msg) { if (this.opts.verbose) process.stderr.write(`[cli] ${msg}\n`); }

  async connect() {
    const silent = this.opts.verbose
      ? console
      : { info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a), log: () => {} };
    this.bot = new BrowserAutomation('ws://localhost:18080', { logger: silent });
    await this.bot.connect();
    this.log('connected');
  }

  async resolveTab() {
    if (this.opts.tab) { this.tabId = this.opts.tab; this.log(`tab: ${this.tabId} (explicit)`); return; }
    const tabs = await this.bot.getTabs();
    const list = Array.isArray(tabs) ? tabs : (tabs && tabs.tabs) || [];
    const hit = list.find((t) => (t.url || '').includes(TARGET_URL_FRAGMENT));
    if (!hit) {
      throw Object.assign(new Error(`未找到包含 ${TARGET_URL_FRAGMENT} 的 tab；可用 tabs=\n` + list.map(t => `  [${t.id}] ${t.url}`).join('\n')), { code: 'E_NO_TAB' });
    }
    this.tabId = parseInt(hit.id, 10);
    this.log(`tab: ${this.tabId} (${hit.url})`);
  }

  async callRaw(expr) {
    const res = await this.bot.executeScript(this.tabId, expr, { timeout: 30 });
    if (typeof res === 'string') { try { return JSON.parse(res); } catch { return res; } }
    return res;
  }

  async ensureBridge() {
    const expected = this.readBridgeVersion();
    const cur = await this.callRaw('(window.__jse_outline__?.__meta?.version) || null');
    if (cur === expected) { this.log(`bridge up-to-date (${expected})`); return; }
    this.log(`bridge ${cur ? 'stale '+cur : 'missing'}, installing ${expected}…`);
    const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
    const result = await this.callRaw(src);
    if (!result || result.ok !== true) {
      throw Object.assign(new Error('bridge 注入失败: ' + JSON.stringify(result)), { code: 'E_INSTALL' });
    }
    this.log(`bridge installed at ${result.installedAt}, version=${result.version}`);
  }

  readBridgeVersion() {
    const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
    const m = src.match(/const\s+VERSION\s*=\s*['"]([\w.\-+]+)['"]/);
    if (!m) throw new Error('outline-bridge.js 里没找到 VERSION');
    return m[1];
  }

  async callApi(method, args = []) {
    const payload = JSON.stringify(args);
    const code = `Promise.resolve(window.__jse_outline__.${method}(...${payload})).then(r=>JSON.stringify(r))`;
    return await this.callRaw(code);
  }

  close() { try { this.bot && this.bot.disconnect(); } catch {} }
}

function renderTree(entries) {
  return entries.map((e) => {
    const indent = '  '.repeat(e.depth);
    const tag = e.switcher === 'leaf' ? '  ' : e.switcher === 'open' ? '▾ ' : '▸ ';
    return `${e.path.padEnd(10)} ${indent}${tag}${e.text || '(空)'}`;
  }).join('\n');
}

function renderResult(result, opts) {
  if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
  if (!result || typeof result !== 'object') { console.log(String(result)); return; }
  if (result.ok === false) { console.error(`ERROR [${result.code || 'E_UNKNOWN'}] ${result.message || ''}`); return; }
  const data = result.data;
  if (Array.isArray(data) && data.length && typeof data[0] === 'object' && 'path' in data[0] && 'depth' in data[0]) {
    console.log(renderTree(data));
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw[0] === '-h' || raw[0] === '--help') { printHelp(); return 0; }
  const [cmd, ...rest] = raw;
  const def = COMMANDS[cmd];
  if (!def) { console.error(`未知命令: ${cmd}`); printHelp(); return 3; }
  const { opts, positional } = parseArgv(rest);
  if (opts.help) { printHelp(); return 0; }

  const required = (def.argSpec || []).filter((s) => s.required).length;
  if (def.kind === 'call' && positional.length < required) {
    console.error(`${cmd} 需要 ${required} 个位置参数，收到 ${positional.length}`);
    printHelp();
    return 3;
  }

  const sess = new Session(opts);
  try {
    await sess.connect();
    await sess.resolveTab();
    await sess.ensureBridge();

    if (cmd === 'doctor') {
      const [probe, state] = await Promise.all([sess.callApi('probe'), sess.callApi('state')]);
      const summary = {
        tabId: sess.tabId,
        bridgeVersion: sess.readBridgeVersion(),
        probe: probe && probe.ok ? probe.data : probe,
        state: state && state.ok ? state.data : state,
      };
      console.log(JSON.stringify(summary, null, 2));
      return (probe && probe.ok && state && state.ok) ? 0 : 1;
    }

    if (cmd === 'tree') {
      const res = await sess.callApi('tree');
      renderResult(res, opts);
      return res && res.ok ? 0 : 1;
    }

    if (cmd === 'cta') {
      if (positional.length < 1) { console.error('cta 需要 <name>'); return 3; }
      const name = positional[0];
      if (DESTRUCTIVE_CTAS.has(name) && !opts.confirm) {
        console.error(`"${name}" 是破坏性操作（会离开 /outline），请加 --confirm 再试。`);
        return 3;
      }
      const res = await sess.callApi('clickCta', [name]);
      renderResult(res, opts);
      return res && res.ok ? 0 : 1;
    }

    if (def.kind === 'call') {
      const args = def.toArgs(opts, positional);
      const res = await sess.callApi(def.api, args);
      renderResult(res, opts);
      return res && res.ok ? 0 : 1;
    }

    console.error(`命令 ${cmd} 尚未实现`);
    return 3;
  } catch (e) {
    console.error(`[cli] ${e.code || 'E_UNKNOWN'}: ${e.message}`);
    return 2;
  } finally { sess.close(); }
}

main().then((c) => process.exit(c || 0)).catch((e) => { console.error(e); process.exit(2); });
