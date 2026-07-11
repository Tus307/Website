// ui.js — Owns DOM element caching and every UI-facing update:
// tabs, secondary-input visibility, progress bar, result panel,
// explanation panel, toast notifications, button enable/disable,
// and the speed slider. Contains no cryptographic logic and never
// touches index.html or style.css directly — any extra styling it
// needs (toasts, fade-in) is injected as a small runtime stylesheet
// built from the existing CSS custom properties, so it stays
// theme-independent.

import { qs, qsa, speedToLabel, copyToClipboard } from './utils.js';

const TOAST_DURATION_MS = 3200;

let toastContainer = null;
let stylesInjected = false;

const TAB_CONFIG = [
  { radio: 'tab-visualization', panel: 'panel-visualization' },
  { radio: 'tab-timeline', panel: 'panel-timeline' },
  { radio: 'tab-logger', panel: 'panel-logger' },
  { radio: 'tab-result', panel: 'panel-result' },
  { radio: 'tab-explanation', panel: 'panel-explanation' },
];

/* =========================================================
   RUNTIME STYLES — theme-independent, built from CSS variables
   already defined in style.css. Injected once, never mutates
   the stylesheet file itself.
   ========================================================= */
function injectDynamicStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.setAttribute('data-source', 'ui.js');
  style.textContent = `
    .ui-toast-container{
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }
    .ui-toast{
      pointer-events: auto;
      min-width: 220px;
      max-width: 340px;
      padding: 12px 16px;
      border-radius: var(--radius-md, 10px);
      font-family: var(--font-display, sans-serif);
      font-size: 13px;
      color: var(--text-primary, #e7e9ee);
      background: linear-gradient(180deg, var(--surface-strong, rgba(255,255,255,0.06)), rgba(255,255,255,0.02));
      border: 1px solid var(--border-glass, rgba(255,255,255,0.09));
      backdrop-filter: blur(var(--blur-glass, 20px)) saturate(140%);
      -webkit-backdrop-filter: blur(var(--blur-glass, 20px)) saturate(140%);
      box-shadow: 0 12px 30px rgba(0,0,0,0.35);
      opacity: 0;
      transform: translateY(8px);
      transition: opacity .22s var(--ease, ease), transform .22s var(--ease, ease);
    }
    .ui-toast.is-visible{ opacity: 1; transform: translateY(0); }
    .ui-toast.is-leaving{ opacity: 0; transform: translateY(8px); }
    .ui-toast--success{ border-color: rgba(110,231,183,0.4); }
    .ui-toast--error{ border-color: rgba(248,113,113,0.45); }
    .ui-toast--info{ border-color: var(--border-glass-strong, rgba(255,255,255,0.16)); }

    .ui-fade-in{ animation: uiFadeIn .25s var(--ease, ease); }
    @keyframes uiFadeIn{
      from{ opacity: 0; transform: translateY(4px); }
      to{ opacity: 1; transform: translateY(0); }
    }
    .ui-pulse{ animation: uiPulse .4s var(--ease, ease); }
    @keyframes uiPulse{
      0%{ transform: scale(1); }
      40%{ transform: scale(1.03); }
      100%{ transform: scale(1); }
    }
    @media (prefers-reduced-motion: reduce){
      .ui-toast, .ui-fade-in, .ui-pulse{ transition: none; animation: none; }
    }
  `;
  document.head.appendChild(style);
}

