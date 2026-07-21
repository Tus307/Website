// app.js — Application entry point. Wires the DOM to every other module:
// ui.js (DOM refs, tabs, toasts, panels), logger.js (execution log),
// animation.js (step playback), and algorithm.js (AlgorithmManager, which
// hosts the real logic for Bitwise XOR/AND/OR, MD5, SHA-256, and Base64).
//
// Responsibilities:
//   - Bind every control in the UI to a handler (algorithm/mode selection,
//     text inputs, speed slider, playback buttons, log/result actions).
//   - Validate input and trigger algorithmManager.run(...) exactly once per
//     configuration (lazy, memoized in `activeRun` until inputs change).
//   - Drive the AnimationController through the resulting step list.
//   - Render each step into #visualization-canvas. Four families of step
//     types are supported: Bitwise (ascii/binary/bit/output/notice),
//     MD5 (md5-*), SHA-256 (sha256-*), and Base64 encode/decode (b64-*/b64d-*).
// Caesar/Vigenère/AES/RSA remain unimplemented placeholders; attempting to
// run them surfaces a clear Vietnamese error via toast instead of crashing.

import {
  getDomRefs,
  initTabs,
  setStatus,
  updateProgress,
  toggleSecondaryInput,
  toggleDecryptMode,
  setAlgorithmTag,
  updateSpeedLabel,
  bindSpeedSlider,
  highlightTimelineStep,
  setExplanation,
  setResult,
  setButtonsDisabled,
  copyResultToClipboard,
  showToast,
} from './ui.js';
import { Logger } from './logger.js';
import { AnimationController, PlaybackState } from './animation.js';
import { algorithmManager } from './algorithm.js';

/* =========================================================
   BOOTSTRAP — wire the core modules together
   ========================================================= */

const refs = getDomRefs();
const logger = new Logger(refs.loggerOutput);

algorithmManager.attachLogger(logger);

/** @type {{ id: string, mode: string, steps: Array, result: string, binaryByChar: Map<number, object> } | null} */
let activeRun = null;

const animation = new AnimationController({
  onStepChange: (step, total) => {
    updateProgress(refs, step, total);
    highlightTimelineStep(refs, step);
    renderVisualization(step);
  },
  onStateChange: (state) => {
    reflectPlaybackState(state);
  },
});

algorithmManager.attachAnimation(animation);

const STATE_LABELS = {
  [PlaybackState.IDLE]: 'Sẵn sàng',
  [PlaybackState.RUNNING]: 'Đang chạy tự động',
  [PlaybackState.PAUSED]: 'Đã tạm dừng',
  [PlaybackState.FINISHED]: 'Hoàn tất mô phỏng',
};

const STATE_KEYS = {
  [PlaybackState.IDLE]: 'ready',
  [PlaybackState.RUNNING]: 'running',
  [PlaybackState.PAUSED]: 'paused',
  [PlaybackState.FINISHED]: 'finished',
};

const CANVAS_PLACEHOLDER =
  '<p class="canvas-placeholder">Khu vực trực quan hóa các bước biến đổi dữ liệu sẽ hiển thị tại đây.</p>';
const RESULT_PLACEHOLDER =
  '<p class="result-placeholder">Kết quả sau khi mã hóa hoặc giải mã sẽ xuất hiện ở đây.</p>';

/** Reflect the AnimationController's playback state in the status dot/label and buttons. */
function reflectPlaybackState(state) {
  setStatus(refs, STATE_KEYS[state], STATE_LABELS[state]);
  const isRunning = state === PlaybackState.RUNNING;
  setButtonsDisabled([refs.btnPause], !isRunning);
  setButtonsDisabled([refs.btnAutorun], isRunning);
}

function currentMode() {
  return refs.modeDecrypt.checked ? 'decrypt' : 'encrypt';
}

function applyAlgorithmSelection() {
  const meta = algorithmManager.get(refs.algorithmSelect.value);
  if (!meta) return;

  setAlgorithmTag(refs, meta.label);
  setExplanation(refs, meta.explanation);
  toggleSecondaryInput(refs, meta.requiresKey, meta.keyHint);

  const forcedToEncrypt = toggleDecryptMode(refs, meta.decodable);
  if (forcedToEncrypt) {
    logger.log(`Thuật toán "${meta.label}" chưa hỗ trợ giải mã trong ứng dụng này — chuyển về chế độ mã hóa.`);
  }

  logger.log(`Đã chọn thuật toán: ${meta.label}.`);
  resetRunState({ silent: true });
}

/**
 * Bumped every time the loaded run is invalidated (reset, algorithm/mode
 * change, input edit). ensureRunStarted() snapshots this before awaiting
 * algorithmManager.run() and checks it again afterwards — if it changed
 * while the (possibly async) execute() was in flight, the user has since
 * moved on, so the result is discarded instead of resurrecting a run
 * they already dismissed.
 */
let runGeneration = 0;

/**
 * Clear whatever algorithm run is currently loaded (steps/result), reset
 * the animation controller to zero, and restore the canvas/result panels
 * to their placeholder state. Does not clear the log unless requested by
 * the caller separately (see btnReset handler).
 */
