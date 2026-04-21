'use strict';

function createDriver(name, options = {}) {
  switch (name) {
    case 'jseyes': {
      const { JseyesDriver } = require('./drivers/jseyes');
      return new JseyesDriver(options);
    }
    case 'playwright': {
      const { PlaywrightDriver } = require('./drivers/playwright');
      return new PlaywrightDriver(options);
    }
    default:
      throw Object.assign(new Error(`未知 driver: ${name}`), { code: 'E_BAD_ARG' });
  }
}

module.exports = {
  createDriver,
};
