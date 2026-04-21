/* eslint-disable */
/**
 * home-bridge.js —— 注入到 https://review.newidea.pro/home 的桥接脚本
 *
 * 目标：
 * - 识别 home 页面
 * - 探测主按钮状态
 * - 触发主按钮 React onClick
 * - 提供轻量视觉反馈
 */
;(() => {
  const VERSION = '0.1.0';

  const PRIMARY_ACTIONS = [
    { id: 'resume-local', label: '继续编辑本地文档' },
    { id: 'generate-outline', label: '生成提纲' },
  ];

  const VISUAL_DEFAULTS = {
    enabled: false,
    durationMs: 420,
    detailLevel: 'staged',
  };
  const VISUAL_STYLE_ID = '__jse_home_visual_style__';
  const VISUAL_LAYER_ID = '__jse_home_visual_layer__';
  const VISUAL_HUD_ID = '__jse_home_visual_hud__';
  const VISUAL_TONE_MAP = {
    pending: { border: '#faad14', fill: 'rgba(250, 173, 20, 0.16)', pill: '#ad6800', text: '#fffbe6' },
    success: { border: '#52c41a', fill: 'rgba(82, 196, 26, 0.14)', pill: '#237804', text: '#f6ffed' },
    danger: { border: '#ff4d4f', fill: 'rgba(255, 77, 79, 0.14)', pill: '#a8071a', text: '#fff1f0' },
    info: { border: '#1677ff', fill: 'rgba(22, 119, 255, 0.14)', pill: '#0958d9', text: '#f0f5ff' },
  };
  const VISUAL_STAGE_COPY = {
    locate: '已定位',
    execute: '执行中',
    respond: '页面已响应',
    verify: '已验证',
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

  function isStagedVisual() {
    return visualState.config.detailLevel !== 'compact';
  }

  function summarizeText(text, max = 96) {
    if (text == null) return '';
    const clean = String(text).replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
  }

  function toneSpec(tone) {
    return VISUAL_TONE_MAP[tone] || VISUAL_TONE_MAP.info;
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
        .__jse_home_box{
          position:fixed;
          box-sizing:border-box;
          border-radius:999px;
          animation:__jse_home_pulse .55s ease-out 1;
        }
        .__jse_home_badge{
          position:absolute;
          left:0;
          top:-28px;
          max-width:280px;
          padding:4px 10px;
          border-radius:999px;
          font:600 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
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
        @keyframes __jse_home_pulse{
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

  function removeLater(el, durationMs) {
    if (!el) return;
    window.setTimeout(() => {
      if (el && el.parentNode) el.remove();
    }, normalizeDuration(durationMs));
  }

  function cleanupVisualArtifacts() {
    const layer = document.getElementById(VISUAL_LAYER_ID);
    if (!layer) return;
    Array.from(layer.querySelectorAll('.__jse_home_box')).forEach((el) => el.remove());
    const hud = document.getElementById(VISUAL_HUD_ID);
    if (hud) hud.remove();
    if (visualState.hudTimer) {
      clearTimeout(visualState.hudTimer);
      visualState.hudTimer = null;
    }
  }

  function flashElement(el, { tone = 'info', label = '', durationMs, inset = 4 } = {}) {
    if (!el || !visualState.config.enabled) return false;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const layer = ensureVisualRoot();
    const spec = toneSpec(tone);
    const box = document.createElement('div');
    box.className = '__jse_home_box';
    box.style.left = Math.max(4, rect.left - inset) + 'px';
    box.style.top = Math.max(4, rect.top - inset) + 'px';
    box.style.width = Math.max(24, rect.width + inset * 2) + 'px';
    box.style.height = Math.max(24, rect.height + inset * 2) + 'px';
    box.style.border = `2px solid ${spec.border}`;
    box.style.background = spec.fill;
    box.style.boxShadow = `0 0 0 1px ${spec.border}33, 0 12px 28px ${spec.border}22`;
    if (label) {
      const badge = document.createElement('div');
      badge.className = '__jse_home_badge';
      badge.textContent = label;
      badge.style.background = spec.pill;
      badge.style.color = spec.text;
      badge.style.top = rect.top < 38 ? rect.height + 8 + 'px' : '-28px';
      box.appendChild(badge);
    }
    layer.appendChild(box);
    removeLater(box, durationMs || visualState.config.durationMs);
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
    hud.textContent = [action, target, detail].filter(Boolean).join('\n');
    hud.style.border = `1px solid ${spec.border}`;
    hud.style.background = spec.fill.replace(/0\.\d+\)$/, '0.92)');
    hud.style.color = spec.pill;
    if (visualState.hudTimer) clearTimeout(visualState.hudTimer);
    visualState.hudTimer = window.setTimeout(() => {
      if (hud && hud.parentNode) hud.remove();
      visualState.hudTimer = null;
    }, Math.max(900, normalizeDuration(durationMs || visualState.config.durationMs) * 2));
    return true;
  }

  function createVisualFlow(action, target) {
    return {
      stage(name, opts = {}) {
        if (!visualState.config.enabled) return false;
        const badge = opts.badge || VISUAL_STAGE_COPY[name] || '';
        if (opts.element) {
          flashElement(opts.element, {
            tone: opts.tone || 'info',
            label: badge,
            durationMs: opts.durationMs,
            inset: opts.inset == null ? 4 : opts.inset,
          });
        }
        if (!(name === 'locate' && !isStagedVisual())) {
          showHud({
            action: isStagedVisual() ? `${action} · ${VISUAL_STAGE_COPY[name] || ''}` : action,
            target,
            status: opts.tone || 'info',
            detail: opts.detail || '',
            durationMs: opts.durationMs,
          });
        }
        return true;
      },
    };
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeAction(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    return PRIMARY_ACTIONS.find((item) => item.id === raw || item.label === raw || item.id === lower) || null;
  }

  function getReactOnClick(el) {
    if (!el) return null;
    const pkey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    const props = pkey ? el[pkey] : null;
    return props && typeof props.onClick === 'function' ? props.onClick : null;
  }

  function getTopicTextarea() {
    return document.querySelector('textarea');
  }

  function getTopicValue() {
    return getTopicTextarea()?.value || '';
  }

  function setTextareaValue(el, value) {
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findPrimaryButton(action) {
    const match = normalizeAction(action);
    if (!match) return null;
    const button = Array.from(document.querySelectorAll('button')).find((btn) => {
      return (btn.innerText || '').trim() === match.label && isVisible(btn);
    });
    return button ? { ...match, button } : { ...match, button: null };
  }

  function snapshotPrimaryActions() {
    return PRIMARY_ACTIONS.map((item) => {
      const hit = findPrimaryButton(item.id);
      const button = hit && hit.button;
      return {
        id: item.id,
        label: item.label,
        visible: !!button,
        disabled: !!(button && button.disabled),
      };
    });
  }

  function version() {
    return ok({ version: VERSION });
  }

  function probe() {
    return ok({
      version: VERSION,
      url: location.href,
      title: document.title,
      onHomePage: location.pathname === '/home',
      xrayAvailable: typeof (document.documentElement && document.documentElement.wrappedJSObject) !== 'undefined',
      topicValue: summarizeText(getTopicValue(), 160),
      topicLength: getTopicValue().length,
      primaryActions: snapshotPrimaryActions(),
    });
  }

  function state() {
    return ok({
      url: location.href,
      title: document.title,
      pathname: location.pathname,
      topicValue: summarizeText(getTopicValue(), 160),
      topicLength: getTopicValue().length,
      primaryActions: snapshotPrimaryActions(),
    });
  }

  function setTopic(text) {
    if (location.pathname !== '/home') {
      return err('E_UI_MISMATCH', '当前不在 /home 页面');
    }
    if (typeof text !== 'string') {
      return err('E_BAD_ARG', 'text 需为字符串');
    }
    const textarea = getTopicTextarea();
    if (!textarea) {
      return err('E_NOT_FOUND', '未找到综述主题输入框');
    }
    setTextareaValue(textarea, text);
    return ok({
      topicValue: summarizeText(getTopicValue(), 160),
      topicLength: getTopicValue().length,
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

  async function clickPrimary(action, options = {}) {
    if (location.pathname !== '/home') {
      return err('E_UI_MISMATCH', '当前不在 /home 页面');
    }
    const hit = findPrimaryButton(action);
    const normalized = normalizeAction(action);
    if (!normalized) {
      return err('E_BAD_ARG', `只接受这些主按钮：${PRIMARY_ACTIONS.map((item) => item.label).join(' / ')}`);
    }
    if (!hit || !hit.button) {
      return err('E_NOT_FOUND', `按钮"${normalized.label}"当前不可见`);
    }
    if (hit.button.disabled) {
      return err('E_DISABLED', `按钮"${normalized.label}"当前 disabled`);
    }
    const onClick = getReactOnClick(hit.button);
    if (!onClick) {
      return err('E_FIBER', `按钮"${normalized.label}"缺少 React onClick`);
    }
    const textarea = getTopicTextarea();
    const requestedTopic = options && typeof options === 'object' && typeof options.topic === 'string'
      ? options.topic
      : null;
    if (requestedTopic != null && textarea) {
      setTextareaValue(textarea, requestedTopic);
      await sleep(80);
    }
    const effectiveTopic = getTopicValue();
    if (normalized.id === 'generate-outline' && !effectiveTopic.trim()) {
      return err('E_BAD_ARG', '生成提纲前需要提供主题文本，或先在页面中填写综述主题');
    }

    const flow = createVisualFlow('primary', normalized.label);
    flow.stage('locate', {
      element: hit.button,
      tone: 'info',
      badge: '按钮已定位',
    });
    flow.stage('execute', {
      element: hit.button,
      tone: 'pending',
      badge: `正在点击：${normalized.label}`,
      detail: normalized.id === 'generate-outline' ? summarizeText(effectiveTopic, 120) : '',
    });

    const beforeUrl = location.href;
    const beforePath = location.pathname;
    const beforeTitle = document.title;
    const evt = {
      preventDefault: () => {},
      stopPropagation: () => {},
      nativeEvent: { preventDefault: () => {}, stopPropagation: () => {} },
      currentTarget: hit.button,
      target: hit.button,
      type: 'click',
      bubbles: true,
      defaultPrevented: false,
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
    };
    onClick(evt);

    let afterUrl = location.href;
    let afterPath = location.pathname;
    let afterTitle = document.title;
    let changed = afterUrl !== beforeUrl || afterPath !== beforePath || afterTitle !== beforeTitle;
    for (let i = 0; i < 40 && !changed; i++) {
      await sleep(150);
      afterUrl = location.href;
      afterPath = location.pathname;
      afterTitle = document.title;
      changed = afterUrl !== beforeUrl || afterPath !== beforePath || afterTitle !== beforeTitle;
    }

    flow.stage('respond', {
      element: hit.button,
      tone: changed ? 'info' : 'pending',
      badge: changed ? '页面已响应' : '等待页面响应',
      detail: changed ? summarizeText(afterUrl) : 'URL/标题尚未变化',
    });

    const currentActions = snapshotPrimaryActions();
    const buttonState = currentActions.find((item) => item.id === normalized.id);
    const verified = changed || !buttonState || !buttonState.visible;
    flow.stage('verify', {
      element: hit.button,
      tone: verified ? 'success' : 'pending',
      badge: verified ? '跳转结果已确认' : '跳转结果待确认',
      detail: summarizeText(afterUrl),
    });

    return ok({
      action: normalized.id,
      label: normalized.label,
      beforeUrl,
      afterUrl,
      beforePath,
      afterPath,
      topicValue: normalized.id === 'generate-outline' ? summarizeText(effectiveTopic, 160) : '',
      urlChanged: afterUrl !== beforeUrl,
      pathChanged: afterPath !== beforePath,
      titleChanged: afterTitle !== beforeTitle,
      verified,
      primaryActions: currentActions,
    });
  }

  const api = {
    version,
    probe,
    state,
    setVisualOptions,
    setTopic,
    clickPrimary,
    __meta: { version: VERSION, loadedAt: new Date().toISOString() },
  };

  try {
    window.__jse_home__ = api;
  } catch (e) {
    return JSON.stringify({ ok: false, code: 'E_INSTALL', message: String(e && e.message || e) });
  }
  return JSON.stringify({ ok: true, version: VERSION, installedAt: api.__meta.loadedAt });
})();
