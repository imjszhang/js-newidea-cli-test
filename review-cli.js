#!/usr/bin/env node
/**
 * review-cli.js —— review.newidea.pro 多页面工作台 CLI 主入口。
 *
 * 通过 --page 选择 outline / home 等页面 profile，
 * 再由 session 层注入对应 bridge 并执行命令。
 */
'use strict';

const { main } = require('./lib/cli');

main().then((c) => process.exit(c || 0)).catch((e) => { console.error(e); process.exit(2); });
