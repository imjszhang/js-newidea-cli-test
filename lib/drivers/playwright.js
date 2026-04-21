'use strict';

const { DEFAULT_CDP_ENDPOINT } = require('../config');

function parseMaybeJson(result) {
  if (typeof result !== 'string') return result;
  try { return JSON.parse(result); } catch { return result; }
}

function withTimeout(promise, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(Object.assign(new Error(`脚本执行超时（>${timeoutMs}ms）`), { code: 'E_TIMEOUT' }));
      }, timeoutMs);
    }),
  ]);
}

class PlaywrightDriver {
  constructor(options = {}) {
    this.opts = options;
    this.browser = null;
    this.target = null;
    this.playwright = null;
  }

  log(msg) {
    if (this.opts.verbose) process.stderr.write(`[driver:playwright] ${msg}\n`);
  }

  async connect() {
    if (!this.playwright) this.playwright = require('playwright');
    const endpoint = this.opts.cdpEndpoint || DEFAULT_CDP_ENDPOINT;
    try {
      this.browser = await this.playwright.chromium.connectOverCDP(endpoint);
    } catch (e) {
      throw Object.assign(new Error(`无法连接到 Chromium CDP（${endpoint}）。请先用 --remote-debugging-port=9222 启动 Chrome/Edge，或改用 --driver jseyes。原始错误: ${e.message}`), { code: 'E_DRIVER_CONNECT' });
    }
    this.log(`connected via CDP ${endpoint}`);
  }

  async disconnect() {
    // connectOverCDP 连接到用户现有浏览器时不要主动关浏览器。
  }

  async listTargets() {
    const targets = [];
    let idx = 0;
    for (const context of this.browser.contexts()) {
      for (const page of context.pages()) {
        targets.push({ id: String(idx), url: page.url() || '', page });
        idx += 1;
      }
    }
    return targets;
  }

  async resolveTarget({ targetId, urlFragment }) {
    const targets = await this.listTargets();
    const hit = targetId != null
      ? targets.find((target) => target.id === String(targetId))
      : targets.find((target) => target.url.includes(urlFragment));
    if (!hit) {
      throw Object.assign(new Error(`未找到包含 ${urlFragment} 的页面；可用 targets=\n` + targets.map((target) => `  [${target.id}] ${target.url}`).join('\n')), { code: 'E_NO_TAB' });
    }
    this.target = hit;
    this.log(`page: ${this.target.id} (${this.target.url})`);
    return { id: hit.id, url: hit.url };
  }

  async evaluate(expression, options = {}) {
    if (!this.target || !this.target.page) {
      throw Object.assign(new Error('尚未 resolveTarget'), { code: 'E_NO_TAB' });
    }
    const result = await withTimeout(
      this.target.page.evaluate((expr) => eval(expr), expression),
      options.timeoutMs || 30000,
    );
    return parseMaybeJson(result);
  }
}

module.exports = {
  PlaywrightDriver,
};
