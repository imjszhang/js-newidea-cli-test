'use strict';

const { DEFAULT_DRIVER, DEFAULT_PAGE, PAGE_PROFILES, TARGET_URL_FRAGMENT } = require('./config');

const COMMANDS = {
  doctor:      { kind: 'special', help: '连通性 + 注入 + probe 汇总', pages: ['outline', 'home'] },
  tree:        { kind: 'special', help: '打印提纲（默认缩进文本，--json 原始结构）', pages: ['outline'] },
  get:         { kind: 'call', api: 'get', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p], pages: ['outline'] },
  find:        { kind: 'call', api: 'find', argSpec: [{ name: 'keyword', required: true }], toArgs: (_o, [kw]) => [{ contains: kw }], pages: ['outline'] },
  select:      { kind: 'call', api: 'select', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p], pages: ['outline'] },
  expand:      { kind: 'call', api: 'expand', argSpec: [{ name: 'path', required: true }], toArgs: (o, [p]) => [p, { deep: !!o.deep }], pages: ['outline'] },
  collapse:    { kind: 'call', api: 'collapse', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p], pages: ['outline'] },
  'scroll-to': { kind: 'call', api: 'scrollIntoView', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p], pages: ['outline'] },
  rename:      { kind: 'call', api: 'rename', argSpec: [{ name: 'path', required: true }, { name: 'text', required: true }], toArgs: (_o, [p, t]) => [p, t], pages: ['outline'] },
  edit:        { kind: 'call', api: 'editBody', argSpec: [{ name: 'path', required: true }, { name: 'text', required: true }], toArgs: (_o, [p, t]) => [p, t], pages: ['outline'] },
  'node-key':  { kind: 'call', api: 'nodeKey', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p], pages: ['outline'] },
  'add-child': { kind: 'call', api: 'addChild', argSpec: [{ name: 'path', required: true }, { name: 'text', required: false }], toArgs: (_o, pos) => pos.length >= 2 ? [pos[0], pos[1]] : [pos[0]], pages: ['outline'] },
  'add-after': { kind: 'call', api: 'addSibling', argSpec: [{ name: 'path', required: true }, { name: 'text', required: false }], toArgs: (_o, pos) => [pos[0], pos[1] || '', { where: 'after' }], pages: ['outline'] },
  'add-before':{ kind: 'call', api: 'addSibling', argSpec: [{ name: 'path', required: true }, { name: 'text', required: false }], toArgs: (_o, pos) => [pos[0], pos[1] || '', { where: 'before' }], pages: ['outline'] },
  remove:      { kind: 'call', api: 'remove', argSpec: [{ name: 'path', required: true }], toArgs: (_o, [p]) => [p], pages: ['outline'] },
  cta:         { kind: 'special', help: '点击全局 CTA（返回首页/下载提纲/生成全文）；后者需 --confirm', pages: ['outline'] },
  primary:     { kind: 'call', api: 'clickPrimary', argSpec: [{ name: 'action', required: true }, { name: 'topic', required: false }], toArgs: (_o, pos) => pos.length >= 2 ? [pos[0], { topic: pos[1] }] : [pos[0]], help: '点击 home 主按钮（继续编辑本地文档/生成提纲，可附带 topic）', pages: ['home'] },
  topic:       { kind: 'call', api: 'setTopic', argSpec: [{ name: 'text', required: true }], toArgs: (_o, [text]) => [text], help: '设置 home 页综述主题输入框', pages: ['home'] },
  state:       { kind: 'call', api: 'state', argSpec: [], toArgs: () => [], pages: ['outline', 'home'] },
  probe:       { kind: 'call', api: 'probe', argSpec: [], toArgs: () => [], pages: ['outline', 'home'] },
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
    visual: true,
    visualMs: null,
    visualDetail: 'staged',
    page: null,
    driver: DEFAULT_DRIVER,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--deep') opts.deep = true;
    else if (a === '--confirm') opts.confirm = true;
    else if (a === '--visual') opts.visual = true;
    else if (a === '--no-visual') opts.visual = false;
    else if (a === '--visual-detail') opts.visualDetail = argv[++i] || 'staged';
    else if (a.startsWith('--visual-detail=')) opts.visualDetail = a.slice('--visual-detail='.length) || 'staged';
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--visual-ms') opts.visualMs = argv[++i];
    else if (a.startsWith('--visual-ms=')) opts.visualMs = a.slice('--visual-ms='.length);
    else if (a === '--tab') opts.tab = argv[++i];
    else if (a.startsWith('--tab=')) opts.tab = a.slice('--tab='.length);
    else if (a === '--page') opts.page = argv[++i];
    else if (a.startsWith('--page=')) opts.page = a.slice('--page='.length);
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
    const pageHint = def.pages && def.pages.length === 1 ? ` [${def.pages[0]}]` : '';
    lines.push(`  ${name.padEnd(12)} ${args.padEnd(24)} ${(def.help || '') + pageHint}`);
  }
  lines.push(
    '',
    'Options:',
    `  --tab <id>        强制指定目标页（默认自动匹配 ${TARGET_URL_FRAGMENT}）`,
    `  --page <name>     选择页面 profile（${Object.keys(PAGE_PROFILES).join(' | ')}；默认 command-specific / ${DEFAULT_PAGE}）`,
    `  --driver <name>   选择驱动（jseyes | playwright，默认 ${DEFAULT_DRIVER}）`,
    '  --json            JSON 输出',
    '  --deep            expand 深度展开',
    '  --confirm         仅用于破坏性 cta（生成全文 / 返回首页）',
    '  --visual          显式开启页面内视觉反馈（默认已开启）',
    '  --no-visual       关闭页面内视觉反馈',
    '  --visual-detail   反馈粒度（compact | staged，默认 staged）',
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