function resetRunState({ silent = false } = {}) {
  runGeneration += 1;
  activeRun = null;
  animation.setTotalSteps(0);
  refs.visualizationCanvas.innerHTML = CANVAS_PLACEHOLDER;
  refs.resultOutput.innerHTML = RESULT_PLACEHOLDER;
  if (!silent) logger.log('Đã đặt lại trạng thái mô phỏng.');
}

/**
 * Lazily run the currently-selected algorithm against the current inputs
 * if it hasn't been run yet. Validates the key/second-text requirement
 * and surfaces any error as a toast rather than throwing.
 * Async because algorithmManager.run() may await a Promise-based execute()
 * (e.g. SHA-256/Base64-decode via Web Crypto or a thrown validation error).
 * @returns {Promise<boolean>} true if a run is loaded and ready to step through.
 */
let runInFlight = false;

async function ensureRunStarted() {
  if (activeRun) return true;
  if (runInFlight) return false;

  const id = refs.algorithmSelect.value;
  const meta = algorithmManager.get(id);
  if (!meta) {
    showToast('Không tìm thấy thuật toán được chọn.', 'error');
    return false;
  }

  const input = refs.inputPrimary.value;
  const key = refs.inputSecondary.value;
  const mode = currentMode();

  if (!meta.isImplemented) {
    showToast(`Thuật toán "${meta.label}" chưa được triển khai logic thực thi.`, 'error');
    return false;
  }

  if (meta.requiresKey && !key) {
    showToast(`Thuật toán "${meta.label}" yêu cầu ${meta.keyHint || 'khóa/tham số thứ hai'}.`, 'error');
    return false;
  }

  const myGeneration = runGeneration;
  runInFlight = true;
  try {
    const { steps, result } = await algorithmManager.run(id, { mode, input, key });

    if (myGeneration !== runGeneration) {
      // Invalidated (reset / algorithm switch / input edit) while execute()
      // was still pending — silently discard rather than resurrecting it.
      return false;
    }

    const binaryByChar = new Map();
    steps.forEach((step) => {
      if (step.type === 'binary') binaryByChar.set(step.charIndex, step);
    });

    activeRun = { id, mode, steps, result, binaryByChar };
    setResult(refs, result);
    return true;
  } catch (error) {
    // algorithmManager.run() already calls animation.setTotalSteps(steps.length)
    // right after generateSteps() succeeds, BEFORE calling execute() — so if
    // execute() itself throws (e.g. malformed Base64 input reaching
    // atob()), the progress bar/count would otherwise be left stuck showing
    // a non-zero total for a run that never actually completed and that
    // activeRun never got set for. Reset the playback/progress state too,
    // not just the toast, so the UI accurately reflects "no run loaded".
    // Only do this — and only surface the toast — if nothing else already
    // invalidated/replaced this attempt in the meantime.
    if (myGeneration === runGeneration) {
      resetRunState({ silent: true });
      showToast(error.message, 'error');
    }
    return false;
  } finally {
    runInFlight = false;
  }
}

/* =========================================================
   VISUALIZATION RENDERING
   Renders the current step into #visualization-canvas. Styling is
   injected once at runtime (same pattern ui.js uses for toasts) —
   style.css itself is never touched.
   ========================================================= */

let vizStylesInjected = false;

