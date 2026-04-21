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
  const VERSION = '0.9.0';

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
    detailLevel: 'staged',
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
  const VISUAL_STAGE_COPY = {
    locate: '已定位',
    execute: '执行中',
    respond: '页面已响应',
    verify: '已验证',
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

  function normalizeDetailLevel(value, fallback = VISUAL_DEFAULTS.detailLevel) {
    if (value === 'compact' || value === 'staged') return value;
    return fallback;
  }

  function normalizeVisualOptions(options = {}) {
    const base = { ...visualState.config };
    if (!options || typeof options !== 'object') return base;
    if (typeof options.enabled === 'boolean') base.enabled = options.enabled;
    if (options.durationMs != null) base.durationMs = normalizeDuration(options.durationMs, base.durationMs);
    if (options.detailLevel != null) base.detailLevel = normalizeDetailLevel(options.detailLevel, base.detailLevel);
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
        .__jse_visual_relation{
          position:fixed;
          inset:0;
          animation:__jse_visual_pulse .55s ease-out 1;
        }
        .__jse_visual_line{
          position:absolute;
          height:2px;
          transform-origin:left center;
          box-shadow:0 0 0 1px currentColor, 0 8px 24px currentColor;
          opacity:.9;
        }
        .__jse_visual_dot{
          position:absolute;
          width:10px;
          height:10px;
          border-radius:999px;
          transform:translate(-50%, -50%);
          box-shadow:0 0 0 2px rgba(255,255,255,.65);
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

  function isStagedVisual() {
    return visualState.config.detailLevel !== 'compact';
  }

  function stageDuration(stage, fallback = visualState.config.durationMs) {
    const base = normalizeDuration(fallback, visualState.config.durationMs);
    if (stage === 'locate') return clamp(Math.round(base * 0.75), 120, 4000);
    if (stage === 'respond') return clamp(Math.round(base * 0.9), 120, 4000);
    if (stage === 'verify') return clamp(Math.round(base * 1.05), 120, 4000);
    return base;
  }

  function hudDuration(stage, fallback = visualState.config.durationMs) {
    return Math.max(900, stageDuration(stage, fallback) * 2);
  }

  function summarizeText(text, max = 88) {
    if (text == null) return '';
    const clean = String(text).replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
  }

  function joinParts(parts) {
    return parts.filter(Boolean).join(' · ');
  }

  function nodeVisualAnchor(nodeEl) {
    if (!nodeEl) return null;
    return nodeEl.querySelector(SEL.label) || nodeEl;
  }

  function relationPoint(el, side = 'center') {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    if (side === 'left') return { x: rect.left, y: rect.top + rect.height / 2 };
    if (side === 'right') return { x: rect.right, y: rect.top + rect.height / 2 };
    if (side === 'top') return { x: rect.left + rect.width / 2, y: rect.top };
    if (side === 'bottom') return { x: rect.left + rect.width / 2, y: rect.bottom };
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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

  function flashRelation(fromEl, toEl, { tone = 'info', label = '', durationMs, fromSide = 'right', toSide = 'left' } = {}) {
    if (!fromEl || !toEl || !visualState.config.enabled || !isStagedVisual()) return false;
    const start = relationPoint(fromEl, fromSide);
    const end = relationPoint(toEl, toSide);
    if (!start || !end) return false;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(length) || length < 24) return false;
    const layer = ensureVisualRoot();
    const spec = toneSpec(tone);
    const group = document.createElement('div');
    group.className = '__jse_visual_relation';
    const line = document.createElement('div');
    line.className = '__jse_visual_line';
    line.style.left = `${start.x}px`;
    line.style.top = `${start.y}px`;
    line.style.width = `${length}px`;
    line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    line.style.color = spec.border;
    line.style.background = spec.border;
    group.appendChild(line);

    for (const point of [start, end]) {
      const dot = document.createElement('div');
      dot.className = '__jse_visual_dot';
      dot.style.left = `${point.x}px`;
      dot.style.top = `${point.y}px`;
      dot.style.background = spec.border;
      group.appendChild(dot);
    }

    if (label) {
      const badge = document.createElement('div');
      badge.className = '__jse_visual_badge';
      badge.textContent = label;
      badge.style.background = spec.pill;
      badge.style.color = spec.text;
      badge.style.left = `${start.x + dx / 2}px`;
      badge.style.top = `${start.y + dy / 2 - 34}px`;
      badge.style.transform = 'translateX(-50%)';
      group.appendChild(badge);
    }

    layer.appendChild(group);
    removeLater(group, durationMs);
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
    Array.from(layer.querySelectorAll('.__jse_visual_relation')).forEach((el) => el.remove());
    const hud = document.getElementById(VISUAL_HUD_ID);
    if (hud) hud.remove();
    if (visualState.hudTimer) {
      clearTimeout(visualState.hudTimer);
      visualState.hudTimer = null;
    }
  }

  function announceStage({
    action,
    stage,
    tone = 'info',
    element = null,
    badge = '',
    target = '',
    detail = '',
    inset = 0,
    durationMs,
    relation = null,
  } = {}) {
    if (!visualState.config.enabled) return false;
    const stageName = VISUAL_STAGE_COPY[stage] || '';
    if (!isStagedVisual() && stage === 'locate') return false;
    const finalDuration = stageDuration(stage, durationMs);
    if (element) {
      flashElement(element, {
        tone,
        label: badge || stageName,
        durationMs: finalDuration,
        inset,
      });
    }
    if (relation && relation.from && relation.to) {
      flashRelation(relation.from, relation.to, {
        tone,
        label: relation.label || '',
        durationMs: finalDuration,
        fromSide: relation.fromSide,
        toSide: relation.toSide,
      });
    }
    showHud({
      action: joinParts([action, isStagedVisual() ? stageName : '']),
      target,
      status: tone,
      detail,
      durationMs: hudDuration(stage, durationMs),
    });
    return true;
  }

  function createVisualFlow(action, { target = '', detail = '' } = {}) {
    return {
      locate(opts = {}) {
        return announceStage({
          action,
          stage: 'locate',
          target,
          detail: opts.detail != null ? opts.detail : detail,
          tone: opts.tone || 'info',
          badge: opts.badge || '已定位',
          element: opts.element || null,
          inset: opts.inset || 0,
          relation: opts.relation || null,
          durationMs: opts.durationMs,
        });
      },
      execute(opts = {}) {
        return announceStage({
          action,
          stage: 'execute',
          target: opts.target != null ? opts.target : target,
          detail: opts.detail != null ? opts.detail : detail,
          tone: opts.tone || 'pending',
          badge: opts.badge || '执行中',
          element: opts.element || null,
          inset: opts.inset || 0,
          relation: opts.relation || null,
          durationMs: opts.durationMs,
        });
      },
      respond(opts = {}) {
        return announceStage({
          action,
          stage: 'respond',
          target: opts.target != null ? opts.target : target,
          detail: opts.detail != null ? opts.detail : detail,
          tone: opts.tone || 'info',
          badge: opts.badge || '页面已响应',
          element: opts.element || null,
          inset: opts.inset || 0,
          relation: opts.relation || null,
          durationMs: opts.durationMs,
        });
      },
      verify(opts = {}) {
        return announceStage({
          action,
          stage: 'verify',
          target: opts.target != null ? opts.target : target,
          detail: opts.detail != null ? opts.detail : detail,
          tone: opts.tone || 'success',
          badge: opts.badge || '已验证',
          element: opts.element || null,
          inset: opts.inset || 0,
          relation: opts.relation || null,
          durationMs: opts.durationMs,
        });
      },
    };
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

  function findVisibleDialogByText(text) {
    return Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((el) => isVisible(el) && ((el.innerText || '').includes(text)));
  }

  function findVisibleElementByExactText(root, selector, text) {
    if (!root) return null;
    return Array.from(root.querySelectorAll(selector))
      .find((el) => isVisible(el) && ((el.innerText || '').trim() === text));
  }

  function normalizeGenerateFullLanguage(input) {
    if (input == null) return null;
    const raw = String(input).trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'zh' || raw === 'chinese' || raw === '中文') return '中文';
    if (raw === 'en' || raw === 'english') return 'English';
    return null;
  }

  function normalizeGenerateFullCnRefs(input) {
    if (input == null) return null;
    const raw = String(input).trim().toLowerCase();
    if (!raw) return null;
    if (['yes', 'y', 'true', '1', '是'].includes(raw)) return '是';
    if (['no', 'n', 'false', '0', '否'].includes(raw)) return '否';
    return null;
  }

  function normalizeGenerateFullDialogAction(input) {
    if (input == null) return null;
    const raw = String(input).trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'confirm' || raw === 'ok' || raw === '确定') return '确定';
    if (raw === 'cancel' || raw === '取消') return '取消';
    return null;
  }

  function isGenerateFullOptionSelected(el) {
    if (!el) return false;
    const color = String(getComputedStyle(el).color || '').replace(/\s+/g, '');
    return color === 'rgb(255,255,255)';
  }

  function readGenerateFullDialogState(dialog) {
    if (!dialog) return { language: '', cnRefs: '' };
    const language = ['中文', 'English'].find((label) => {
      const el = findVisibleElementByExactText(dialog, 'div', label);
      return el && isGenerateFullOptionSelected(el);
    }) || '';
    const cnRefs = ['是', '否'].find((label) => {
      const el = findVisibleElementByExactText(dialog, 'div', label);
      return el && isGenerateFullOptionSelected(el);
    }) || '';
    return { language, cnRefs };
  }

  async function waitForGenerateFullDialog(timeoutMs = 1800) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const dialog = findVisibleDialogByText('确认生成全文');
      if (dialog) return dialog;
      await sleep(80);
    }
    return null;
  }

  async function selectGenerateFullDialogOption(dialog, label, kind) {
    let currentDialog = dialog;
    let option = findVisibleElementByExactText(currentDialog, 'div', label);
    if (!option) {
      return err('E_NOT_FOUND', `生成全文确认框里未找到${kind}选项"${label}"`);
    }
    option.click();
    for (let i = 0; i < 12; i++) {
      await sleep(80);
      currentDialog = findVisibleDialogByText('确认生成全文') || currentDialog;
      option = findVisibleElementByExactText(currentDialog, 'div', label);
      if (option && isGenerateFullOptionSelected(option)) {
        return ok({ label });
      }
    }
    return err('E_UI_MISMATCH', `${kind}选项"${label}"点击后未进入选中态`);
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
    const flow = createVisualFlow('scroll-to', {
      target: path,
      detail: summarizeText(hit.text || ''),
    });
    flow.locate({
      element: nodeVisualAnchor(hit._node),
      badge: '已滚动到目标',
      durationMs: 520,
    });
    flow.verify({
      element: nodeVisualAnchor(hit._node),
      badge: '位置已确认',
      tone: 'info',
      durationMs: 620,
    });
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
    const anchor = nodeVisualAnchor(hit._node);
    const beforeText = summarizeText(hit.text || '');
    const afterText = summarizeText(text);
    const flow = createVisualFlow('rename', {
      target: path,
      detail: joinParts([beforeText && `原文: ${beforeText}`, afterText && `新文: ${afterText}`]),
    });
    hit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
    flow.locate({ element: anchor });
    flow.execute({
      element: anchor,
      badge: '正在替换文本',
      detail: joinParts([beforeText && `原文: ${beforeText}`, afterText && `新文: ${afterText}`]),
    });
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
        const afterAnchor = nodeVisualAnchor(afterHit._node);
        flow.respond({
          element: afterAnchor,
          badge: '文本已回填',
          detail: joinParts([beforeText && `原文: ${beforeText}`, afterText && `新文: ${afterText}`]),
        });
        flow.verify({
          element: afterAnchor,
          badge: '原位置已替换',
          detail: afterText || '(空)',
        });
      }
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
    const parentAnchor = nodeVisualAnchor(hit._node);
    const detail = summarizeText(text || '(空)');
    const flow = createVisualFlow('add-child', {
      target: path,
      detail,
    });
    hit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
    flow.locate({
      element: parentAnchor,
      badge: '父节点已定位',
    });
    flow.execute({
      element: parentAnchor,
      badge: '正在添加子节点',
      detail: joinParts(['父节点', detail]),
    });
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
        const childAnchor = nodeVisualAnchor(childHit._node);
        flow.respond({
          target: childPath,
          element: childAnchor,
          badge: '新子节点已出现',
          detail: detail,
          relation: {
            from: parentAnchor,
            to: childAnchor,
            label: '父 -> 子',
          },
        });
        flow.verify({
          target: childPath,
          element: childAnchor,
          badge: verify.ok ? '新增子节点已验证' : '新增子节点待确认',
          tone: verify.ok ? 'success' : 'pending',
          detail: joinParts([childPath, detail]),
          relation: {
            from: parentAnchor,
            to: childAnchor,
            label: '新增结构',
          },
        });
      }
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
    const action = where === 'before' ? 'add-before' : 'add-after';
    const detail = summarizeText(text || '(空)');
    const parentAnchor = nodeVisualAnchor(parentHit._node);
    const selfAnchor = selfHit ? nodeVisualAnchor(selfHit._node) : null;
    const flow = createVisualFlow(action, {
      target: path,
      detail,
    });
    if (selfHit) {
      selfHit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
      flow.locate({
        element: selfAnchor,
        badge: '参考节点已定位',
      });
      flow.execute({
        element: selfAnchor,
        badge: where === 'before' ? '正在前插同级节点' : '正在后插同级节点',
        detail: joinParts([detail, where === 'before' ? '插入到当前节点之前' : '插入到当前节点之后']),
        relation: selfAnchor && parentAnchor ? {
          from: parentAnchor,
          to: selfAnchor,
          label: '同级参考',
        } : null,
      });
    }
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
        const newAnchor = nodeVisualAnchor(newHit._node);
        flow.respond({
          target: newPath,
          element: newAnchor,
          badge: '新同级节点已出现',
          detail: joinParts([newPath, detail]),
          relation: selfAnchor && newAnchor ? {
            from: selfAnchor,
            to: newAnchor,
            label: where === 'before' ? '前插完成' : '后插完成',
            fromSide: where === 'before' ? 'left' : 'right',
            toSide: where === 'before' ? 'right' : 'left',
          } : null,
        });
        flow.verify({
          target: newPath,
          element: newAnchor,
          badge: verify.ok ? '同级插入已验证' : '同级插入待确认',
          tone: verify.ok ? 'success' : 'pending',
          detail: joinParts([newPath, detail]),
          relation: selfAnchor && newAnchor ? {
            from: selfAnchor,
            to: newAnchor,
            label: '同级结构',
            fromSide: where === 'before' ? 'left' : 'right',
            toSide: where === 'before' ? 'right' : 'left',
          } : null,
        });
      }
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
    const parentPath = parentPathOf(path);
    const parentBefore = parentPath ? getNodeByPath(parentPath).hit : null;
    const anchor = nodeVisualAnchor(hit._node);
    const detail = summarizeText(hit.text || '');
    const flow = createVisualFlow('remove', {
      target: path,
      detail,
    });
    hit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
    flow.locate({
      element: anchor,
      badge: '待删除节点已定位',
      tone: 'danger',
    });
    flow.execute({
      element: anchor,
      badge: '准备删除',
      tone: 'danger',
      detail: detail,
    });
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
      const parentAfter = parentPath ? getNodeByPath(parentPath).hit : null;
      const parentAfterAnchor = parentAfter ? nodeVisualAnchor(parentAfter._node) : null;
      const fallbackAnchor = parentAfterAnchor || (still && still._node ? nodeVisualAnchor(still._node) : null);
      flow.respond({
        element: fallbackAnchor,
        badge: !stillHasSameTitle ? '页面已移除目标节点' : '页面正在重排',
        tone: !stillHasSameTitle ? 'info' : 'pending',
        detail: !stillHasSameTitle ? '节点已从当前位置消失' : '等待确认删除结果',
      });
      flow.verify({
        element: fallbackAnchor,
        badge: !stillHasSameTitle ? '删除结果已验证' : '删除结果待确认',
        tone: !stillHasSameTitle ? 'success' : 'pending',
        detail: !stillHasSameTitle
          ? joinParts([path, detail && `已删除: ${detail}`])
          : joinParts([path, '等待确认删除']),
        relation: parentBefore && parentAfterAnchor ? {
          from: nodeVisualAnchor(parentBefore._node),
          to: parentAfterAnchor,
          label: '结构已回收',
          fromSide: 'bottom',
          toSide: 'bottom',
        } : null,
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
    const anchor = nodeVisualAnchor(hit._node);
    const flow = createVisualFlow('select', {
      target: path,
      detail: summarizeText(hit.text || ''),
    });
    hit._node.scrollIntoView({ block: 'center', inline: 'nearest' });
    flow.locate({
      element: anchor,
      badge: '已定位',
      durationMs: 520,
    });
    flow.verify({
      element: anchor,
      badge: '仅视觉定位',
      tone: 'info',
      detail: joinParts([summarizeText(hit.text || ''), '无真实选中态']),
      durationMs: 760,
    });
    return ok({ path, note: 'rc-tree selectable=false，仅滚动+闪烁' });
  }

  // ---------- API: CTA ----------
  async function clickCta(name, options = {}) {
    if (!CTA_NAMES.includes(name) && !EDITOR_CTA_NAMES.includes(name)) {
      return err('E_BAD_ARG', `只接受这些按钮文案：${[...CTA_NAMES, ...EDITOR_CTA_NAMES].join(' / ')}`);
    }
    const wantsGenerateOptions = options && typeof options === 'object'
      && (options.fulltextLang != null || options.cnRefs != null || options.dialogAction != null);
    if (name !== '生成全文' && wantsGenerateOptions) {
      return err('E_BAD_ARG', '只有“生成全文”支持弹窗选项（fulltextLang / cnRefs / dialogAction）');
    }
    const desiredLanguage = normalizeGenerateFullLanguage(options && options.fulltextLang);
    if (options && options.fulltextLang != null && !desiredLanguage) {
      return err('E_BAD_ARG', 'fulltextLang 只接受 zh | en | 中文 | English');
    }
    const desiredCnRefs = normalizeGenerateFullCnRefs(options && options.cnRefs);
    if (options && options.cnRefs != null && !desiredCnRefs) {
      return err('E_BAD_ARG', 'cnRefs 只接受 yes | no | 是 | 否');
    }
    const dialogAction = normalizeGenerateFullDialogAction(options && options.dialogAction) || '确定';
    if (options && options.dialogAction != null && !normalizeGenerateFullDialogAction(options.dialogAction)) {
      return err('E_BAD_ARG', 'dialogAction 只接受 confirm | cancel | 确定 | 取消');
    }
    const btn = findVisibleButtonByText(name);
    if (!btn) return err('E_NOT_FOUND', `按钮"${name}"当前不可见`);
    if (btn.disabled) return err('E_DISABLED', `按钮"${name}"当前 disabled`);
    const flow = createVisualFlow('cta', {
      target: name,
      detail: '',
    });
    flow.locate({
      element: btn,
      badge: '按钮已定位',
      tone: 'info',
      inset: 4,
    });
    flow.execute({
      element: btn,
      badge: `正在点击：${name}`,
      inset: 4,
    });
    const beforeUrl = location.href;
    const res = await runInPage(pwClickBtnByText(name));
    if (!res || res.err) {
      if (res && res.err === 'disabled') return err('E_DISABLED', `按钮"${name}"已变 disabled`);
      return err('E_FIBER', `调用 onClick 失败: ${(res && res.err) || 'unknown'}`);
    }
    await sleep(280);
    if (name === '生成全文') {
      let dialog = await waitForGenerateFullDialog();
      if (dialog) {
        flow.respond({
          element: dialog,
          badge: '确认弹窗已出现',
          tone: 'info',
          detail: '可选择语言、中文文献与最终操作',
          inset: 10,
        });
        if (desiredLanguage) {
          const selected = await selectGenerateFullDialogOption(dialog, desiredLanguage, '语言');
          if (!selected.ok) return selected;
          dialog = findVisibleDialogByText('确认生成全文') || dialog;
        }
        const hasCnRefsOptions = !!findVisibleElementByExactText(dialog, 'div', '是')
          || !!findVisibleElementByExactText(dialog, 'div', '否');
        const cnRefsUnavailable = !!desiredCnRefs && !hasCnRefsOptions;
        if (desiredCnRefs && hasCnRefsOptions) {
          const selected = await selectGenerateFullDialogOption(dialog, desiredCnRefs, '中文文献');
          if (!selected.ok) return selected;
          dialog = findVisibleDialogByText('确认生成全文') || dialog;
        }
        const stateBeforeAction = readGenerateFullDialogState(dialog);
        const actionBtn = findVisibleElementByExactText(dialog, 'button', dialogAction);
        if (!actionBtn) {
          return err('E_NOT_FOUND', `生成全文确认框里未找到操作按钮"${dialogAction}"`);
        }
        actionBtn.click();
        if (dialogAction === '取消') {
          await sleep(260);
          const dialogClosed = !findVisibleDialogByText('确认生成全文');
          const afterUrl = location.href;
          flow.verify({
            element: btn,
            badge: dialogClosed ? '已取消生成全文' : '取消结果待确认',
            tone: dialogClosed ? 'success' : 'pending',
            inset: 4,
            detail: dialogClosed ? '确认框已关闭，未继续生成全文' : '确认框仍可见',
          });
          return ok({
            name,
            openedDialog: true,
            dialogAction: 'cancel',
            language: stateBeforeAction.language,
            cnRefs: stateBeforeAction.cnRefs,
            requestedCnRefs: desiredCnRefs || '',
            cnRefsUnavailable,
            dialogClosed,
            urlChanged: afterUrl !== beforeUrl,
            newUrl: afterUrl !== beforeUrl ? afterUrl : undefined,
            btnStillVisible: document.body.contains(btn) && isVisible(btn),
          });
        }
        let afterUrl = location.href;
        let dialogStillVisible = !!findVisibleDialogByText('确认生成全文');
        for (let i = 0; i < 40 && dialogStillVisible && afterUrl === beforeUrl; i++) {
          await sleep(150);
          afterUrl = location.href;
          dialogStillVisible = !!findVisibleDialogByText('确认生成全文');
        }
        const verified = afterUrl !== beforeUrl || !dialogStillVisible;
        const afterBtn = findVisibleButtonByText(name);
        if (afterBtn) {
          flow.respond({
            element: afterBtn,
            badge: afterUrl !== beforeUrl ? '确认后已跳转' : (dialogStillVisible ? '等待页面响应' : '确认框已关闭'),
            tone: verified ? 'info' : 'pending',
            inset: 4,
            detail: afterUrl !== beforeUrl ? afterUrl : (dialogStillVisible ? '等待页面继续处理' : '页面已消费确认框'),
          });
        }
        flow.verify({
          element: afterBtn || btn,
          badge: verified ? '生成全文操作已确认' : '生成全文结果待确认',
          tone: verified ? 'success' : 'pending',
          inset: 4,
          detail: joinParts([
            stateBeforeAction.language && `语言: ${stateBeforeAction.language}`,
            stateBeforeAction.cnRefs && `中文文献: ${stateBeforeAction.cnRefs}`,
            cnRefsUnavailable ? `中文文献选项当前不可用（请求: ${desiredCnRefs}）` : '',
            afterUrl !== beforeUrl ? `页面已跳转: ${afterUrl}` : (!dialogStillVisible ? '确认框已关闭' : '等待进一步页面响应'),
          ]),
        });
        return ok({
          name,
          openedDialog: true,
          dialogAction: 'confirm',
          language: stateBeforeAction.language,
          cnRefs: stateBeforeAction.cnRefs,
          requestedCnRefs: desiredCnRefs || '',
          cnRefsUnavailable,
          urlChanged: afterUrl !== beforeUrl,
          newUrl: afterUrl !== beforeUrl ? afterUrl : undefined,
          dialogClosed: !dialogStillVisible,
          verified,
          btnStillVisible: document.body.contains(btn) && isVisible(btn),
        });
      }
    }
    await sleep(720);
    const afterUrl = location.href;
    const afterBtn = findVisibleButtonByText(name);
    if (afterBtn) {
      flow.respond({
        element: afterBtn,
        badge: afterUrl !== beforeUrl ? '按钮触发后已跳转' : `已触发：${name}`,
        tone: afterUrl !== beforeUrl ? 'info' : 'pending',
        inset: 4,
        detail: afterUrl !== beforeUrl ? afterUrl : '操作已触发，等待结果确认',
      });
    }
    flow.verify({
      element: afterBtn || btn,
      badge: afterUrl !== beforeUrl ? '跳转结果已确认' : '按钮操作已确认',
      tone: 'success',
      inset: 4,
      detail: afterUrl !== beforeUrl ? `页面已跳转: ${afterUrl}` : '操作已触发',
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
