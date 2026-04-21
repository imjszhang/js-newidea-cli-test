/* eslint-disable */
/**
 * proofread-bridge.js —— 注入到 https://review.newidea.pro/proofread 的桥接脚本
 *
 * 第二阶段目标：
 * - 识别 /proofread 页面
 * - 读取顶部 CTA、段落校对卡片与当前活动段
 * - 支持按 paragraphIndex 选中段落
 * - 支持进入编辑态、识别编辑态与 AI 改写面板
 * - 暴露 version / probe / state / selectSection / enterEditMode / setRewritePrompt / clickEditorButton
 */
;(() => {
  const VERSION = '0.4.0';
  const VISUAL_DEFAULTS = {
    enabled: false,
    durationMs: 420,
    detailLevel: 'staged',
  };
  const SECTION_PROMPTS = ['点击本段进入编辑校对', '请校对本段内容'];
  const TOP_BUTTONS = ['返回提纲', '折叠提纲', '完成校对', '本地保存'];
  const EDITOR_BUTTONS = ['确认校对', 'AI 改写', '一键重写', '一键复制', '替换原文'];
  const visualState = {
    config: { ...VISUAL_DEFAULTS },
  };

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
    return value === 'compact' || value === 'staged' ? value : fallback;
  }

  function normalizeVisualOptions(options = {}) {
    const base = { ...visualState.config };
    if (!options || typeof options !== 'object') return base;
    if (typeof options.enabled === 'boolean') base.enabled = options.enabled;
    if (options.durationMs != null) base.durationMs = normalizeDuration(options.durationMs, base.durationMs);
    if (options.detailLevel != null) base.detailLevel = normalizeDetailLevel(options.detailLevel, base.detailLevel);
    return base;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function normalizeText(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function summarizeText(text, max = 120) {
    const clean = normalizeText(text);
    if (!clean) return '';
    return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
  }

  function textLines(el) {
    return String((el && (el.innerText || el.textContent)) || '')
      .split(/\r?\n+/)
      .map((line) => normalizeText(line))
      .filter(Boolean);
  }

  function isProofreadCardElement(el) {
    if (!isVisible(el)) return false;
    const className = typeof el.className === 'string' ? el.className : '';
    return className.includes('rounded-2xl') && className.includes('p-2') && className.includes('mb-1');
  }

  function isProofreadSection(el) {
    if (!isProofreadCardElement(el)) return false;
    const lines = textLines(el);
    if (lines.some((line) => SECTION_PROMPTS.includes(line))) return true;
    if (isEditingSection(el)) return true;
    return Array.from(el.querySelectorAll('button'))
      .filter(isVisible)
      .some((button) => EDITOR_BUTTONS.includes(normalizeText(button.innerText || button.textContent || '')));
  }

  function isSectionActive(prompt, className) {
    return prompt === '点击本段进入编辑校对' || String(className || '').includes('hover:bg-secondary');
  }

  function snapshotSection(el, index) {
    const lines = textLines(el);
    const prompt = lines.find((line) => SECTION_PROMPTS.includes(line)) || '';
    const heading = Array.from(el.querySelectorAll('h1, h2, h3'))
      .filter(isVisible)
      .map((node) => normalizeText(node.innerText || node.textContent || ''))
      .find(Boolean);
    const title = heading || lines.find((line) => line && line !== prompt && !EDITOR_BUTTONS.includes(line)) || '';
    const bodyPreview = summarizeText(lines.slice(2).join(' '), 180);
    const className = typeof el.className === 'string' ? el.className : '';
    return {
      index,
      prompt,
      title,
      bodyPreview,
      active: isSectionActive(prompt, className) || isEditingSection(el),
      editing: isEditingSection(el),
      className,
    };
  }

  function listProofreadSections({ includeElement = false } = {}) {
    return Array.from(document.querySelectorAll('section'))
      .filter(isProofreadSection)
      .map((el, index) => {
        const entry = snapshotSection(el, index);
        if (includeElement) entry._el = el;
        return entry;
      });
  }

  function listVisibleButtons() {
    return Array.from(document.querySelectorAll('button'))
      .filter(isVisible)
      .map((button) => ({
        label: normalizeText(button.innerText || button.textContent || ''),
        disabled: !!button.disabled,
      }))
      .filter((item) => item.label);
  }

  function snapshotTopButtons() {
    const visible = listVisibleButtons();
    return TOP_BUTTONS.map((label) => {
      const hit = visible.find((item) => item.label === label);
      return {
        label,
        visible: !!hit,
        disabled: !!(hit && hit.disabled),
      };
    });
  }

  function isEditingSection(el) {
    if (!el || !isVisible(el)) return false;
    const className = typeof el.className === 'string' ? el.className : '';
    return className.includes('border-primary') || className.includes('caret-inherit') || className.includes('cursor-auto');
  }

  function findEditingSectionEntry() {
    const editingEl = Array.from(document.querySelectorAll('section'))
      .filter(isProofreadCardElement)
      .find((el) => isEditingSection(el));
    if (!editingEl) return null;
    const allCards = Array.from(document.querySelectorAll('section')).filter(isProofreadCardElement);
    const entry = snapshotSection(editingEl, Math.max(0, allCards.indexOf(editingEl)));
    return {
      index: entry.index,
      title: entry.title,
      prompt: entry.prompt,
      bodyPreview: entry.bodyPreview,
      active: entry.active,
      className: entry.className,
    };
  }

  function listEditorButtons() {
    return Array.from(document.querySelectorAll('button'))
      .filter(isVisible)
      .map((button) => ({
        label: normalizeText(button.innerText || button.textContent || ''),
        disabled: !!button.disabled,
        _el: button,
      }))
      .filter((item) => EDITOR_BUTTONS.includes(item.label));
  }

  function snapshotEditorButtons() {
    return listEditorButtons().map((item) => ({
      label: item.label,
      disabled: item.disabled,
    }));
  }

  function findRewriteTextarea() {
    return Array.from(document.querySelectorAll('textarea'))
      .filter(isVisible)
      .find((el) => normalizeText(el.getAttribute('placeholder') || '') === '请输入额外需求') || null;
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    const next = String(value);
    const prototype = Object.getPrototypeOf(el);
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(el, next);
    } else {
      el.value = next;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function snapshotRewritePanel() {
    const textarea = findRewriteTextarea();
    if (!textarea) {
      return {
        open: false,
        promptLength: 0,
        promptValue: '',
        placeholder: '',
      };
    }
    return {
      open: true,
      promptLength: String(textarea.value || '').length,
      promptValue: summarizeText(textarea.value || '', 160),
      placeholder: normalizeText(textarea.getAttribute('placeholder') || ''),
    };
  }

  function snapshotEditorState() {
    const editorButtons = snapshotEditorButtons();
    const rewritePanel = snapshotRewritePanel();
    let editingSection = findEditingSectionEntry();
    const inferredEditing = !!editingSection || editorButtons.length > 0 || rewritePanel.open;
    if (!editingSection && inferredEditing) {
      editingSection = listProofreadSections().find((section) => section.active) || null;
    }
    const rewriteReady = editorButtons.some((item) => (item.label === '一键复制' || item.label === '替换原文') && !item.disabled);
    return {
      editing: inferredEditing,
      editingSection,
      editorButtons,
      rewritePanel,
      rewriteReady,
    };
  }

  function findEditPromptControl(sectionEl) {
    if (!sectionEl) return null;
    const exact = sectionEl.querySelector('.flex.items-center.gap-x-2.text-primary.text-sm.cursor-pointer.select-none');
    if (exact && isVisible(exact)) return exact;
    return Array.from(sectionEl.querySelectorAll('*'))
      .filter(isVisible)
      .find((el) => {
        const className = typeof el.className === 'string' ? el.className : '';
        const text = normalizeText(el.innerText || el.textContent || '');
        return className.includes('cursor-pointer') && text.includes('点击本段进入编辑校对');
      }) || null;
  }

  function sampleSectionTitles(sections, limit = 8) {
    return sections
      .map((section) => section.title)
      .filter(Boolean)
      .slice(0, limit);
  }

  function normalizeSectionIndex(input) {
    if (typeof input === 'number' && Number.isInteger(input) && input >= 0) return input;
    if (typeof input !== 'string') return null;
    const clean = input.trim();
    if (!/^\d+$/.test(clean)) return null;
    const n = Number(clean);
    return Number.isInteger(n) ? n : null;
  }

  function dispatchPointerClick(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const pointer = { bubbles: true, cancelable: true, composed: true, clientX: centerX, clientY: centerY, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const mouseDown = { bubbles: true, cancelable: true, composed: true, clientX: centerX, clientY: centerY, button: 0, buttons: 1 };
    const mouseUp = { bubbles: true, cancelable: true, composed: true, clientX: centerX, clientY: centerY, button: 0, buttons: 0 };
    el.dispatchEvent(new PointerEvent('pointerover', pointer));
    el.dispatchEvent(new PointerEvent('pointerenter', pointer));
    el.dispatchEvent(new MouseEvent('mouseover', mouseDown));
    el.dispatchEvent(new MouseEvent('mouseenter', mouseDown));
    el.dispatchEvent(new PointerEvent('pointerdown', pointer));
    el.dispatchEvent(new MouseEvent('mousedown', mouseDown));
    el.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', mouseUp));
    el.dispatchEvent(new MouseEvent('click', mouseUp));
    return true;
  }

  async function waitForSectionState(index, { timeoutMs = 1800 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const sections = listProofreadSections();
      last = sections[index] || null;
      if (last && last.active) return { ok: true, section: last };
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return { ok: false, section: last };
  }

  async function waitForEditingState(index, { timeoutMs = 2200 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const sections = listProofreadSections({ includeElement: true });
      last = sections[index] || null;
      if (last && isEditingSection(last._el)) {
        return { ok: true, section: snapshotSection(last._el, index) };
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return { ok: false, section: last ? snapshotSection(last._el, index) : null };
  }

  function version() {
    return ok({ version: VERSION });
  }

  function probe() {
    const sections = listProofreadSections();
    const activeSection = sections.find((section) => section.active) || null;
    const editorState = snapshotEditorState();
    return ok({
      version: VERSION,
      url: location.href,
      title: document.title,
      onProofreadPage: location.pathname === '/proofread',
      xrayAvailable: typeof (document.documentElement && document.documentElement.wrappedJSObject) !== 'undefined',
      sectionCount: sections.length,
      activeSection,
      topButtons: snapshotTopButtons(),
      sectionTitlesSample: sampleSectionTitles(sections),
      editorState,
    });
  }

  function state() {
    const sections = listProofreadSections();
    const activeSection = sections.find((section) => section.active) || null;
    const editorState = snapshotEditorState();
    return ok({
      url: location.href,
      title: document.title,
      pathname: location.pathname,
      scrollY: window.scrollY,
      sectionCount: sections.length,
      activeSection,
      sections: sections.slice(0, 12),
      topButtons: snapshotTopButtons(),
      editorState,
    });
  }

  async function selectSection(input) {
    if (location.pathname !== '/proofread') {
      return err('E_UI_MISMATCH', '当前不在 /proofread 页面');
    }
    const index = normalizeSectionIndex(input);
    if (index == null) {
      return err('E_BAD_ARG', 'paragraphIndex 需要是从 0 开始的整数');
    }
    const sections = listProofreadSections({ includeElement: true });
    const target = sections[index];
    if (!target) {
      return err('E_NOT_FOUND', `未找到 paragraphIndex=${index} 的段落`, { sectionCount: sections.length });
    }
    const before = snapshotSection(target._el, index);
    target._el.scrollIntoView({ block: 'center', inline: 'nearest' });
    dispatchPointerClick(target._el);
    const waited = await waitForSectionState(index);
    const currentSections = listProofreadSections();
    const after = waited.section || currentSections[index] || null;
    return ok({
      paragraphIndex: index,
      title: after ? after.title : before.title,
      beforePrompt: before.prompt,
      afterPrompt: after ? after.prompt : before.prompt,
      beforeActive: before.active,
      afterActive: !!(after && after.active),
      verified: !!(after && after.active),
      sectionCount: currentSections.length,
      activeSection: currentSections.find((section) => section.active) || null,
    });
  }

  async function enterEditMode(input) {
    if (location.pathname !== '/proofread') {
      return err('E_UI_MISMATCH', '当前不在 /proofread 页面');
    }
    const index = normalizeSectionIndex(input);
    if (index == null) {
      return err('E_BAD_ARG', 'paragraphIndex 需要是从 0 开始的整数');
    }
    const sections = listProofreadSections({ includeElement: true });
    const target = sections[index];
    if (!target) {
      return err('E_NOT_FOUND', `未找到 paragraphIndex=${index} 的段落`, { sectionCount: sections.length });
    }
    let workingEl = target._el;
    if (!isEditingSection(workingEl)) {
      workingEl.scrollIntoView({ block: 'center', inline: 'nearest' });
      dispatchPointerClick(workingEl);
      await waitForSectionState(index, { timeoutMs: 1200 });
      const refreshed = listProofreadSections({ includeElement: true });
      const latest = refreshed[index];
      if (!latest) {
        return err('E_NOT_FOUND', `选中后未找到 paragraphIndex=${index} 的段落`, { sectionCount: refreshed.length });
      }
      workingEl = latest._el;
      if (!isEditingSection(workingEl)) {
        const promptControl = findEditPromptControl(workingEl) || findEditPromptControl(target._el);
        if (!promptControl) {
          return err('E_NOT_FOUND', `未找到 paragraphIndex=${index} 的编辑入口提示`, { activeSection: refreshed.find((section) => section.active) || null });
        }
        dispatchPointerClick(promptControl);
      }
    }
    const waited = await waitForEditingState(index);
    const editorState = snapshotEditorState();
    return ok({
      paragraphIndex: index,
      verified: !!waited.ok || !!editorState.editing,
      editorState,
    });
  }

  function normalizeEditorButtonName(input) {
    const raw = normalizeText(input);
    if (!raw) return null;
    const compact = raw.replace(/\s+/g, '');
    return EDITOR_BUTTONS.find((label) => label === raw || label.replace(/\s+/g, '') === compact) || null;
  }

  function clickEditorButton(input) {
    if (location.pathname !== '/proofread') {
      return err('E_UI_MISMATCH', '当前不在 /proofread 页面');
    }
    const label = normalizeEditorButtonName(input);
    if (!label) {
      return err('E_BAD_ARG', `只接受这些编辑态按钮：${EDITOR_BUTTONS.join(' / ')}`);
    }
    const hit = listEditorButtons().find((item) => item.label === label);
    if (!hit) {
      return err('E_NOT_FOUND', `未找到编辑态按钮"${label}"`);
    }
    if (hit.disabled) {
      return err('E_DISABLED', `编辑态按钮"${label}"当前 disabled`);
    }
    hit._el.click();
    return ok({
      label,
      editorState: snapshotEditorState(),
    });
  }

  function setRewritePrompt(text) {
    if (location.pathname !== '/proofread') {
      return err('E_UI_MISMATCH', '当前不在 /proofread 页面');
    }
    if (typeof text !== 'string') {
      return err('E_BAD_ARG', 'text 需为字符串');
    }
    const textarea = findRewriteTextarea();
    if (!textarea) {
      return err('E_NOT_FOUND', '未找到 AI 改写额外需求输入框');
    }
    setNativeValue(textarea, text);
    return ok({
      rewritePanel: snapshotRewritePanel(),
      editorState: snapshotEditorState(),
    });
  }

  function setVisualOptions(options = {}) {
    visualState.config = normalizeVisualOptions(options);
    return ok({ ...visualState.config });
  }

  const api = {
    version,
    probe,
    state,
    selectSection,
    enterEditMode,
    clickEditorButton,
    setRewritePrompt,
    setVisualOptions,
    __meta: { version: VERSION, loadedAt: new Date().toISOString() },
  };

  try {
    window.__jse_proofread__ = api;
  } catch (e) {
    return JSON.stringify({ ok: false, code: 'E_INSTALL', message: String((e && e.message) || e) });
  }
  return JSON.stringify({ ok: true, version: VERSION, installedAt: api.__meta.loadedAt });
})();
