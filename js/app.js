// app.js — Application entry point. Wires DOM events to the ui,
// logger, animation, and algorithm-manager modules.
//
// Bitwise text-vs-text algorithms (XOR/AND/OR) are fully implemented via
// algorithmManager (see algorithms.js). This file is responsible for:
//   - Validating input and triggering algorithmManager.run(...)
//   - Driving the AnimationController through the resulting step list
//   - Rendering each step (ASCII → Binary → Bit-by-bit → Output) into
//     #visualization-canvas, with the active bit highlighted
// Other algorithms (caesar/vigenere/aes/rsa/sha256/base64) remain
// unimplemented placeholders; attempting to run them surfaces a clear
// Vietnamese error via toast instead of crashing.

import * as ui from './ui.js';
import { Logger } from './logger.js';
import { AnimationController, PlaybackState } from './animation.js';
import { algorithmManager } from './algorithm.js';

const refs = ui.getDomRefs();
const logger = new Logger(refs.loggerOutput);

algorithmManager.attachLogger(logger);

/** @type {{ id: string, mode: string, steps: Array, result: string, binaryByChar: Map<number, object> } | null} */
let activeRun = null;

const animation = new AnimationController({
  onStepChange: (step, total) => {
    ui.updateProgress(refs, step, total);
    ui.highlightTimelineStep(refs, step);
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

function reflectPlaybackState(state) {
  ui.setStatus(refs, STATE_KEYS[state], STATE_LABELS[state]);
  refs.btnPause.disabled = state !== PlaybackState.RUNNING;
  refs.btnAutorun.disabled = state === PlaybackState.RUNNING;
}

function currentMode() {
  return refs.modeDecrypt.checked ? 'decrypt' : 'encrypt';
}

function applyAlgorithmSelection() {
  const meta = algorithmManager.get(refs.algorithmSelect.value);
  if (!meta) return;

  ui.setAlgorithmTag(refs, meta.label);
  ui.setExplanation(refs, meta.explanation);
  ui.toggleSecondaryInput(refs, meta.requiresKey, meta.keyHint);
  logger.log(`Đã chọn thuật toán: ${meta.label}.`);
  resetRunState({ silent: true });
}

/**
 * Clear whatever algorithm run is currently loaded (steps/result), reset
 * the animation controller to zero, and restore the canvas/result panels
 * to their placeholder state. Does not clear the log unless requested by
 * the caller separately (see btnReset handler).
 */
function resetRunState({ silent = false } = {}) {
  activeRun = null;
  animation.setTotalSteps(0);
  refs.visualizationCanvas.innerHTML = CANVAS_PLACEHOLDER;
  refs.resultOutput.innerHTML = RESULT_PLACEHOLDER;
  if (!silent) logger.log('Đã đặt lại trạng thái mô phỏng.');
}

/**
 * Lazily run the currently-selected algorithm against the current inputs
 * if it hasn't been run yet. Validates the key/second-text requirement
 * and surfaces any error as a toast + log entry rather than throwing.
 * Async because algorithmManager.run() may await a Promise-based execute()
 * (e.g. SHA-256 via Web Crypto's crypto.subtle.digest).
 * @returns {Promise<boolean>} true if a run is loaded and ready to step through.
 */
let runInFlight = false;

async function ensureRunStarted() {
  if (activeRun) return true;
  if (runInFlight) return false;

  const id = refs.algorithmSelect.value;
  const meta = algorithmManager.get(id);
  if (!meta) {
    ui.showToast('Không tìm thấy thuật toán được chọn.', 'error');
    return false;
  }

  const input = refs.inputPrimary.value;
  const key = refs.inputSecondary.value;
  const mode = currentMode();

  if (meta.requiresKey && !key) {
    ui.showToast(
      `Thuật toán "${meta.label}" yêu cầu ${meta.keyHint || 'khóa/tham số thứ hai'}.`,
      'error'
    );
    return false;
  }

  if (!meta.isImplemented) {
    ui.showToast(`Thuật toán "${meta.label}" chưa được triển khai logic thực thi.`, 'error');
    return false;
  }

  runInFlight = true;
  try {
    const { steps, result } = await algorithmManager.run(id, { mode, input, key });

    const binaryByChar = new Map();
    steps.forEach((step) => {
      if (step.type === 'binary') binaryByChar.set(step.charIndex, step);
    });

    activeRun = { id, mode, steps, result, binaryByChar };
    ui.setResult(refs, result);
    return true;
  } catch (error) {
    ui.showToast(error.message, 'error');
    return false;
  } finally {
    runInFlight = false;
  }
}

/* =========================================================
   VISUALIZATION RENDERING
   Renders the current step (ASCII / Binary / Bit-by-bit / Output)
   into #visualization-canvas. Styling is injected once at runtime,
   the same pattern ui.js already uses — style.css itself is never
   touched.
   ========================================================= */

let bwvStylesInjected = false;

function injectBitwiseVisualStyles() {
  if (bwvStylesInjected) return;
  bwvStylesInjected = true;

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

    /* ---- MD5 visualizer ---- */
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

function renderNoticeCard(step) {
  return `
    <div class="bwv-card bwv-card--notice">
      <div class="bwv-card-title">Lưu ý</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
    </div>
  `;
}

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

/* ---- MD5 render helpers ---- */

function renderMd5NoticeCard(step, title) {
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">${escapeHtml(title)}</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
    </div>
  `;
}

function renderMd5BlocksCard(step) {
  const items = step.data.blockHexes
    .map((hex, idx) => {
      const grouped = hex.match(/.{1,8}/g).join(' ');
      return `<div class="md5-block-row"><span class="md5-block-label">Khối ${idx + 1}</span><span class="md5-block-hex">${grouped}</span></div>`;
    })
    .join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">${step.data.blockCount} khối 512-bit</div>
      <div class="md5-block-list">${items}</div>
    </div>
  `;
}

function renderMd5BuffersCard(step) {
  const regs = ['A', 'B', 'C', 'D'];
  const cols = regs
    .map(
      (r) => `
      <div class="md5-reg md5-reg--${r.toLowerCase()}">
        <span class="md5-reg-label">${r}</span>
        <span class="md5-reg-val">0x${step.data[r].toUpperCase()}</span>
      </div>
    `
    )
    .join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Khởi tạo thanh ghi (buffer)</div>
      <div class="md5-reg-row">${cols}</div>
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

function renderMd5DigestCard(step) {
  const hex = extractDigestFromResult(activeRun ? activeRun.result : '');
  return `
    <div class="bwv-card bwv-card--output">
      <div class="bwv-card-title">Digest MD5 (128-bit)</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
      <div class="md5-digest-hex">${escapeHtml(hex)}</div>
    </div>
  `;
}

/* ---- SHA-256 render helpers ---- */

function renderSha256ScheduleCard(step) {
  const words = step.data.w0to15
    .map(
      (w, idx) =>
        `<div class="md5-block-row"><span class="md5-block-label">W[${idx}]</span><span class="md5-block-hex">${w}</span></div>`
    )
    .join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Lịch trình thông điệp — W[0..15]</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
      <div class="md5-block-list">${words}</div>
    </div>
  `;
}

function renderSha256CompressionCard(step) {
  const regs = step.data.hInit
    .map(
      (h, idx) => `
      <div class="md5-reg md5-reg--${['a', 'b', 'c', 'd'][idx % 4]}">
        <span class="md5-reg-label">H${idx}</span>
        <span class="md5-reg-val">0x${h.toUpperCase()}</span>
      </div>
    `
    )
    .join('');
  return `
    <div class="bwv-card">
      <div class="bwv-card-title">Vòng nén (64 vòng)</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
      <div class="md5-reg-row">${regs}</div>
    </div>
  `;
}

function renderSha256DigestCard(step) {
  const hex = extractDigestFromResult(activeRun ? activeRun.result : '');
  return `
    <div class="bwv-card bwv-card--output">
      <div class="bwv-card-title">Digest SHA-256 (256-bit)</div>
      <div class="bwv-card-body">${escapeHtml(step.description)}</div>
      <div class="md5-digest-hex">${escapeHtml(hex)}</div>
    </div>
  `;
}

/**
 * Render the visualization canvas for the given 1-indexed step number
 * (0 or no active run ⇒ placeholder).
 */
function renderVisualization(stepNumber) {
  injectBitwiseVisualStyles();

  if (!activeRun || stepNumber <= 0) {
    refs.visualizationCanvas.innerHTML = CANVAS_PLACEHOLDER;
    return;
  }

  const step = activeRun.steps[stepNumber - 1];
  if (!step) return;

  switch (step.type) {
    case 'notice':
      refs.visualizationCanvas.innerHTML = renderNoticeCard(step);
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
    case 'md5-input':
      refs.visualizationCanvas.innerHTML = renderMd5NoticeCard(step, 'Đầu vào');
      break;
    case 'md5-padding':
      refs.visualizationCanvas.innerHTML = renderMd5NoticeCard(step, 'Đệm dữ liệu (padding)');
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
      refs.visualizationCanvas.innerHTML = renderMd5DigestCard(step);
      break;
    case 'sha256-input':
      refs.visualizationCanvas.innerHTML = renderMd5NoticeCard(step, 'Đầu vào');
      break;
    case 'sha256-padding':
      refs.visualizationCanvas.innerHTML = renderMd5NoticeCard(step, 'Đệm dữ liệu (padding)');
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
      refs.visualizationCanvas.innerHTML = renderSha256DigestCard(step);
      break;
    default:
      refs.visualizationCanvas.textContent = step.description || '';
  }
}

/* =========================================================
   EVENTS
   ========================================================= */

function bindEvents() {
  refs.algorithmSelect.addEventListener('change', applyAlgorithmSelection);

  refs.modeEncrypt.addEventListener('change', () => {
    logger.log('Chuyển sang chế độ mã hóa.');
    resetRunState({ silent: true });
  });
  refs.modeDecrypt.addEventListener('change', () => {
    logger.log('Chuyển sang chế độ giải mã.');
    resetRunState({ silent: true });
  });

  refs.speedSlider.addEventListener('input', (event) => {
    const rawValue = Number(event.target.value);
    ui.updateSpeedLabel(refs, rawValue);
    animation.setSpeed(rawValue);
  });

  refs.btnSimulate.addEventListener('click', async () => {
    if (!(await ensureRunStarted())) return;
    logger.log('Chạy toàn bộ mô phỏng — nhảy tới bước cuối cùng.');
    while (animation.currentStep < animation.totalSteps) {
      animation.stepForward();
    }
  });

  refs.btnStep.addEventListener('click', async () => {
    if (!(await ensureRunStarted())) return;
    animation.stepForward();
  });

  refs.btnAutorun.addEventListener('click', async () => {
    if (!(await ensureRunStarted())) return;
    animation.startAutorun();
    logger.log('Bắt đầu chạy tự động.');
  });

  refs.btnPause.addEventListener('click', () => {
    animation.pauseAutorun();
    logger.log('Đã tạm dừng mô phỏng.');
  });

  refs.btnNext.addEventListener('click', async () => {
    if (!(await ensureRunStarted())) return;
    animation.stepForward();
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
    const success = await ui.copyResultToClipboard(refs);
    logger.log(
      success
        ? 'Đã sao chép kết quả vào bộ nhớ tạm.'
        : 'Sao chép kết quả thất bại, trình duyệt không hỗ trợ hoặc từ chối quyền truy cập.'
    );
  });

  // Editing either text field invalidates the currently loaded run so the
  // next control click re-computes steps against the fresh input.
  refs.inputPrimary.addEventListener('input', () => resetRunState({ silent: true }));
  refs.inputSecondary.addEventListener('input', () => resetRunState({ silent: true }));
}

function init() {
  ui.initTabs(refs);
  ui.updateSpeedLabel(refs, Number(refs.speedSlider.value));
  animation.setSpeed(Number(refs.speedSlider.value));
  applyAlgorithmSelection();
  reflectPlaybackState(PlaybackState.IDLE);
  bindEvents();
  logger.log('Trình mô phỏng đã khởi tạo xong, sẵn sàng nhận lệnh.');
}

document.addEventListener('DOMContentLoaded', init);