'use strict';

const path = require('path');

const DEFAULT_JSEYES_WS_ENDPOINT = process.env.REVIEW_JSEYES_WS_ENDPOINT || 'ws://localhost:18080';
const DEFAULT_CDP_ENDPOINT = process.env.REVIEW_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const DEFAULT_DRIVER = process.env.REVIEW_DRIVER || 'playwright';
const DEFAULT_PAGE = process.env.REVIEW_PAGE || 'outline';

const PAGE_PROFILES = {
  outline: {
    name: 'outline',
    targetUrlFragment: process.env.REVIEW_OUTLINE_TARGET_URL_FRAGMENT || 'review.newidea.pro/outline',
    bridgePath: path.join(__dirname, '..', 'outline-bridge.js'),
    bridgeGlobal: '__jse_outline__',
    routeLabel: '/outline',
  },
  home: {
    name: 'home',
    targetUrlFragment: process.env.REVIEW_HOME_TARGET_URL_FRAGMENT || 'review.newidea.pro/home',
    bridgePath: path.join(__dirname, '..', 'home-bridge.js'),
    bridgeGlobal: '__jse_home__',
    routeLabel: '/home',
  },
};

function getPageProfile(name = DEFAULT_PAGE) {
  const profile = PAGE_PROFILES[name];
  if (!profile) {
    throw Object.assign(new Error(`未知页面 profile: ${name}`), { code: 'E_BAD_ARG' });
  }
  return profile;
}

module.exports = {
  DEFAULT_JSEYES_WS_ENDPOINT,
  DEFAULT_CDP_ENDPOINT,
  DEFAULT_DRIVER,
  DEFAULT_PAGE,
  PAGE_PROFILES,
  getPageProfile,
};
