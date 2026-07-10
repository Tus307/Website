// utils.js — Generic, framework-agnostic helper functions.
// No DOM ownership, no app state: pure functions only.

/**
 * Clamp a number between a minimum and maximum value.
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Shorthand for document.querySelector.
 */
export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

/**
 * Shorthand for document.querySelectorAll, returned as a real array.
 */
export function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

/**
 * Format elapsed milliseconds as mm:ss.cc for logger timestamps.
 */
export function formatElapsed(ms) {
  const totalCentiseconds = Math.floor(ms / 10);
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}

/**
 * Map the speed slider's raw integer value (1–10) to a human-readable
 * multiplier label shown next to the slider (e.g. "1.0×").
 */
export function speedToLabel(rawValue) {
  const multiplier = (rawValue / 4).toFixed(1);
  return `${multiplier}×`;
}

/**
 * Trigger a browser download of a text blob.
 */
export function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Copy a string to the clipboard, resolving true/false for success.
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    return false;
  }
}