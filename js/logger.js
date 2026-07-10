// logger.js — Execution log panel. Single responsibility: recording,
// numbering, rendering, and exporting timestamped Vietnamese log
// messages. Exposes a small, clean API for other modules (app.js,
// animation.js, ui.js) to call into — it owns no algorithm or
// playback logic itself.

import { formatElapsed, downloadTextFile } from './utils.js';

export class Logger {
  /**
   * @param {HTMLElement} outputElement - the <pre id="logger-output"> panel.
   */
  constructor(outputElement) {
    this.outputElement = outputElement;
    this.entries = [];
    this.stepCounter = 0;
    this.startTime = performance.now();
  }

  /**
   * Record a plain log entry (no step number) and re-render the panel.
   * @param {string} message - Vietnamese message describing the event.
   * @returns {string} the formatted entry that was appended.
   */
  log(message) {
    return this._append(message);
  }

  /**
   * Record a log entry tied to an auto-incrementing step number
   * (e.g. "[00:01.20] Bước 3: Đang xử lý ký tự tiếp theo.").
   * @param {string} message - Vietnamese message describing the step.
   * @returns {string} the formatted entry that was appended.
   */
  logStep(message) {
    this.stepCounter += 1;
    return this._append(`Bước ${this.stepCounter}: ${message}`);
  }

  /**
   * Reset the log, the step counter, and the elapsed-time clock,
   * then re-render the (now empty) panel.
   */
  clear() {
    this.entries = [];
    this.stepCounter = 0;
    this.startTime = performance.now();
    this._render();
  }

  /**
   * Read-only copy of the raw formatted entries, newest last.
   * @returns {string[]}
   */
  getEntries() {
    return [...this.entries];
  }

  /**
   * Number of entries currently logged.
   */
  get count() {
    return this.entries.length;
  }

  /**
   * Join all entries into a single downloadable text blob.
   */
  toText() {
    return this.entries.join('\n');
  }

  /**
   * Trigger a browser download of the current log contents as .txt.
   * @param {string} [filename]
   */
  download(filename = 'nhat-ky-mo-phong.txt') {
    downloadTextFile(filename, this.toText());
  }

  /**
   * Build the timestamped entry string, store it, and re-render.
   * @private
   */
  _append(message) {
    const elapsed = formatElapsed(performance.now() - this.startTime);
    const entry = `[${elapsed}] ${message}`;
    this.entries.push(entry);
    this._render();
    return entry;
  }

  /**
   * Re-render the log panel and auto-scroll to the newest entry.
   * @private
   */
  _render() {
    if (!this.outputElement) return;
    this.outputElement.textContent = this.entries.join('\n');
    this.outputElement.scrollTop = this.outputElement.scrollHeight;
  }
}