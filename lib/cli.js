'use strict';

const { COMMANDS, DESTRUCTIVE_CTAS, parseArgv, printHelp } = require('./commands');
const { DEFAULT_PAGE, getPageProfile } = require('./config');
const { createDriver } = require('./driver-factory');
const { renderResult } = require('./render');
const { Session } = require('./session');

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    printHelp();
    return 0;
  }

  const [cmd, ...rest] = argv;
  const def = COMMANDS[cmd];
  if (!def) {
    console.error(`未知命令: ${cmd}`);
    printHelp();
    return 3;
  }

  const { opts, positional } = parseArgv(rest);
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.visualMs != null) {
    const n = Number(opts.visualMs);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`--visual-ms 需要正数，收到 ${JSON.stringify(opts.visualMs)}`);
      return 3;
    }
    opts.visualMs = Math.round(n);
  }
  if (!['compact', 'staged'].includes(opts.visualDetail)) {
    console.error(`--visual-detail 只能是 compact 或 staged，收到 ${JSON.stringify(opts.visualDetail)}`);
    return 3;
  }
  if (opts.page == null) {
    const pages = def.pages || [];
    opts.page = pages.length === 1 ? pages[0] : DEFAULT_PAGE;
  }
  let pageProfile;
  try {
    pageProfile = getPageProfile(opts.page);
  } catch (e) {
    console.error(`[cli] ${e.code || 'E_BAD_ARG'}: ${e.message}`);
    return 3;
  }
  if (def.pages && !def.pages.includes(opts.page)) {
    console.error(`命令 ${cmd} 不支持 page=${opts.page}；可用页面：${def.pages.join(', ')}`);
    return 3;
  }

  const required = (def.argSpec || []).filter((spec) => spec.required).length;
  if (def.kind === 'call' && positional.length < required) {
    console.error(`${cmd} 需要 ${required} 个位置参数，收到 ${positional.length}`);
    printHelp();
    return 3;
  }

  const driver = createDriver(opts.driver, opts);
  const sess = new Session({ driver, opts });
  try {
    await sess.connect();
    await sess.resolveTarget();
    await sess.ensureBridge();

    if (cmd === 'doctor') {
      const [probe, state] = await Promise.all([sess.callApi('probe'), sess.callApi('state')]);
      const summary = {
        driver: opts.driver,
        tabId: sess.targetId,
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
      if (positional.length < 1) {
        console.error('cta 需要 <name>');
        return 3;
      }
      const name = positional[0];
      if (DESTRUCTIVE_CTAS.has(name) && !opts.confirm) {
        console.error(`"${name}" 是破坏性操作（会离开 ${pageProfile.routeLabel}），请加 --confirm 再试。`);
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
  } finally {
    await sess.close();
  }
}

module.exports = {
  main,
};
