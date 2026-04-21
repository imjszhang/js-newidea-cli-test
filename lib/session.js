'use strict';

const fs = require('fs');
const { BRIDGE_PATH, TARGET_URL_FRAGMENT } = require('./config');

class Session {
  constructor({ driver, opts }) {
    this.driver = driver;
    this.opts = opts;
    this.target = null;
  }

  log(msg) {
    if (this.opts.verbose) process.stderr.write(`[cli] ${msg}\n`);
  }

  async connect() {
    await this.driver.connect();
  }

  async resolveTarget() {
    this.target = await this.driver.resolveTarget({
      targetId: this.opts.tab,
      urlFragment: TARGET_URL_FRAGMENT,
    });
    this.log(`target resolved: ${this.target.id} (${this.target.url})`);
  }

  get targetId() {
    return this.target ? this.target.id : null;
  }

  async callRaw(expression, options = {}) {
    return await this.driver.evaluate(expression, options);
  }

  readBridgeVersion() {
    const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
    const m = src.match(/const\s+VERSION\s*=\s*['"]([\w.\-+]+)['"]/);
    if (!m) throw new Error('outline-bridge.js 里没找到 VERSION');
    return m[1];
  }

  async ensureBridge() {
    const expected = this.readBridgeVersion();
    const cur = await this.callRaw('(window.__jse_outline__?.__meta?.version) || null');
    if (cur === expected) {
      this.log(`bridge up-to-date (${expected})`);
      return;
    }
    this.log(`bridge ${cur ? `stale ${cur}` : 'missing'}, installing ${expected}...`);
    const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
    const result = await this.callRaw(src);
    if (!result || result.ok !== true) {
      throw Object.assign(new Error('bridge 注入失败: ' + JSON.stringify(result)), { code: 'E_INSTALL' });
    }
    this.log(`bridge installed at ${result.installedAt}, version=${result.version}`);
  }

  async callApi(method, args = []) {
    if (method !== 'setVisualOptions') {
      await this.callRaw(`Promise.resolve(window.__jse_outline__.setVisualOptions(${JSON.stringify({
        enabled: !!this.opts.visual,
        durationMs: this.opts.visualMs,
        detailLevel: this.opts.visualDetail,
      })})).then(r=>JSON.stringify(r))`);
    }
    const payload = JSON.stringify(args);
    const code = `Promise.resolve(window.__jse_outline__.${method}(...${payload})).then(r=>JSON.stringify(r))`;
    return await this.callRaw(code);
  }

  async close() {
    await this.driver.disconnect();
  }
}

module.exports = {
  Session,
};
