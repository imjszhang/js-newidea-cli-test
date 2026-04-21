'use strict';

const path = require('path');

const BRIDGE_PATH = path.join(__dirname, '..', 'outline-bridge.js');
const TARGET_URL_FRAGMENT = process.env.OUTLINE_TARGET_URL_FRAGMENT || 'review.newidea.pro/outline';
const DEFAULT_JSEYES_WS_ENDPOINT = process.env.OUTLINE_JSEYES_WS_ENDPOINT || 'ws://localhost:18080';
const DEFAULT_CDP_ENDPOINT = process.env.OUTLINE_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const DEFAULT_DRIVER = process.env.OUTLINE_DRIVER || 'playwright';

module.exports = {
  BRIDGE_PATH,
  TARGET_URL_FRAGMENT,
  DEFAULT_JSEYES_WS_ENDPOINT,
  DEFAULT_CDP_ENDPOINT,
  DEFAULT_DRIVER,
};
