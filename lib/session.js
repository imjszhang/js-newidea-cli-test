'use strict';

const fs = require('fs');
const { getPageProfile } = require('./config');

class Session {
  constructor({ driver, opts }) {
    this.driver = driver;
    this.opts = opts;
    this.target = null;
    this.pageProfile = getPageProfile(opts.page);
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
      urlFragment: this.pageProfile.targetUrlFragment,
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
    const src = fs.readFileSync(this.pageProfile.bridgePath, 'utf8');
    const m = src.match(/const\s+VERSION\s*=\s*['"]([\w.\-+]+)['"]/);
    if (!m) throw new Error(`${this.pageProfile.bridgePath} 里没找到 VERSION`);
    return m[1];
  }

  async ensureBridge() {
    const expected = this.readBridgeVersion();
    const cur = await this.callRaw(`(window.${this.pageProfile.bridgeGlobal}?.__meta?.version) || null`);
    if (cur === expected) {
      this.log(`bridge up-to-date (${expected})`);
      return;
    }
    this.log(`bridge ${cur ? `stale ${cur}` : 'missing'}, installing ${expected}...`);
    const src = fs.readFileSync(this.pageProfile.bridgePath, 'utf8');
    const result = await this.callRaw(src);
    if (!result || result.ok !== true) {
      throw Object.assign(new Error('bridge 注入失败: ' + JSON.stringify(result)), { code: 'E_INSTALL' });
    }
    this.log(`bridge installed at ${result.installedAt}, version=${result.version}`);
  }

  async callApi(method, args = []) {
    if (method !== 'setVisualOptions') {
      await this.callRaw(`Promise.resolve(window.${this.pageProfile.bridgeGlobal}.setVisualOptions(${JSON.stringify({
        enabled: !!this.opts.visual,
        durationMs: this.opts.visualMs,
        detailLevel: this.opts.visualDetail,
      })})).then(r=>JSON.stringify(r))`);
    }
    const payload = JSON.stringify(args);
    const code = `Promise.resolve(window.${this.pageProfile.bridgeGlobal}.${method}(...${payload})).then(r=>JSON.stringify(r))`;
    if (
      typeof this.driver.evaluateWithPageEvents === 'function' &&
      (
        (this.pageProfile.name === 'home' && method === 'clickPrimary') ||
        (this.pageProfile.name === 'outline' && method === 'clickCta')
      )
    ) {
      let observed;
      try {
        observed = await this.driver.evaluateWithPageEvents(code, { timeoutMs: 30000, settleMs: 1500 });
      } catch (error) {
        const msg = String((error && error.message) || error);
        if (!/Execution context was destroyed/i.test(msg)) throw error;
        const currentUrl = this.driver && this.driver.target && this.driver.target.page
          ? this.driver.target.page.url()
          : '';
        const afterPath = currentUrl ? new URL(currentUrl).pathname : '';
        const actionKey = method === 'clickPrimary' ? 'action' : 'name';
        observed = {
          result: {
            ok: true,
            data: {
              [actionKey]: args[0],
              navigationInterruptedEvaluation: true,
              beforePath: this.pageProfile.routeLabel,
              afterUrl: currentUrl,
              afterPath,
              urlChanged: !!currentUrl && !currentUrl.includes(this.pageProfile.targetUrlFragment),
              pathChanged: !!currentUrl && afterPath !== this.pageProfile.routeLabel,
              verified: !!currentUrl && !currentUrl.includes(this.pageProfile.targetUrlFragment),
            },
          },
          events: {},
        };
      }
      const result = observed && observed.result;
      if (result && result.ok && result.data) {
        const events = observed.events || {};
        const trigger = events.filechooser > 0
          ? 'filechooser'
          : events.download > 0
            ? 'download'
            : (events.popup && events.popup.length) || (events.contextPage && events.contextPage.length)
              ? 'new-page'
              : (events.dialog && events.dialog.length)
                ? 'dialog'
                : null;
        result.data.pageEvents = events;
        if (!result.data.verified && trigger) {
          result.data.verified = true;
          result.data.verificationSignal = trigger;
        } else if (trigger) {
          result.data.verificationSignal = trigger;
        }
      }
      return result;
    }
    return await this.callRaw(code);
  }

  async close() {
    await this.driver.disconnect();
  }
}

module.exports = {
  Session,
};
