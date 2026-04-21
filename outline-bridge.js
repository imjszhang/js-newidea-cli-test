/* eslint-disable */
/**
 * outline-bridge.js —— 注入到 https://review.newidea.pro/outline 的桥接脚本
 *
 * v0.7.0 "Xray Upgrade"：不再尝试走 Slate editor / 替换原文，改为直接调用
 * rc-tree 节点 React 组件（内部代号 `Z`）props 上暴露的 4 个 handler：
 *
 *   onEditNode(newNodes, key)    —— 以 newNodes 替换 key 对应的节点
 *   onAddChildNode(key)          —— 给 key 加一个空的子节点
 *   onAddSibNode(key)            —— 给 key 加一个空的后兄弟节点
 *   onDeleteNodes([key, ...])    —— 批量删除
 *
 * 这些 handler 跑在页面 principal，必须穿过 Firefox Xray。做法：
 *   1. 在 content-script 用 DOM attribute 标记目标 `.rc-tree-treenode`；
 *   2. 创建 <script> 标签把 payload 注入 page-world；
 *   3. payload 从 [data-jse-op="…"] 找到元素，走 __reactFiber$ 链上溯到 Z 组件；
 *   4. 调 handler，结果 JSON.stringify 写进 window.__JSE_OUTLINE_RET__；
 *   5. content-script 用 window.wrappedJSObject.__JSE_OUTLINE_RET__ 取回字符串。
 *
 * 所有 API 返回形状统一：{ok, data?, code?, message?}；bridge 本身返 JSON string。
 */