function injectVisualizationStyles() {
  if (vizStylesInjected) return;
  vizStylesInjected = true;

  const style = document.createElement('style');
  style.setAttribute('data-source', 'app.js');
  style.textContent = `
    .bwv-card{ display:flex; flex-direction:column; gap:14px; align-items:center; font-family: var(--font-display, sans-serif); max-width: 480px; }
    .bwv-card-title{ font-size:13px; color: var(--text-secondary,#9497a3); letter-spacing:.02em; text-align:center; }
    .bwv-card-body{ font-size:13px; color: var(--text-primary,#e7e9ee); text-align:center; line-height:1.5; }
    .bwv-card--notice .bwv-card-body{ color: var(--accent-key,#e8b876); }

    .bwv-pair{ display:flex; gap:24px; }
    .bwv-slot{ display:flex; flex-direction:column; align-items:center; gap:4px; padding:12px 18px; border-radius: var(--radius-md,10px); border:1px solid var(--border-glass,rgba(255,255,255,.09)); background: var(--surface,rgba(255,255,255,.035)); min-width:100px; }
    .bwv-slot-label{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color: var(--text-tertiary,#5e616e); }
    .bwv-slot-char{ font-family: var(--font-mono,monospace); font-size:22px; color: var(--text-primary,#e7e9ee); }
    .bwv-slot-code{ font-family: var(--font-mono,monospace); font-size:12px; color: var(--text-secondary,#9497a3); }
    .bwv-slot--a{ border-color: rgba(124,158,255,.35); }
    .bwv-slot--b{ border-color: rgba(232,184,118,.35); }

    .bwv-binary-row{ display:flex; gap:20px; }
    .bwv-binary-col{ display:flex; flex-direction:column; align-items:center; gap:6px; }
    .bwv-binary-label{ font-size:11px; color: var(--text-tertiary,#5e616e); text-transform:uppercase; letter-spacing:.08em; }
    .bwv-binary-value{ font-family: var(--font-mono,monospace); font-size:20px; letter-spacing:.28em; padding:8px 12px; border-radius: var(--radius-sm,6px); background: var(--surface-strong,rgba(255,255,255,.06)); }
    .bwv-binary-value--a{ color: var(--accent-cipher,#7c9eff); }
    .bwv-binary-value--b{ color: var(--accent-key,#e8b876); }

    .bwv-bit-row{ display:flex; gap:6px; flex-wrap:wrap; justify-content:center; }
    .bwv-bit-col{ display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 6px; border-radius: var(--radius-sm,6px); border:1px solid var(--border-glass,rgba(255,255,255,.09)); min-width:34px; transition: transform .18s var(--ease,ease), border-color .18s var(--ease,ease), background .18s var(--ease,ease); }
    .bwv-bit-val{ font-family: var(--font-mono,monospace); font-size:14px; line-height:1.25; }
    .bwv-bit-val--a{ color: var(--accent-cipher,#7c9eff); }
    .bwv-bit-val--b{ color: var(--accent-key,#e8b876); }
    .bwv-bit-op{ font-size:10px; color: var(--text-tertiary,#5e616e); }
    .bwv-bit-val--result{ color: var(--text-secondary,#9497a3); font-weight:600; }
    .bwv-bit-col--current{ border-color: var(--text-primary,#e7e9ee); transform: scale(1.14); background: var(--surface-strong,rgba(255,255,255,.06)); }
    .bwv-bit-col--active .bwv-bit-val--result{ color: var(--success,#6ee7b7); }
    .bwv-bit-col--active{ border-color: rgba(110,231,183,.5); }

    .bwv-bit-legend{ display:flex; gap:14px; font-size:11px; color: var(--text-tertiary,#5e616e); flex-wrap:wrap; justify-content:center; }
    .bwv-swatch{ display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; vertical-align:middle; }
    .bwv-swatch--a{ background: var(--accent-cipher,#7c9eff); }
    .bwv-swatch--b{ background: var(--accent-key,#e8b876); }
    .bwv-swatch--active{ background: var(--success,#6ee7b7); }

    .bwv-output-row{ display:flex; align-items:center; gap:12px; font-family: var(--font-mono,monospace); flex-wrap:wrap; justify-content:center; }
    .bwv-output-bin{ font-size:18px; letter-spacing:.2em; color: var(--text-primary,#e7e9ee); }
    .bwv-output-arrow{ color: var(--text-tertiary,#5e616e); }
    .bwv-output-dec{ color: var(--accent-cipher,#7c9eff); font-size:16px; }
    .bwv-output-hex{ color: var(--accent-key,#e8b876); font-size:16px; }

    @media (prefers-reduced-motion: reduce){
      .bwv-bit-col{ transition:none; }
    }

    /* ---- MD5 / SHA-256 visualizer ---- */
    .md5-block-list{ display:flex; flex-direction:column; gap:8px; max-width:420px; }
    .md5-block-row{ display:flex; gap:10px; align-items:baseline; }
    .md5-block-label{ font-size:11px; color: var(--text-tertiary,#5e616e); text-transform:uppercase; letter-spacing:.06em; min-width:52px; }
    .md5-block-hex{ font-family: var(--font-mono,monospace); font-size:11px; color: var(--text-primary,#e7e9ee); word-break:break-all; letter-spacing:.02em; }

    .md5-reg-row{ display:flex; gap:14px; flex-wrap:wrap; justify-content:center; }
    .md5-reg{ display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 16px; border-radius: var(--radius-md,10px); border:1px solid var(--border-glass,rgba(255,255,255,.09)); background: var(--surface,rgba(255,255,255,.035)); min-width:96px; }
    .md5-reg-label{ font-size:12px; font-weight:700; color: var(--text-secondary,#9497a3); }
    .md5-reg-val{ font-family: var(--font-mono,monospace); font-size:13px; color: var(--text-primary,#e7e9ee); }
    .md5-reg--a{ border-color: rgba(124,158,255,.35); }
    .md5-reg--b{ border-color: rgba(232,184,118,.35); }
    .md5-reg--c{ border-color: rgba(110,231,183,.35); }
    .md5-reg--d{ border-color: rgba(248,113,113,.35); }

    .md5-round-formula{ font-family: var(--font-mono,monospace); font-size:14px; color: var(--accent-cipher,#7c9eff); text-align:center; }
    .md5-round-shifts{ font-family: var(--font-mono,monospace); font-size:12px; color: var(--accent-key,#e8b876); }

    .md5-digest-hex{ font-family: var(--font-mono,monospace); font-size:16px; letter-spacing:.08em; color: var(--success,#6ee7b7); word-break:break-all; text-align:center; padding:10px 16px; border-radius: var(--radius-md,10px); background: var(--surface-strong,rgba(255,255,255,.06)); border:1px solid rgba(110,231,183,.35); }

    /* ---- Base64 visualizer ---- */
    .b64-bytes-row{ display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
    .b64-byte-chip{ display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 12px; border-radius: var(--radius-sm,6px); border:1px solid var(--border-glass,rgba(255,255,255,.09)); background: var(--surface,rgba(255,255,255,.035)); min-width:64px; }
    .b64-byte-label{ font-size:10px; text-transform:uppercase; letter-spacing:.06em; color: var(--text-tertiary,#5e616e); }
    .b64-byte-val{ font-family: var(--font-mono,monospace); font-size:15px; color: var(--accent-cipher,#7c9eff); }
    .b64-byte-char{ font-family: var(--font-mono,monospace); font-size:12px; color: var(--text-secondary,#9497a3); }

    .b64-binary-row{ display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
    .b64-binary-chip{ font-family: var(--font-mono,monospace); font-size:14px; letter-spacing:.16em; padding:8px 12px; border-radius: var(--radius-sm,6px); background: var(--surface-strong,rgba(255,255,255,.06)); color: var(--text-primary,#e7e9ee); }

    .b64-card-body-mono{ font-family: var(--font-mono,monospace); font-size:13px; letter-spacing:.1em; color: var(--text-primary,#e7e9ee); text-align:center; word-break:break-all; max-width:440px; }
    .b64-zero-pad{ color: var(--accent-key,#e8b876); }

    .b64-group-row{ display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
    .b64-group-chip{ font-family: var(--font-mono,monospace); font-size:13px; padding:6px 10px; border-radius: var(--radius-sm,6px); border:1px solid rgba(124,158,255,.35); color: var(--accent-cipher,#7c9eff); }

    .b64-lookup-row{ display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
    .b64-lookup-item{ display:flex; align-items:center; gap:6px; padding:8px 12px; border-radius: var(--radius-sm,6px); border:1px solid var(--border-glass,rgba(255,255,255,.09)); background: var(--surface,rgba(255,255,255,.035)); font-family: var(--font-mono,monospace); font-size:13px; }
    .b64-lookup-bits{ color: var(--text-secondary,#9497a3); }
    .b64-lookup-arrow{ color: var(--text-tertiary,#5e616e); }
    .b64-lookup-val{ color: var(--accent-key,#e8b876); }
    .b64-lookup-char{ color: var(--success,#6ee7b7); font-weight:700; }

    .b64-pad-badge{ margin-top:6px; font-family: var(--font-mono,monospace); font-size:12px; color: var(--accent-key,#e8b876); text-align:center; }

    .b64-final-output{ font-family: var(--font-mono,monospace); font-size:16px; letter-spacing:.06em; color: var(--success,#6ee7b7); word-break:break-all; text-align:center; padding:10px 16px; border-radius: var(--radius-md,10px); background: var(--surface-strong,rgba(255,255,255,.06)); border:1px solid rgba(110,231,183,.35); }

    /* ---- Hill Cipher visualizer ---- */
    .hill-matrix-wrap{ display:flex; flex-direction:column; align-items:center; gap:6px; }
    .hill-matrix-label{ font-size:11px; color: var(--text-tertiary,#5e616e); text-transform:uppercase; letter-spacing:.06em; }
    .hill-matrix{ display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; }
    .hill-matrix-cell{ display:flex; align-items:center; justify-content:center; min-width:48px; min-height:48px; border-radius: var(--radius-sm,6px); border:1px solid var(--border-glass,rgba(255,255,255,.09)); background: var(--surface,rgba(255,255,255,.035)); font-family: var(--font-mono,monospace); font-size:18px; color: var(--accent-cipher,#7c9eff); }
  `;
  document.head.appendChild(style);
}