function getToastContainer() {
  injectDynamicStyles();
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'ui-toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * Replay a CSS animation class by removing then re-adding it on the
 * next frame (classes alone don't restart already-applied animations).
 */
function replayAnimation(element, className) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth; // force reflow
  element.classList.add(className);
}

/* =========================================================
   DOM CACHING
   ========================================================= */

/**
 * Collect every DOM reference the app needs, in one place, so other
 * modules never call document.querySelector directly.
 */
export function getDomRefs() {
  return {
    statusIndicator: qs('#status-indicator'),
    statusLabel: qs('#status-label'),

    algorithmSelect: qs('#algorithm-select'),
    modeEncrypt: qs('#mode-encrypt'),
    modeDecrypt: qs('#mode-decrypt'),

    inputPrimary: qs('#input-primary'),
    inputSecondaryWrap: qs('#input-secondary-wrap'),
    inputSecondary: qs('#input-secondary'),
    inputSecondaryHint: qs('#input-secondary-hint'),

    btnSimulate: qs('#btn-simulate'),
    btnStep: qs('#btn-step'),
    btnAutorun: qs('#btn-autorun'),
    btnPause: qs('#btn-pause'),
    btnPrev: qs('#btn-prev'),
    btnNext: qs('#btn-next'),
    btnReset: qs('#btn-reset'),

    speedSlider: qs('#speed-slider'),
    speedValue: qs('#speed-value'),

    progressLabel: qs('#progress-label'),
    progressCount: qs('#progress-count'),
    progressBar: qs('#progress-bar'),
    progressFill: qs('#progress-fill'),

    tabRadios: qsa('input[name="tabs"]'),

    visualizationCanvas: qs('#visualization-canvas'),
    visualizationAlgoTag: qs('#visualization-algo-tag'),

    timelineSteps: qs('#timeline-steps'),

    loggerOutput: qs('#logger-output'),
    btnDownloadLog: qs('#btn-download-log'),

    resultOutput: qs('#result-output'),
    btnCopyResult: qs('#btn-copy-result'),

    explanationContent: qs('#explanation-content'),
  };
}

/* =========================================================
   TABS
   ========================================================= */

/**
 * Wire up accessibility state and enter-animation for the CSS-only
 * (radio-driven) tab system already defined in index.html/style.css.
 * The visual show/hide is handled entirely by the existing CSS
 * sibling selectors; this only manages ARIA + the fade-in replay.
 *
 * @param {object} refs - result of getDomRefs()
 * @param {(activeRadioId: string) => void} [onChange] - optional hook
 */
export function initTabs(refs, onChange) {
  injectDynamicStyles();

  function syncActiveTab() {
    TAB_CONFIG.forEach(({ radio, panel }) => {
      const radioEl = qs(`#${radio}`);
      const panelEl = qs(`#${panel}`);
      if (!radioEl || !panelEl) return;

      const isActive = radioEl.checked;
      radioEl.setAttribute('aria-selected', String(isActive));
      radioEl.setAttribute('tabindex', isActive ? '0' : '-1');
      panelEl.setAttribute('aria-hidden', String(!isActive));
      // The CSS sibling-selector rule (#tab-x:checked ~ #panel-x) never matches
      // because the radios live under <nav class="tabs"> while the panels live
      // under a separate <div class="tabs-wrap"> — they aren't DOM siblings.
      // Control visibility directly here instead of relying on that CSS rule.
      panelEl.style.display = isActive ? 'block' : 'none';

      if (isActive) {
        replayAnimation(panelEl, 'ui-fade-in');
      }
    });
  }

  TAB_CONFIG.forEach(({ radio, panel }) => {
    const radioEl = qs(`#${radio}`);
    const panelEl = qs(`#${panel}`);
    if (!radioEl || !panelEl) return;

    radioEl.setAttribute('role', 'tab');
    radioEl.setAttribute('aria-controls', panel);
    panelEl.setAttribute('role', 'tabpanel');
    panelEl.setAttribute('aria-labelledby', radio);

    radioEl.addEventListener('change', () => {
      if (!radioEl.checked) return;
      syncActiveTab();
      if (onChange) onChange(radio);
    });
  });

  syncActiveTab();
}

/* =========================================================
   STATUS / PROGRESS
   ========================================================= */

/**
 * Update the small status dot + label in the header.
 * @param {'ready'|'running'|'paused'|'finished'} stateKey
 * @param {string} label - Vietnamese status text.
 */
export function setStatus(refs, stateKey, label) {
  refs.statusIndicator.dataset.state = stateKey;
  refs.statusLabel.textContent = label;
}

/**
 * Reflect the current step number in the progress bar and its label.
 */
export function updateProgress(refs, currentStep, totalSteps) {
  const percent = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
  refs.progressFill.style.width = `${percent}%`;
  refs.progressBar.setAttribute('aria-valuenow', String(percent));
  refs.progressCount.textContent = `Bước ${currentStep} / ${totalSteps}`;
}

/* =========================================================
   SECONDARY INPUT (KEY FIELD)
   ========================================================= */

/**
 * Show/hide the secondary (key) input depending on whether the
 * selected algorithm requires one, and update its hint text.
 */
export function toggleSecondaryInput(refs, isVisible, hintText) {
  const wasHidden = refs.inputSecondaryWrap.classList.contains('is-hidden');
  refs.inputSecondaryWrap.classList.toggle('is-hidden', !isVisible);
  if (hintText) {
    refs.inputSecondaryHint.textContent = hintText;
  }
  if (isVisible && wasHidden) {
    replayAnimation(refs.inputSecondaryWrap, 'ui-fade-in');
  }
}

/* =========================================================
   ALGORITHM TAG / SPEED SLIDER
   ========================================================= */

/**
 * Update the small tag shown above the visualization canvas.
 */
export function setAlgorithmTag(refs, label) {
  refs.visualizationAlgoTag.textContent = label;
}

/**
 * Sync the visible speed multiplier with the slider's raw value.
 */
export function updateSpeedLabel(refs, rawValue) {
  refs.speedValue.textContent = speedToLabel(rawValue);
}

/**
 * Bind the speed slider's input event to a callback, keeping the
 * label in sync automatically. Returns the raw numeric value to the
 * callback so app.js can forward it to the animation controller.
 * @param {(rawValue: number) => void} onChange
 */
export function bindSpeedSlider(refs, onChange) {
  refs.speedSlider.addEventListener('input', (event) => {
    const rawValue = Number(event.target.value);
    updateSpeedLabel(refs, rawValue);
    if (onChange) onChange(rawValue);
  });
}

/* =========================================================
   TIMELINE
   ========================================================= */

/**
 * Mark a timeline step as active/completed/upcoming.
 * @param {number} activeStep - 1-indexed step number (0 = none active).
 */
export function highlightTimelineStep(refs, activeStep) {
  const steps = Array.from(refs.timelineSteps.children);
  steps.forEach((stepEl) => {
    const stepNumber = Number(stepEl.dataset.step);
    stepEl.classList.toggle('is-active', stepNumber === activeStep);
    stepEl.classList.toggle('is-complete', stepNumber < activeStep);
  });
}

/* =========================================================
   EXPLANATION / RESULT PANELS
   ========================================================= */

/**
 * Replace the explanation panel content for the selected algorithm.
 */
export function setExplanation(refs, text) {
  refs.explanationContent.textContent = text;
  replayAnimation(refs.explanationContent, 'ui-fade-in');
}

/**
 * Replace the result panel content, clearing the placeholder state.
 */
export function setResult(refs, text) {
  refs.resultOutput.textContent = text;
  replayAnimation(refs.resultOutput, 'ui-pulse');
}

/* =========================================================
   BUTTON STATE
   ========================================================= */

/**
 * Enable/disable a group of buttons together, e.g. disabling step
 * controls while autorun is active.
 */
export function setButtonsDisabled(buttons, disabled) {
  buttons.forEach((button) => {
    if (button) button.disabled = disabled;
  });
}

/* =========================================================
   CLIPBOARD
   ========================================================= */

/**
 * Copy the result panel's current text to the clipboard and report
 * success/failure back to the caller for logging/status purposes.
 */
export async function copyResultToClipboard(refs) {
  return copyToClipboard(refs.resultOutput.textContent.trim());
}

/* =========================================================
   TOAST NOTIFICATIONS
   ========================================================= */

/**
 * Show a transient toast notification. Purely additive to the DOM
 * (creates its own container on first use) — never touches
 * index.html or style.css.
 * @param {string} message - Vietnamese message to display.
 * @param {'info'|'success'|'error'} [type]
 * @returns {{ dismiss: () => void }}
 */
export function showToast(message, type = 'info') {
  const container = getToastContainer();

  const toast = document.createElement('div');
  toast.className = `ui-toast ui-toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.remove('is-visible');
    toast.classList.add('is-leaving');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  };

  setTimeout(dismiss, TOAST_DURATION_MS);
  return { dismiss };
}