;(() => {
  const VERSION = '0.7.2';

  const SEL = {
    tree: '.rc-tree.outline-tree[role="tree"]',
    node: '.rc-tree-treenode',
    indentUnit: ':scope > .rc-tree-indent > .rc-tree-indent-unit',
    switcher: ':scope > .rc-tree-switcher',
    switcherOpen: 'rc-tree-switcher_open',
    switcherClose: 'rc-tree-switcher_close',
    switcherNoop: 'rc-tree-switcher-noop',
    wrapper: ':scope > .rc-tree-node-content-wrapper',
    label: ':scope > .rc-tree-node-content-wrapper .rc-tree-title > div > div.cursor-pointer',
    editor: '[data-slate-editor="true"]',
  };
  const CTA_NAMES = ['返回首页', '下载提纲', '生成全文'];
  const EDITOR_CTA_NAMES = ['一键生成', '一键复制', '替换原文'];
  const VISUAL_DEFAULTS = {
    enabled: false,
    durationMs: 420,
  };
  const VISUAL_STYLE_ID = '__jse_visual_style__';
  const VISUAL_LAYER_ID = '__jse_visual_layer__';
  const VISUAL_HUD_ID = '__jse_visual_hud__';
  const VISUAL_TONE_MAP = {
    pending: { border: '#faad14', fill: 'rgba(250, 173, 20, 0.16)', pill: '#ad6800', text: '#fffbe6' },
    success: { border: '#52c41a', fill: 'rgba(82, 196, 26, 0.14)', pill: '#237804', text: '#f6ffed' },
    danger: { border: '#ff4d4f', fill: 'rgba(255, 77, 79, 0.14)', pill: '#a8071a', text: '#fff1f0' },
    info: { border: '#1677ff', fill: 'rgba(22, 119, 255, 0.14)', pill: '#0958d9', text: '#f0f5ff' },
  };
  const visualState = {
    config: { ...VISUAL_DEFAULTS },
    hudTimer: null,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (data) => ({ ok: true, data });
  const err = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function normalizeDuration(ms, fallback = VISUAL_DEFAULTS.durationMs) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return clamp(Math.round(n), 120, 4000);
  }

  function normalizeVisualOptions(options = {}) {
    const base = { ...visualState.config };
    if (!options || typeof options !== 'object') return base;
    if (typeof options.enabled === 'boolean') base.enabled = options.enabled;
    if (options.durationMs != null) base.durationMs = normalizeDuration(options.durationMs, base.durationMs);
    return base;
  }

  function ensureVisualRoot() {
    let style = document.getElementById(VISUAL_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = VISUAL_STYLE_ID;
      style.textContent = `
        #${VISUAL_LAYER_ID}{
          position:fixed;
          inset:0;
          pointer-events:none;
          z-index:2147483646;
          overflow:visible;
        }
        .__jse_visual_box{
          position:fixed;
          box-sizing:border-box;
          border-radius:8px;
          animation:__jse_visual_pulse .55s ease-out 1;
        }
        .__jse_visual_badge{
          position:absolute;
          left:0;
          top:-28px;
          max-width:280px;
          padding:4px 10px;
          border-radius:999px;
          font:600 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          letter-spacing:.01em;
          white-space:nowrap;
          text-overflow:ellipsis;
          overflow:hidden;
          box-shadow:0 8px 24px rgba(0,0,0,.18);
        }
        #${VISUAL_HUD_ID}{
          position:fixed;
          top:16px;
          right:16px;
          max-width:360px;
          padding:10px 14px;
          border-radius:12px;
          box-shadow:0 12px 32px rgba(0,0,0,.22);
          font:600 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          white-space:pre-wrap;
        }
        @keyframes __jse_visual_pulse{
          0%{transform:scale(.985);opacity:.2}
          35%{transform:scale(1.003);opacity:1}
          100%{transform:scale(1);opacity:1}
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
    let layer = document.getElementById(VISUAL_LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = VISUAL_LAYER_ID;
      (document.body || document.documentElement).appendChild(layer);
    }
    return layer;
  }

  function toneSpec(tone) {
    return VISUAL_TONE_MAP[tone] || VISUAL_TONE_MAP.info;
  }

  function removeLater(el, durationMs) {
    if (!el) return;
    const ms = normalizeDuration(durationMs);
    window.setTimeout(() => {
      if (el && el.parentNode) el.remove();
    }, ms);
  }

  function flashElement(el, { tone = 'info', label = '', durationMs, inset = 0 } = {}) {
    if (!el || !visualState.config.enabled) return false;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const layer = ensureVisualRoot();
    const spec = toneSpec(tone);
    const box = document.createElement('div');
    box.className = '__jse_visual_box';
    box.style.left = Math.max(4, rect.left - inset) + 'px';
    box.style.top = Math.max(4, rect.top - inset) + 'px';
    box.style.width = Math.max(18, rect.width + inset * 2) + 'px';
    box.style.height = Math.max(18, rect.height + inset * 2) + 'px';
    box.style.border = `2px solid ${spec.border}`;
    box.style.background = spec.fill;
    box.style.boxShadow = `0 0 0 1px ${spec.border}33, 0 12px 28px ${spec.border}22`;
    if (label) {
      const badge = document.createElement('div');
      badge.className = '__jse_visual_badge';
      badge.textContent = label;
      badge.style.background = spec.pill;
      badge.style.color = spec.text;
      const desiredTop = rect.top < 38 ? rect.height + 8 : -28;
      badge.style.top = desiredTop + 'px';
      box.appendChild(badge);
    }
    layer.appendChild(box);
    removeLater(box, durationMs);
    return true;
  }

  function showHud({ action = '', target = '', status = 'pending', detail = '', durationMs } = {}) {
    if (!visualState.config.enabled) return false;
    const layer = ensureVisualRoot();
    let hud = document.getElementById(VISUAL_HUD_ID);
    if (!hud) {
      hud = document.createElement('div');
      hud.id = VISUAL_HUD_ID;
      layer.appendChild(hud);
    }
    const spec = toneSpec(status);
    const lines = [];
    if (action) lines.push(action);
    if (target) lines.push(target);
    if (detail) lines.push(detail);
    hud.textContent = lines.join('\n');
    hud.style.border = `1px solid ${spec.border}`;
    hud.style.background = spec.fill.replace(/0\.\d+\)$/, '0.92)');
    hud.style.color = spec.pill;
    if (visualState.hudTimer) clearTimeout(visualState.hudTimer);
    visualState.hudTimer = window.setTimeout(() => {
      if (hud && hud.parentNode) hud.remove();
      visualState.hudTimer = null;
    }, normalizeDuration(durationMs, Math.max(900, visualState.config.durationMs * 2)));
    return true;
  }

  function cleanupVisualArtifacts() {
    const layer = document.getElementById(VISUAL_LAYER_ID);
    if (!layer) return;
    Array.from(layer.querySelectorAll('.__jse_visual_box')).forEach((el) => el.remove());
    const hud = document.getElementById(VISUAL_HUD_ID);
    if (hud) hud.remove();
    if (visualState.hudTimer) {
      clearTimeout(visualState.hudTimer);
      visualState.hudTimer = null;
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findVisibleButtonByText(text) {
    return Array.from(document.querySelectorAll('button'))
      .find((b) => (b.innerText || '').trim() === text && isVisible(b));
  }

  function listNodes() {
    const tree = document.querySelector(SEL.tree);
    if (!tree) return null;
    return Array.from(tree.querySelectorAll(SEL.node))
      .filter((n) => (n.getAttribute('aria-hidden') || 'false') !== 'true')
      .filter(isVisible);
  }

  function depthOf(node) {
    const indent = node.querySelector(':scope > .rc-tree-indent');
    return indent ? indent.querySelectorAll(':scope > .rc-tree-indent-unit').length : 0;
  }

  function switcherStateOf(node) {
    const sw = node.querySelector(SEL.switcher);
    if (!sw) return 'unknown';
    const cls = sw.className || '';
    if (cls.includes(SEL.switcherOpen)) return 'open';
    if (cls.includes(SEL.switcherClose)) return 'close';
    if (cls.includes(SEL.switcherNoop)) return 'leaf';
    return 'unknown';
  }

  function labelOf(node) {
    const el = node.querySelector(SEL.label);
    return el ? (el.textContent || '').trim() : '';
  }

  function scanTree() {
    const flat = listNodes();
    if (!flat) return { ok: false, code: 'E_UI_MISMATCH', message: 'outline 根节点未找到' };
    const entries = [];
    const stack = [];
    for (const node of flat) {
      const d = depthOf(node);
      while (stack.length > d + 1) stack.pop();
      if (stack.length === d + 1) {
        stack[d] += 1;
      } else {
        while (stack.length <= d) stack.push(0);
        stack[d] = 0;
      }
      const path = stack.slice(0, d + 1).join('.');
      entries.push({
        path,
        depth: d,
        text: labelOf(node),
        switcher: switcherStateOf(node),
        _node: node,
      });
    }
    return { ok: true, entries };
  }

  function getNodeByPath(path) {
    const scan = scanTree();
    if (!scan.ok) return { hit: null, error: scan };
    const hit = scan.entries.find((e) => e.path === path);
    if (!hit) return { hit: null, error: err('E_NOT_FOUND', `path ${path} 未找到`) };
    return { hit, error: null };
  }

  function stripInternal(entry) {
    const { _node, ...rest } = entry;
    return rest;
  }

  function isValidPath(p) {
    return typeof p === 'string' && /^\d+(\.\d+)*$/.test(p);
  }

  function parentPathOf(path) {
    const i = path.lastIndexOf('.');
    return i === -1 ? null : path.slice(0, i);
  }

  // ---------- page-world 通道 ----------
  const RET_VAR = '__JSE_OUTLINE_RET__';
  const OP_ATTR = 'data-jse-op';

  function randToken() {
    return 'op-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  /**
   * 把 DOM 元素打个唯一标记，让 page-world payload 可以 querySelector 找到它。
   */
  function tag(el) {
    const t = randToken();
    el.setAttribute(OP_ATTR, t);
    return t;
  }
  function untag(el) { if (el) el.removeAttribute(OP_ATTR); }

  /**
   * 注入一段 page-world payload 并等它写回 window.__JSE_OUTLINE_RET__。
   * payload 约定：字符串形式的完整 JS，必须自己处理异常、把 JSON 字符串写入 window[RET_VAR]。
   */
  async function runInPage(payload, { timeoutMs = 3000 } = {}) {
    try {
      if (window.wrappedJSObject) delete window.wrappedJSObject[RET_VAR];
      else delete window[RET_VAR];
    } catch (e) { /* 有些 Chrome 没 wrappedJSObject，也不报错 */ }
    const s = document.createElement('script');
    s.textContent = payload;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.remove();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(30);
      let raw = null;
      try {
        raw = (window.wrappedJSObject || window)[RET_VAR];
      } catch (e) { return err('E_XRAY', 'xray read: ' + e.message); }
      if (raw != null) {
        try { return JSON.parse(raw); } catch (e) { return err('E_PARSE', 'json: ' + e.message, { raw: String(raw).slice(0, 200) }); }
      }
    }
    return err('E_TIMEOUT', `page-world 未在 ${timeoutMs}ms 内写回结果`);
  }

  /**
   * 生成一段"找到带有 data-jse-op=`token` 的 treenode，从 label 向上走 40 层
   * fiber 直到命中 Z 组件（props 上带 onEditNode & item）"的 page-world 代码片段。
   * 随后插入 `body`，`body` 可以访问 const z, p, item。
   */
  function pwFindZ(token, body) {
    return `
(() => {
  try {
    const el = document.querySelector('[${OP_ATTR}="' + ${JSON.stringify(token)} + '"]');
    if (!el) { window.${RET_VAR} = JSON.stringify({err:'no el'}); return; }
    const lbl = el.querySelector('.rc-tree-title > div > div.cursor-pointer');
    const from = lbl || el;
    const fkey = Object.keys(from).find(k => k.startsWith('__reactFiber$'));
    if (!fkey) { window.${RET_VAR} = JSON.stringify({err:'no fiber key'}); return; }
    let f = from[fkey];
    for (let i = 0; i < 40 && f; i++) {
      const mp = f.memoizedProps;
      if (mp && 'onEditNode' in mp && 'item' in mp) break;
      f = f.return;
    }
    if (!f) { window.${RET_VAR} = JSON.stringify({err:'no Z'}); return; }
    const z = f;
    const p = z.memoizedProps;
    const item = p.item;
    ${body}
  } catch (e) {
    window.${RET_VAR} = JSON.stringify({err: 'ex: ' + (e && e.message) + ' stack: ' + String(e && e.stack || '').slice(0,200) });
  }
})();`;
  }

  /**
   * 生成一段"按 innerText 找页面上可见 button，取其 __reactProps$.onClick 调用"的 page-world 代码。
   */
  function pwClickBtnByText(btnText) {
    return `
(() => {
  try {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => (b.innerText || '').trim() === ${JSON.stringify(btnText)} && b.offsetParent !== null);
    if (!btn) { window.${RET_VAR} = JSON.stringify({err:'no btn'}); return; }
    if (btn.disabled) { window.${RET_VAR} = JSON.stringify({err:'disabled'}); return; }
    const pkey = Object.keys(btn).find(k => k.startsWith('__reactProps$'));
    const props = pkey ? btn[pkey] : null;
    if (!props || typeof props.onClick !== 'function') {
      window.${RET_VAR} = JSON.stringify({err:'no onClick'}); return;
    }
    const evt = {
      preventDefault: () => {}, stopPropagation: () => {},
      nativeEvent: { preventDefault: () => {}, stopPropagation: () => {} },
      currentTarget: btn, target: btn, type: 'click', bubbles: true,
      defaultPrevented: false,
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
    };
    props.onClick(evt);
    window.${RET_VAR} = JSON.stringify({ok:true, name: ${JSON.stringify(btnText)}});
  } catch (e) {
    window.${RET_VAR} = JSON.stringify({err:'ex:'+(e && e.message)});
  }
})();`;
  }

  async function waitTreeText(path, expected, { timeoutMs = 2000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      await sleep(50);
      const scan = scanTree();
      if (!scan.ok) return { ok: false };
      const hit = scan.entries.find((e) => e.path === path);
      last = hit ? hit.text : null;
      if (hit && (expected == null || hit.text === expected)) return { ok: true, text: hit.text };
    }
    return { ok: false, text: last };
  }

  // ---------- API: 只读 ----------
  function version() { return ok({ version: VERSION }); }

  function probe() {
    const tree = document.querySelector(SEL.tree);
    const editors = Array.from(document.querySelectorAll(SEL.editor)).filter(isVisible);
    return ok({
      version: VERSION,
      url: location.href,
      title: document.title,
      onOutlinePage: location.pathname === '/outline',
      treeFound: !!tree,
      nodeCount: listNodes()?.length ?? 0,
      editorOpen: editors.length > 0,
      xrayAvailable: typeof (document.documentElement && document.documentElement.wrappedJSObject) !== 'undefined',
      ctaVisible: CTA_NAMES.filter((name) =>
        Array.from(document.querySelectorAll('button')).some((b) => b.innerText.trim() === name && isVisible(b))),
    });
  }

  function tree() {
    const scan = scanTree();
    if (!scan.ok) return scan;
    return ok(scan.entries.map(stripInternal));
  }

  function get(path) {
    if (!isValidPath(path)) return err('E_BAD_ARG', `path 格式非法: ${JSON.stringify(path)}`);
    const { hit, error } = getNodeByPath(path);
    if (!hit) return error;
    return ok(stripInternal(hit));
  }

  function find(query) {
    const scan = scanTree();
    if (!scan.ok) return scan;
    const entries = scan.entries.map(stripInternal);
    if (!query) return ok(entries);
    if (typeof query === 'string') query = { contains: query };
    const { text, contains, depth } = query;
    let hits = entries;
    if (typeof depth === 'number') hits = hits.filter((e) => e.depth === depth);
    if (typeof text === 'string') hits = hits.filter((e) => e.text === text);
    if (typeof contains === 'string') hits = hits.filter((e) => e.text.includes(contains));
    return ok(hits);
  }

  function state() {
    const editors = Array.from(document.querySelectorAll(SEL.editor)).filter(isVisible);
    const editorCtas = EDITOR_CTA_NAMES.filter((name) =>
      Array.from(document.querySelectorAll('button')).some((b) => b.innerText.trim() === name && isVisible(b)));
    return ok({
      url: location.href,
      scrollY: window.scrollY,
      editorOpen: editors.length > 0,
      editorCtas,
      globalCtas: CTA_NAMES.filter((name) =>
        Array.from(document.querySelectorAll('button')).some((b) => b.innerText.trim() === name && isVisible(b))),
    });
  }

  function setVisualOptions(options = {}) {
    if (!options || typeof options !== 'object') {
      visualState.config = { ...VISUAL_DEFAULTS };
      cleanupVisualArtifacts();
      return ok({ ...visualState.config });
    }
    visualState.config = normalizeVisualOptions(options);
    if (!visualState.config.enabled) cleanupVisualArtifacts();
    return ok({ ...visualState.config });
  }

  async function scrollIntoView(path) {
    const { hit, error } = getNodeByPath(path);
    if (!hit) return error;
    hit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
    return ok({ path });
  }

  // ---------- API: 读节点的 React 身份（调试 / 内部用） ----------
  async function nodeKey(path) {
    if (!isValidPath(path)) return err('E_BAD_ARG', 'path 非法');
    const { hit, error } = getNodeByPath(path);
    if (!hit) return error;
    const token = tag(hit._node);
    try {
      const res = await runInPage(pwFindZ(token, `
    window.${RET_VAR} = JSON.stringify({ok:true, key: item.key, title: item.title, childrenLen: item.children ? item.children.length : 0});
  `));
      if (res && res.ok) return ok(res);
      if (res && res.err) return err('E_FIBER', res.err);
      return res;
    } finally { untag(hit._node); }
  }

  // ---------- API: 写操作（全自动，经 Z handlers） ----------
  async function rename(path, text) {
    if (!isValidPath(path)) return err('E_BAD_ARG', 'path 非法');
    if (typeof text !== 'string') return err('E_BAD_ARG', 'text 需为字符串');
    const { hit, error } = getNodeByPath(path);
    if (!hit) return error;
    hit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
    flashElement(hit._node.querySelector(SEL.label) || hit._node, {
      tone: 'pending',
      label: '正在重命名',
    });
    showHud({ action: 'rename', target: path, status: 'pending', detail: text });
    const token = tag(hit._node);
    const textLit = JSON.stringify(text);
    try {
      const res = await runInPage(pwFindZ(token, `
    const before = { key: item.key, title: item.title };
    const newItem = { key: item.key, title: ${textLit}, children: item.children || [] };
    p.onEditNode([newItem], item.key);
    window.${RET_VAR} = JSON.stringify({ok:true, before, after: { key: item.key, title: ${textLit} }});
  `));
      if (!res || res.err) return err('E_FIBER', (res && res.err) || 'unknown');
      await sleep(120);
      const afterHit = getNodeByPath(path).hit;
      if (afterHit) {
        flashElement(afterHit._node.querySelector(SEL.label) || afterHit._node, {
          tone: 'success',
          label: '已重命名',
        });
      }
      showHud({ action: 'rename', target: path, status: 'success', detail: text });
      return ok({ path, before: res.before, after: res.after });
    } finally { untag(hit._node); }
  }

  // editBody 在本页与 rename 等价：节点无标题 / 正文之分，item.title 就是节点文本
  async function editBody(path, text) { return await rename(path, text); }

  async function addChild(path, text) {
    if (!isValidPath(path)) return err('E_BAD_ARG', 'path 非法');
    if (text != null && typeof text !== 'string') return err('E_BAD_ARG', 'text 需为字符串或省略');
    const { hit, error } = getNodeByPath(path);
    if (!hit) return error;
    hit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
    flashElement(hit._node.querySelector(SEL.label) || hit._node, {
      tone: 'pending',
      label: '正在添加子节点',
    });
    showHud({ action: 'add-child', target: path, status: 'pending', detail: text || '(空)' });
    const token = tag(hit._node);
    try {
      const res = await runInPage(pwFindZ(token, `
    const titleLit = ${JSON.stringify(text || '')};
    const genKey = 'id-jse-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const newChild = { key: genKey, title: titleLit, children: [] };
    const oldChildren = Array.isArray(item.children) ? item.children : [];
    const newItem = { key: item.key, title: item.title, children: [...oldChildren, newChild] };
    p.onEditNode([newItem], item.key);
    window.${RET_VAR} = JSON.stringify({ok:true, parentKey: item.key, newKey: genKey, newIndex: oldChildren.length});
  `));
      if (!res || res.err) return err('E_FIBER', (res && res.err) || 'unknown');
      await sleep(120);
      const childPath = path + '.' + res.newIndex;
      const verify = await waitTreeText(childPath, text || '', { timeoutMs: 1500 });
      const childHit = getNodeByPath(childPath).hit;
      if (childHit) {
        childHit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
        flashElement(childHit._node.querySelector(SEL.label) || childHit._node, {
          tone: 'success',
          label: '已新增子节点',
        });
      }
      showHud({ action: 'add-child', target: childPath, status: verify.ok ? 'success' : 'pending', detail: text || '(空)' });
      return ok({
        path,
        childPath,
        childKey: res.newKey,
        title: text || '',
        verified: !!verify.ok,
      });
    } finally { untag(hit._node); }
  }

  async function addSibling(path, text, options = {}) {
    if (!isValidPath(path)) return err('E_BAD_ARG', 'path 非法');
    if (text != null && typeof text !== 'string') return err('E_BAD_ARG', 'text 需为字符串或省略');
    const where = (options && options.where) || 'after';
    if (!['before', 'after'].includes(where)) return err('E_BAD_ARG', "where 只能是 'before' | 'after'");
    const parentPath = parentPathOf(path);
    if (!parentPath) return err('E_BAD_ARG', 'path 没有父级，不能加兄弟节点');
    const selfLeaf = path.split('.').pop();
    const selfIdx = parseInt(selfLeaf, 10);
    const { hit: parentHit, error: pErr } = getNodeByPath(parentPath);
    if (!parentHit) return pErr;
    const { hit: selfHit } = getNodeByPath(path);
    if (selfHit) {
      selfHit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
      flashElement(selfHit._node.querySelector(SEL.label) || selfHit._node, {
        tone: 'pending',
        label: where === 'before' ? '正在前插同级节点' : '正在后插同级节点',
      });
    }
    showHud({ action: where === 'before' ? 'add-before' : 'add-after', target: path, status: 'pending', detail: text || '(空)' });
    const token = tag(parentHit._node);
    const textLit = JSON.stringify(text || '');
    const whereLit = JSON.stringify(where);
    try {
      const res = await runInPage(pwFindZ(token, `
    const childIdx = ${selfIdx};
    if (!Array.isArray(item.children) || childIdx < 0 || childIdx >= item.children.length) {
      window.${RET_VAR} = JSON.stringify({err:'child idx out of range'}); return;
    }
    const targetChild = item.children[childIdx];
    const genKey = 'id-jse-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const newNode = { key: genKey, title: ${textLit}, children: [] };
    const insertAt = ${whereLit} === 'before' ? childIdx : childIdx + 1;
    const newChildren = item.children.slice();
    newChildren.splice(insertAt, 0, newNode);
    const newItem = { key: item.key, title: item.title, children: newChildren };
    p.onEditNode([newItem], item.key);
    window.${RET_VAR} = JSON.stringify({ok:true, parentKey: item.key, targetKey: targetChild.key, newKey: genKey, newIndex: insertAt});
  `));
      if (!res || res.err) return err('E_FIBER', (res && res.err) || 'unknown');
      await sleep(120);
      const newPath = parentPath + '.' + res.newIndex;
      const verify = await waitTreeText(newPath, text || '', { timeoutMs: 1500 });
      const newHit = getNodeByPath(newPath).hit;
      if (newHit) {
        newHit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
        flashElement(newHit._node.querySelector(SEL.label) || newHit._node, {
          tone: 'success',
          label: '已新增同级节点',
        });
      }
      showHud({ action: where === 'before' ? 'add-before' : 'add-after', target: newPath, status: verify.ok ? 'success' : 'pending', detail: text || '(空)' });
      return ok({
        path,
        newPath,
        newKey: res.newKey,
        where,
        title: text || '',
        verified: !!verify.ok,
      });
    } finally { untag(parentHit._node); }
  }

  async function remove(path) {
    if (!isValidPath(path)) return err('E_BAD_ARG', 'path 非法');
    const { hit, error } = getNodeByPath(path);
    if (!hit) return error;
    hit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
    flashElement(hit._node.querySelector(SEL.label) || hit._node, {
      tone: 'danger',
      label: '准备删除',
    });
    showHud({ action: 'remove', target: path, status: 'danger', detail: hit.text || '' });
    if (visualState.config.enabled) await sleep(Math.min(180, Math.floor(visualState.config.durationMs / 2)));
    const token = tag(hit._node);
    try {
      const res = await runInPage(pwFindZ(token, `
    const before = { key: item.key, title: item.title };
    p.onDeleteNodes([item.key]);
    window.${RET_VAR} = JSON.stringify({ok:true, removed: before});
  `));
      if (!res || res.err) return err('E_FIBER', (res && res.err) || 'unknown');
      await sleep(150);
      // 复扫，确认该 path 位置文本 != before.title
      const scan = scanTree();
      const still = scan.ok ? scan.entries.find((e) => e.path === path) : null;
      const stillHasSameTitle = still && still.text === res.removed.title;
      showHud({
        action: 'remove',
        target: path,
        status: !stillHasSameTitle ? 'success' : 'pending',
        detail: !stillHasSameTitle ? '已删除' : '等待确认删除',
      });
      return ok({ path, removed: res.removed, verifiedGone: !stillHasSameTitle });
    } finally { untag(hit._node); }
  }

  // ---------- API: 展开 / 折叠 / 选中 ----------
  // rc-tree 的 switcher / wrapper onClick 走 React props，我们也走 page-world 调。
  async function callNodeSubElementOnClick(nodeEl, subSelector, label) {
    const sub = nodeEl.querySelector(subSelector);
    if (!sub) return err('E_UI_MISMATCH', `${label} 元素缺失`);
    const token = tag(sub);
    try {
      const payload = `
(() => {
  try {
    const el = document.querySelector('[${OP_ATTR}="' + ${JSON.stringify(token)} + '"]');
    if (!el) { window.${RET_VAR} = JSON.stringify({err:'no el'}); return; }
    const pkey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
    const props = pkey ? el[pkey] : null;
    if (!props || typeof props.onClick !== 'function') {
      window.${RET_VAR} = JSON.stringify({err:'no onClick'}); return;
    }
    const evt = {
      preventDefault: () => {}, stopPropagation: () => {},
      nativeEvent: { preventDefault: () => {}, stopPropagation: () => {} },
      currentTarget: el, target: el, type: 'click', bubbles: true,
      defaultPrevented: false,
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
    };
    props.onClick(evt);
    window.${RET_VAR} = JSON.stringify({ok:true});
  } catch (e) { window.${RET_VAR} = JSON.stringify({err:'ex:'+(e && e.message)}); }
})();`;
      const res = await runInPage(payload);
      if (!res || res.err) return err('E_FIBER', (res && res.err) || 'unknown');
      return ok(res);
    } finally { untag(sub); }
  }

  // 注意：本页 rc-tree 是受控模式（传了 `expandedKeys` 但没传 `onExpand` 回调），
  // 点击 switcher 后 rc-tree 内部调 context.onNodeExpand，但该回调在页面上不更新
  // 任何状态，所以 switcher 点击实际上 **无任何视觉效果**。expand/collapse 两个
  // API 保留语义，但会返回 `E_NOT_SUPPORTED_BY_PAGE` 以提示"页面数据层不响应"。
  async function expand(path, options = {}) {
    const deep = !!(options && options.deep);
    const { hit, error } = getNodeByPath(path);
    if (!hit) return error;
    const cur = switcherStateOf(hit._node);
    if (cur === 'leaf') return ok({ wasLeaf: true });
    if (cur === 'open') return ok({ alreadyAt: 'open', note: 'deep=' + deep + ' 未尝试下钻，见 note' });
    const r = await callNodeSubElementOnClick(hit._node, SEL.switcher, 'switcher');
    if (!r.ok) return r;
    await sleep(200);
    const after = switcherStateOf(hit._node);
    if (after === cur) {
      return err('E_NOT_SUPPORTED_BY_PAGE', '本页 rc-tree 受控且无 onExpand 回调，switcher 点击不改变 expandedKeys');
    }
    return ok({ from: cur, to: after });
  }

  async function collapse(path) {
    const { hit, error } = getNodeByPath(path);
    if (!hit) return error;
    const cur = switcherStateOf(hit._node);
    if (cur === 'leaf') return ok({ wasLeaf: true });
    if (cur === 'close') return ok({ alreadyAt: 'close' });
    const r = await callNodeSubElementOnClick(hit._node, SEL.switcher, 'switcher');
    if (!r.ok) return r;
    await sleep(200);
    const after = switcherStateOf(hit._node);
    if (after === cur) {
      return err('E_NOT_SUPPORTED_BY_PAGE', '本页 rc-tree 受控且无 onExpand 回调，switcher 点击不改变 expandedKeys');
    }
    return ok({ from: cur, to: after });
  }

  async function select(path) {
    // rc-tree 本页 selectable=false，节点 content-wrapper 的 onClick 在此站无可见效果，
    // 但我们仍然滚动 + 闪红边做视觉反馈，保留与旧版相同的语义。
    const { hit, error } = getNodeByPath(path);
    if (!hit) return error;
    hit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
    flashElement(hit._node.querySelector(SEL.label) || hit._node, {
      tone: 'info',
      label: '已定位',
      durationMs: 600,
    });
    showHud({ action: 'select', target: path, status: 'info', detail: hit.text || '' });
    return ok({ path, note: 'rc-tree selectable=false，仅滚动+闪烁' });
  }

  // ---------- API: CTA ----------
  async function clickCta(name) {
    if (!CTA_NAMES.includes(name) && !EDITOR_CTA_NAMES.includes(name)) {
      return err('E_BAD_ARG', `只接受这些按钮文案：${[...CTA_NAMES, ...EDITOR_CTA_NAMES].join(' / ')}`);
    }
    const btn = findVisibleButtonByText(name);
    if (!btn) return err('E_NOT_FOUND', `按钮"${name}"当前不可见`);
    if (btn.disabled) return err('E_DISABLED', `按钮"${name}"当前 disabled`);
    flashElement(btn, {
      tone: 'pending',
      label: `正在点击：${name}`,
      inset: 4,
    });
    showHud({ action: 'cta', target: name, status: 'pending' });
    const beforeUrl = location.href;
    const res = await runInPage(pwClickBtnByText(name));
    if (!res || res.err) {
      if (res && res.err === 'disabled') return err('E_DISABLED', `按钮"${name}"已变 disabled`);
      return err('E_FIBER', `调用 onClick 失败: ${(res && res.err) || 'unknown'}`);
    }
    await sleep(1000);
    const afterUrl = location.href;
    const afterBtn = findVisibleButtonByText(name);
    if (afterBtn) {
      flashElement(afterBtn, {
        tone: 'success',
        label: `已触发：${name}`,
        inset: 4,
      });
    }
    showHud({
      action: 'cta',
      target: name,
      status: 'success',
      detail: afterUrl !== beforeUrl ? '页面已跳转' : '操作已触发',
    });
    return ok({
      name,
      urlChanged: afterUrl !== beforeUrl,
      newUrl: afterUrl !== beforeUrl ? afterUrl : undefined,
      btnStillVisible: document.body.contains(btn) && isVisible(btn),
    });
  }

  // ---------- 调试辅助（保留） ----------
  function __unveil() {
    const id = '__jse_unveil_style__';
    if (document.getElementById(id)) return ok({ alreadyOn: true });
    const s = document.createElement('style');
    s.id = id;
    s.textContent = '.rc-tree .group-hover\\:flex.hidden{display:flex !important}';
    document.head.appendChild(s);
    return ok({ alreadyOn: false });
  }
  function __dismissUnveil() {
    const id = '__jse_unveil_style__';
    const s = document.getElementById(id);
    if (s) s.remove();
    return ok({ removed: !!s });
  }

  // ---------- 装载 ----------
  const api = {
    version,
    probe,
    tree,
    get,
    find,
    state,
    setVisualOptions,
    scrollIntoView,
    select,
    expand,
    collapse,
    nodeKey,
    rename,
    editBody,
    addChild,
    addSibling,
    remove,
    clickCta,
    __unveil,
    __dismissUnveil,
    __meta: { version: VERSION, loadedAt: new Date().toISOString() },
  };

  try {
    window.__jse_outline__ = api;
  } catch (e) {
    return JSON.stringify({ ok: false, code: 'E_INSTALL', message: String(e && e.message || e) });
  }
  return JSON.stringify({ ok: true, version: VERSION, installedAt: api.__meta.loadedAt });
})();
