#!/usr/bin/env node
/**
 * outline-cli.js —— 通过可插拔浏览器驱动远程调用 outline-bridge.js 的命令行。
 *
 * 默认 driver 为 playwright（连接现有 Chromium CDP 会话），
 * 可通过 --driver jseyes 回退到历史路径。
 */
'use strict';

const { main } = require('./lib/cli');

main().then((c) => process.exit(c || 0)).catch((e) => { console.error(e); process.exit(2); });
