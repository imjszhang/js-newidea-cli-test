'use strict';

/**
 * @typedef {Object} DriverTarget
 * @property {string} id
 * @property {string} url
 *
 * @typedef {Object} BrowserDriver
 * @property {() => Promise<void>} connect
 * @property {() => Promise<void>} disconnect
 * @property {() => Promise<DriverTarget[]>} listTargets
 * @property {(input: { targetId?: string | null, urlFragment: string }) => Promise<DriverTarget>} resolveTarget
 * @property {(expression: string, options?: { timeoutMs?: number }) => Promise<any>} evaluate
 */

module.exports = {};
