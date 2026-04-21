'use strict';

const { DEFAULT_DRIVER, TARGET_URL_FRAGMENT } = require('./config');

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
  const opts = {
    tab: null,
    json: false,
    deep: false,
    verbose: false,
    help: false,
    confirm: false,
    visual: false,
    visualMs: null,
    driver: DEFAULT_DRIVER,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--deep') opts.deep = true;
    else if (a === '--confirm') opts.confirm = true;
    else if (a === '--visual') opts.visual = true;
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--visual-ms') opts.visualMs = argv[++i];
    else if (a.startsWith('--visual-ms=')) opts.visualMs = a.slice('--visual-ms='.length);
    else if (a === '--tab') opts.tab = argv[++i];
    else if (a.startsWith('--tab=')) opts.tab = a.slice('--tab='.length);
    else if (a === '--driver') opts.driver = argv[++i] || DEFAULT_DRIVER;
    else if (a.startsWith('--driver=')) opts.driver = a.slice('--driver='.length) || DEFAULT_DRIVER;
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
    `  --tab <id>        强制指定目标页（默认自动匹配 ${TARGET_URL_FRAGMENT}）`,
    `  --driver <name>   选择驱动（jseyes | playwright，默认 ${DEFAULT_DRIVER}）`,
    '  --json            JSON 输出',
    '  --deep            expand 深度展开',
    '  --confirm         仅用于破坏性 cta（生成全文 / 返回首页）',
    '  --visual          在页面上显示当前操作目标和结果',
    '  --visual-ms <n>   可视反馈持续时长（毫秒）',
    '  -v, --verbose     打印细节',
    '  -h, --help        显示帮助',
  );
  console.log(lines.join('\n'));
}

module.exports = {
  COMMANDS,
  DESTRUCTIVE_CTAS,
  parseArgv,
  printHelp,
};