/**
 * Extract the hash digest from a result string formatted as
 * `Label("input") = hexdigest` (used by MD5/SHA-256). Deliberately avoids
 * regex-matching a fixed-length hex pattern anywhere in the string, since
 * user input containing 32/64 consecutive hex-looking characters could
 * false-match before the real digest is reached. The digest is always the
 * trailing segment after the LAST "= ", so slicing from there is reliable
 * no matter what the input contains.
 */
function extractDigestFromResult(resultText) {
  const marker = '= ';
  const idx = resultText.lastIndexOf(marker);
  if (idx === -1) return resultText;
  return resultText.slice(idx + marker.length).trim();
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/* ---- Shared card-building helpers (used across all four algorithm families) ---- */

/** Generic "title + description" info/warning card, used for input/padding/notice steps. */
function renderNoticeCard(step, { title = 'Lưu ý', notice = false } = {}) {
  return `
    <div class="bwv-card${notice ? ' bwv-card--notice' : ''}">
      <div class="bwv-card-title">${escapeHtml(title)}</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
    </div>
  `;
}

/** Generic "title + description + highlighted final value" card, used for every digest/final-output step. */
function renderOutputSummaryCard({ title, description, value, valueClassName }) {
  return `
    <div class="bwv-card bwv-card--output">
      <div class="bwv-card-title">${escapeHtml(title)}</div>
      <div class="bwv-card-body">${escapeHtml(description)}</div>
      <div class="${valueClassName}">${escapeHtml(value)}</div>
    </div>
  `;
}

/** A single byte "chip" (decimal value, optional label, optional printable-char annotation). */
function renderByteChip(byteValue, { label = '', showChar = true } = {}) {
  const labelHtml = label ? `<span class="b64-byte-label">${escapeHtml(label)}</span>` : '';
  const charHtml =
    showChar && byteValue >= 32 && byteValue <= 126
      ? `<span class="b64-byte-char">"${escapeHtml(String.fromCharCode(byteValue))}"</span>`
      : '';
  return `
    <div class="b64-byte-chip">
      ${labelHtml}
      <span class="b64-byte-val">${byteValue}</span>
      ${charHtml}
    </div>
  `;
}

/** A single "label: hex value" row, used for MD5 block hexes and SHA-256 schedule words. */
function renderLabeledHexRow(label, hexValue) {
  return `<div class="md5-block-row"><span class="md5-block-label">${escapeHtml(label)}</span><span class="md5-block-hex">${hexValue}</span></div>`;
}

/** A row of labeled 32-bit register chips, used for MD5 buffers and SHA-256 H0..H7. */
function renderRegisterRow(entries) {
  const cols = entries
    .map(
      ({ label, hex }, idx) => `
      <div class="md5-reg md5-reg--${['a', 'b', 'c', 'd'][idx % 4]}">
        <span class="md5-reg-label">${escapeHtml(label)}</span>
        <span class="md5-reg-val">0x${hex.toUpperCase()}</span>
      </div>
    `
    )
    .join('');
  return `<div class="md5-reg-row">${cols}</div>`;
}

/* ---- Bitwise (XOR) render helpers ---- */

function renderAsciiCard(step) {
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Ký tự ${step.charIndex + 1} — ASCII</div>
      <div class="bwv-pair">
        <div class="bwv-slot bwv-slot--a">
          <span class="bwv-slot-label">Text A</span>
          <span class="bwv-slot-char">${escapeHtml(step.charA)}</span>
          <span class="bwv-slot-code">ASCII ${step.codeA}</span>
        </div>
        <div class="bwv-slot bwv-slot--b">
          <span class="bwv-slot-label">Text B</span>
          <span class="bwv-slot-char">${escapeHtml(step.charB)}</span>
          <span class="bwv-slot-code">ASCII ${step.codeB}</span>
        </div>
      </div>
    </div>
  `;
}

function renderBinaryCard(step) {
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Ký tự ${step.charIndex + 1} — Nhị phân 8-bit</div>
      <div class="bwv-binary-row">
        <div class="bwv-binary-col">
          <span class="bwv-binary-label">Text A</span>
          <span class="bwv-binary-value bwv-binary-value--a">${step.binA}</span>
        </div>
        <div class="bwv-binary-col">
          <span class="bwv-binary-label">Text B</span>
          <span class="bwv-binary-value bwv-binary-value--b">${step.binB}</span>
        </div>
      </div>
    </div>
  `;
}

function renderBitCard(step) {
  const binStep = activeRun.binaryByChar.get(step.charIndex);
  const binA = binStep ? binStep.binA : '00000000';
  const binB = binStep ? binStep.binB : '00000000';

  const revealedBits = activeRun.steps.filter(
    (s) => s.type === 'bit' && s.charIndex === step.charIndex && s.bitPos <= step.bitPos
  );

  const cols = [];
  for (let i = 0; i < 8; i += 1) {
    const revealed = revealedBits.find((s) => s.bitPos === i);
    const isCurrent = i === step.bitPos;
    const resultDisplay = revealed ? String(revealed.resultBit) : '·';
    const activeClass = revealed && revealed.active ? 'bwv-bit-col--active' : '';
    const currentClass = isCurrent ? 'bwv-bit-col--current' : '';

    cols.push(`
      <div class="bwv-bit-col ${activeClass} ${currentClass}">
        <span class="bwv-bit-val bwv-bit-val--a">${binA[i]}</span>
        <span class="bwv-bit-val bwv-bit-val--b">${binB[i]}</span>
        <span class="bwv-bit-op">${step.opLabel}</span>
        <span class="bwv-bit-val bwv-bit-val--result">${resultDisplay}</span>
      </div>
    `);
  }

  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Ký tự ${step.charIndex + 1} — So sánh bit ${step.bitNumberFromLeft}/8 (${step.opLabel})</div>
      <div class="bwv-bit-row">${cols.join('')}</div>
      <div class="bwv-bit-legend">
        <span><i class="bwv-swatch bwv-swatch--a"></i>Text A</span>
        <span><i class="bwv-swatch bwv-swatch--b"></i>Text B</span>
        <span><i class="bwv-swatch bwv-swatch--active"></i>Bit kích hoạt</span>
      </div>
    </div>
  `;
}

function renderOutputCard(step) {
  return `
    <div class="bwv-card bwv-card--output">
      <div class="bwv-card-title">Ký tự ${step.charIndex + 1} — Byte kết quả</div>
      <div class="bwv-output-row">
        <span class="bwv-output-bin">${step.resultBin}</span>
        <span class="bwv-output-arrow">→</span>
        <span class="bwv-output-dec">${step.resultByte}</span>
        <span class="bwv-output-hex">0x${step.resultHex}</span>
      </div>
    </div>
  `;
}

/* ---- Hill Cipher render helpers ---- */

/** A compact 2x2 matrix grid (e.g. the key matrix K or its inverse K⁻¹). */
function renderHillMatrix(label, matrix) {
  const cells = matrix
    .flat()
    .map((v) => `<div class="hill-matrix-cell">${v}</div>`)
    .join('');
  return `
    <div class="hill-matrix-wrap">
      <span class="hill-matrix-label">${escapeHtml(label)}</span>
      <div class="hill-matrix">${cells}</div>
    </div>
  `;
}

function renderHillKeyCard(step) {
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Ma trận khóa K</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
      ${renderHillMatrix('K', step.data.matrix)}
    </div>
  `;
}

function renderHillKeyInverseCard(step) {
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Ma trận nghịch đảo K⁻¹</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
      ${renderHillMatrix('K⁻¹', step.data.inverse)}
    </div>
  `;
}

function renderHillPairLettersCard(step) {
  const { ch1, ch2, p1, p2 } = step.data;
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Cặp ${step.pairIndex + 1} — Chữ cái → Số</div>
      <div class="bwv-pair">
        <div class="bwv-slot bwv-slot--a">
          <span class="bwv-slot-label">Ký tự 1</span>
          <span class="bwv-slot-char">${escapeHtml(ch1)}</span>
          <span class="bwv-slot-code">= ${p1}</span>
        </div>
        <div class="bwv-slot bwv-slot--b">
          <span class="bwv-slot-label">Ký tự 2</span>
          <span class="bwv-slot-char">${escapeHtml(ch2)}</span>
          <span class="bwv-slot-code">= ${p2}</span>
        </div>
      </div>
    </div>
  `;
}

function renderHillPairOutputCard(step) {
  const { r1, r2, outCh1, outCh2 } = step.data;
  return `
    <div class="bwv-card bwv-card--output">
      <div class="bwv-card-title">Cặp ${step.pairIndex + 1} — Kết quả</div>
      <div class="bwv-pair">
        <div class="bwv-slot bwv-slot--a">
          <span class="bwv-slot-label">Số → Chữ</span>
          <span class="bwv-slot-char">${escapeHtml(outCh1)}</span>
          <span class="bwv-slot-code">= ${r1}</span>
        </div>
        <div class="bwv-slot bwv-slot--b">
          <span class="bwv-slot-label">Số → Chữ</span>
          <span class="bwv-slot-char">${escapeHtml(outCh2)}</span>
          <span class="bwv-slot-code">= ${r2}</span>
        </div>
      </div>
    </div>
  `;
}

/* ---- MD5 render helpers ---- */

function renderMd5BlocksCard(step) {
  const items = step.data.blockHexes
    .map((hex, idx) => renderLabeledHexRow(`Khối ${idx + 1}`, hex.match(/.{1,8}/g).join(' ')))
    .join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">${step.data.blockCount} khối 512-bit</div>
      <div class="md5-block-list">${items}</div>
    </div>
  `;
}

function renderMd5BuffersCard(step) {
  const entries = ['A', 'B', 'C', 'D'].map((r) => ({ label: r, hex: step.data[r] }));
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Khởi tạo thanh ghi (buffer)</div>
      ${renderRegisterRow(entries)}
    </div>
  `;
}

function renderMd5RoundCard(step) {
  const d = step.data;
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Vòng ${d.n} / 4</div>
      <div class="md5-round-formula">${escapeHtml(d.fn)}</div>
      <div class="bwv-card-body">${escapeHtml(d.order)}</div>
      <div class="md5-round-shifts">Dịch trái theo nhóm 4 thao tác: ${escapeHtml(d.shifts)}</div>
    </div>
  `;
}

/* ---- SHA-256 render helpers ---- */

function renderSha256ScheduleCard(step) {
  const words = step.data.w0to15.map((w, idx) => renderLabeledHexRow(`W[${idx}]`, w)).join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Lịch trình thông điệp — W[0..15]</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
      <div class="md5-block-list">${words}</div>
    </div>
  `;
}

function renderSha256CompressionCard(step) {
  const entries = step.data.hInit.map((h, idx) => ({ label: `H${idx}`, hex: h }));
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Vòng nén (64 vòng)</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
      ${renderRegisterRow(entries)}
    </div>
  `;
}

/* ---- Base64 render helpers (encode) ---- */

function renderB64BytesCard(step) {
  const items = step.data.bytes
    .map((b, idx) => renderByteChip(b, { label: `Byte ${step.data.startIndex + idx + 1}` }))
    .join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Khối ${step.chunkIndex + 1} — Byte / ASCII</div>
      <div class="b64-bytes-row">${items}</div>
    </div>
  `;
}

function renderB64BinaryCard(step) {
  const items = step.data.binaries.map((bin) => `<div class="b64-binary-chip">${bin}</div>`).join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Khối ${step.chunkIndex + 1} — Nhị phân 8-bit</div>
      <div class="b64-binary-row">${items}</div>
    </div>
  `;
}

function renderB64GroupCard(step) {
  const groups = step.data.groups.map((g) => `<div class="b64-group-chip">${g}</div>`).join('');
  const zeroNote =
    step.data.zeroBitsAdded > 0
      ? `<span class="b64-zero-pad">${'0'.repeat(step.data.zeroBitsAdded)}</span>`
      : '';
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Khối ${step.chunkIndex + 1} — Nhóm 6-bit</div>
      <div class="b64-card-body-mono">${step.data.bitString}${zeroNote}</div>
      <div class="b64-group-row">${groups}</div>
    </div>
  `;
}

function renderB64LookupCard(step) {
  const items = step.data.lookupChars
    .map(
      (l) => `
      <div class="b64-lookup-item">
        <span class="b64-lookup-bits">${l.bits}</span>
        <span class="b64-lookup-arrow">→</span>
        <span class="b64-lookup-val">${l.value}</span>
        <span class="b64-lookup-arrow">→</span>
        <span class="b64-lookup-char">"${escapeHtml(l.char)}"</span>
      </div>
    `
    )
    .join('');
  const padBadge =
    step.data.padCharsCount > 0
      ? `<div class="b64-pad-badge">+ ${'='.repeat(step.data.padCharsCount)} (ký tự đệm)</div>`
      : '';
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Khối ${step.chunkIndex + 1} — Tra bảng Base64</div>
      <div class="b64-lookup-row">${items}</div>
      ${padBadge}
    </div>
  `;
}

/* ---- Base64 render helpers (decode) ---- */

function renderB64dLookupCard(step) {
  const items = step.data.lookup
    .map(
      (l) => `
      <div class="b64-lookup-item">
        <span class="b64-lookup-char">"${escapeHtml(l.char)}"</span>
        <span class="b64-lookup-arrow">→</span>
        <span class="b64-lookup-val">${l.value}</span>
        <span class="b64-lookup-arrow">→</span>
        <span class="b64-lookup-bits">${l.bits}</span>
      </div>
    `
    )
    .join('');
  const padBadge =
    step.data.padCount > 0
      ? `<div class="b64-pad-badge">bỏ qua ${step.data.padCount} ký tự đệm "="</div>`
      : '';
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Nhóm ${step.chunkIndex + 1} — Tra chỉ số ngược</div>
      <div class="b64-lookup-row">${items || '<span class="bwv-card-body">Không có ký tự hợp lệ</span>'}</div>
      ${padBadge}
    </div>
  `;
}

function renderB64dRegroupCard(step) {
  const bytesChips = step.data.chunkBytes.map((b) => renderByteChip(b, { showChar: false })).join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Nhóm ${step.chunkIndex + 1} — Ghép lại thành byte 8-bit</div>
      <div class="b64-card-body-mono">${step.data.bitString}</div>
      <div class="b64-bytes-row">${bytesChips}</div>
    </div>
  `;
}

function renderB64dAsciiCard(step) {
  const items = step.data.bytes.map((b) => renderByteChip(b)).join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Nhóm ${step.chunkIndex + 1} — Byte → Ký tự</div>
      <div class="b64-bytes-row">${items || '<span class="bwv-card-body">Không có byte nào</span>'}</div>
    </div>
  `;
}

/**
 * Render the visualization canvas for the given 1-indexed step number
 * (0 or no active run ⇒ placeholder).
 */
function renderVisualization(stepNumber) {
  injectVisualizationStyles();

  if (!activeRun || stepNumber <= 0) {
    refs.visualizationCanvas.innerHTML = CANVAS_PLACEHOLDER;
    return;
  }

  const step = activeRun.steps[stepNumber - 1];
  if (!step) return;

  switch (step.type) {
    // -- Bitwise (XOR/AND/OR) --
    case 'notice':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { notice: true });
      break;
    case 'ascii':
      refs.visualizationCanvas.innerHTML = renderAsciiCard(step);
      break;
    case 'binary':
      refs.visualizationCanvas.innerHTML = renderBinaryCard(step);
      break;
    case 'bit':
      refs.visualizationCanvas.innerHTML = renderBitCard(step);
      break;
    case 'output':
      refs.visualizationCanvas.innerHTML = renderOutputCard(step);
      break;

    // -- Hill Cipher --
    case 'hill-input':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { title: 'Đầu vào' });
      break;
    case 'hill-key':
      refs.visualizationCanvas.innerHTML = renderHillKeyCard(step);
      break;
    case 'hill-key-inverse':
      refs.visualizationCanvas.innerHTML = renderHillKeyInverseCard(step);
      break;
    case 'hill-notice':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { notice: true });
      break;
    case 'hill-pair-letters':
      refs.visualizationCanvas.innerHTML = renderHillPairLettersCard(step);
      break;
    case 'hill-pair-multiply':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, {
        title: `Cặp ${step.pairIndex + 1} — Nhân ma trận (mod 26)`,
      });
      break;
    case 'hill-pair-output':
      refs.visualizationCanvas.innerHTML = renderHillPairOutputCard(step);
      break;
    case 'hill-output':
      refs.visualizationCanvas.innerHTML = renderOutputSummaryCard({
        title: 'Kết quả Hill Cipher',
        description: step.description,
        value: step.data.result,
        valueClassName: 'b64-final-output',
      });
      break;

    // -- MD5 --
    case 'md5-input':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { title: 'Đầu vào' });
      break;
    case 'md5-padding':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { title: 'Đệm dữ liệu (padding)' });
      break;
    case 'md5-blocks':
      refs.visualizationCanvas.innerHTML = renderMd5BlocksCard(step);
      break;
    case 'md5-buffers':
      refs.visualizationCanvas.innerHTML = renderMd5BuffersCard(step);
      break;
    case 'md5-round':
      refs.visualizationCanvas.innerHTML = renderMd5RoundCard(step);
      break;
    case 'md5-digest':
      refs.visualizationCanvas.innerHTML = renderOutputSummaryCard({
        title: 'Digest MD5 (128-bit)',
        description: step.description,
        value: extractDigestFromResult(activeRun ? activeRun.result : ''),
        valueClassName: 'md5-digest-hex',
      });
      break;

    // -- SHA-256 --
    case 'sha256-input':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { title: 'Đầu vào' });
      break;
    case 'sha256-padding':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { title: 'Đệm dữ liệu (padding)' });
      break;
    case 'sha256-blocks':
      refs.visualizationCanvas.innerHTML = renderMd5BlocksCard(step);
      break;
    case 'sha256-schedule':
      refs.visualizationCanvas.innerHTML = renderSha256ScheduleCard(step);
      break;
    case 'sha256-compression':
      refs.visualizationCanvas.innerHTML = renderSha256CompressionCard(step);
      break;
    case 'sha256-digest':
      refs.visualizationCanvas.innerHTML = renderOutputSummaryCard({
        title: 'Digest SHA-256 (256-bit)',
        description: step.description,
        value: extractDigestFromResult(activeRun ? activeRun.result : ''),
        valueClassName: 'md5-digest-hex',
      });
      break;

    // -- Base64 encode --
    case 'b64-input':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { title: 'Đầu vào' });
      break;
    case 'b64-ascii':
      refs.visualizationCanvas.innerHTML = renderB64BytesCard(step);
      break;
    case 'b64-binary':
      refs.visualizationCanvas.innerHTML = renderB64BinaryCard(step);
      break;
    case 'b64-group6':
      refs.visualizationCanvas.innerHTML = renderB64GroupCard(step);
      break;
    case 'b64-lookup':
      refs.visualizationCanvas.innerHTML = renderB64LookupCard(step);
      break;
    case 'b64-padding':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { title: 'Đệm (Padding)' });
      break;
    case 'b64-output':
      refs.visualizationCanvas.innerHTML = renderOutputSummaryCard({
        title: 'Kết quả Base64',
        description: step.description,
        value: step.data.result,
        valueClassName: 'b64-final-output',
      });
      break;

    // -- Base64 decode --
    case 'b64d-input':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { title: 'Đầu vào Base64' });
      break;
    case 'b64d-lookup':
      refs.visualizationCanvas.innerHTML = renderB64dLookupCard(step);
      break;
    case 'b64d-regroup':
      refs.visualizationCanvas.innerHTML = renderB64dRegroupCard(step);
      break;
    case 'b64d-ascii':
      refs.visualizationCanvas.innerHTML = renderB64dAsciiCard(step);
      break;
    case 'b64d-padding':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step, { title: 'Đệm (Padding)' });
      break;
    case 'b64d-output':
      refs.visualizationCanvas.innerHTML = renderOutputSummaryCard({
        title: 'Kết quả giải mã',
        description: step.description,
        value: step.data.resultText,
        valueClassName: 'b64-final-output',
      });
      break;

    default:
      refs.visualizationCanvas.textContent = step.description || '';
  }
}

