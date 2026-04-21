'use strict';

function renderTree(entries) {
  return entries.map((e) => {
    const indent = '  '.repeat(e.depth);
    const tag = e.switcher === 'leaf' ? '  ' : e.switcher === 'open' ? '▾ ' : '▸ ';
    return `${e.path.padEnd(10)} ${indent}${tag}${e.text || '(空)'}`;
  }).join('\n');
}

function renderResult(result, opts) {
  if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
  if (!result || typeof result !== 'object') { console.log(String(result)); return; }
  if (result.ok === false) { console.error(`ERROR [${result.code || 'E_UNKNOWN'}] ${result.message || ''}`); return; }
  const data = result.data;
  if (Array.isArray(data) && data.length && typeof data[0] === 'object' && 'path' in data[0] && 'depth' in data[0]) {
    console.log(renderTree(data));
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

module.exports = {
  renderTree,
  renderResult,
};
