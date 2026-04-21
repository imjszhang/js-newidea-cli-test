'use strict';

const { DEFAULT_JSEYES_WS_ENDPOINT } = require('../config');

function parseMaybeJson(result) {
  if (typeof result !== 'string') return result;
  try { return JSON.parse(result); } catch { return result; }
}

class JseyesDriver {
  constructor(options = {}) {
    this.opts = options;
    this.bot = null;
    this.target = null;
  }

  log(msg) {
    if (this.opts.verbose) process.stderr.write(`[driver:jseyes] ${msg}\n`);
  }

  async connect() {
    const { BrowserAutomation } = require('@js-eyes/client-sdk');
    const logger = this.opts.verbose
      ? console
      : { info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a), log: () => {} };
    const endpoint = this.opts.wsEndpoint || DEFAULT_JSEYES_WS_ENDPOINT;
    this.bot = new BrowserAutomation(endpoint, { logger });
    try {
      await this.bot.connect();
    } catch (e) {
      throw Object.assign(new Error(`无法连接到 js-eyes server（${endpoint}）。请先启动 js-eyes server，或改用 --driver playwright。原始错误: ${e.message}`), { code: 'E_DRIVER_CONNECT' });
    }
    this.log('connected');
  }

  async disconnect() {
    try {
      if (this.bot) this.bot.disconnect();
    } catch {}
  }

  async listTargets() {
    const tabs = await this.bot.getTabs();
    const list = Array.isArray(tabs) ? tabs : (tabs && tabs.tabs) || [];
    return list.map((tab) => ({ id: String(tab.id), url: tab.url || '' }));
  }

  async resolveTarget({ targetId, urlFragment }) {
    if (targetId != null) {
      const rawId = parseInt(targetId, 10);
      if (Number.isNaN(rawId)) {
        throw Object.assign(new Error(`tab id 非法: ${JSON.stringify(targetId)}`), { code: 'E_BAD_ARG' });
      }
      this.target = { id: String(rawId), rawId, url: '(explicit)' };
      this.log(`tab: ${this.target.id} (explicit)`);
      return this.target;
    }
    const list = await this.listTargets();
    const hit = list.find((tab) => tab.url.includes(urlFragment));
    if (!hit) {
      throw Object.assign(new Error(`未找到包含 ${urlFragment} 的 tab；可用 tabs=\n` + list.map((tab) => `  [${tab.id}] ${tab.url}`).join('\n')), { code: 'E_NO_TAB' });
    }
    this.target = { id: hit.id, rawId: parseInt(hit.id, 10), url: hit.url };
    this.log(`tab: ${this.target.id} (${this.target.url})`);
    return this.target;
  }

  async evaluate(expression, options = {}) {
    if (!this.target) {
      throw Object.assign(new Error('尚未 resolveTarget'), { code: 'E_NO_TAB' });
    }
    const timeoutSec = Math.max(1, Math.ceil((options.timeoutMs || 30000) / 1000));
    const result = await this.bot.executeScript(this.target.rawId, expression, { timeout: timeoutSec });
    return parseMaybeJson(result);
  }
}

module.exports = {
  JseyesDriver,
};