/* =========================================================
   EVENTS
   ========================================================= */

/** Shared handler for the two mode radios — only the log message differs. */
function handleModeChange(modeLabel) {
  logger.log(`Chuyển sang chế độ ${modeLabel}.`);
  resetRunState({ silent: true });
}

/** Shared handler for "Bước" and "Tiếp theo" — both advance one step, lazily starting the run first. */
async function handleStepForward() {
  if (!(await ensureRunStarted())) return;
  animation.stepForward();
}

/** Editing either text field invalidates the currently loaded run so the next control click re-computes it. */
function invalidateRun() {
  resetRunState({ silent: true });
}

function bindEvents() {
  refs.algorithmSelect.addEventListener('change', applyAlgorithmSelection);

  refs.modeEncrypt.addEventListener('change', () => handleModeChange('mã hóa'));
  refs.modeDecrypt.addEventListener('change', () => handleModeChange('giải mã'));

  bindSpeedSlider(refs, (rawValue) => animation.setSpeed(rawValue));

  refs.btnSimulate.addEventListener('click', async () => {
    if (!(await ensureRunStarted())) return;
    logger.log('Chạy toàn bộ mô phỏng — nhảy tới bước cuối cùng.');
    while (animation.currentStep < animation.totalSteps) {
      animation.stepForward();
    }
  });

  refs.btnStep.addEventListener('click', handleStepForward);
  refs.btnNext.addEventListener('click', handleStepForward);

  refs.btnAutorun.addEventListener('click', async () => {
    if (!(await ensureRunStarted())) return;
    animation.startAutorun();
    logger.log('Bắt đầu chạy tự động.');
  });

  refs.btnPause.addEventListener('click', () => {
    animation.pauseAutorun();
    logger.log('Đã tạm dừng mô phỏng.');
  });

  refs.btnPrev.addEventListener('click', () => {
    animation.stepBackward();
  });

  refs.btnReset.addEventListener('click', () => {
    animation.reset();
    logger.clear();
    resetRunState({ silent: true });
    logger.log('Đã đặt lại mô phỏng.');
  });

  refs.btnDownloadLog.addEventListener('click', () => {
    logger.download();
  });

  refs.btnCopyResult.addEventListener('click', async () => {
    const success = await copyResultToClipboard(refs);
    logger.log(
      success
        ? 'Đã sao chép kết quả vào bộ nhớ tạm.'
        : 'Sao chép kết quả thất bại, trình duyệt không hỗ trợ hoặc từ chối quyền truy cập.'
    );
  });

  refs.inputPrimary.addEventListener('input', invalidateRun);
  refs.inputSecondary.addEventListener('input', invalidateRun);
}

function init() {
  initTabs(refs);
  updateSpeedLabel(refs, Number(refs.speedSlider.value));
  animation.setSpeed(Number(refs.speedSlider.value));
  applyAlgorithmSelection();
  reflectPlaybackState(PlaybackState.IDLE);
  bindEvents();
  logger.log('Trình mô phỏng đã khởi tạo xong, sẵn sàng nhận lệnh.');
}

document.addEventListener('DOMContentLoaded', init);