// animation.js — Generic step/playback state machine for the
// simulation. Knows how to move between step indices and manage
// autorun timing. Knows nothing about what a "step" actually computes;


export const PlaybackState = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  FINISHED: 'finished',
});

export class AnimationController {
  /**
   * @param {object} hooks
   * @param {(step: number, total: number) => void} hooks.onStepChange
   * @param {(state: string) => void} hooks.onStateChange
   */
  constructor({ onStepChange, onStateChange } = {}) {
    this.onStepChange = onStepChange || (() => {});
    this.onStateChange = onStateChange || (() => {});

    this.currentStep = 0;
    this.totalSteps = 0;
    this.state = PlaybackState.IDLE;
    this.intervalMs = 1000;
    this._timerId = null;
  }

  /**
   * Configure how many steps this run will contain and reset position.
   */
  setTotalSteps(total) {
    this.totalSteps = total;
    this.currentStep = 0;
    this._setState(PlaybackState.IDLE);
    this.onStepChange(this.currentStep, this.totalSteps);
  }

  /**
   * Convert the speed slider's raw value (1–10) into a millisecond
   * autorun interval. Higher raw value = faster = shorter interval.
   */
  setSpeed(rawValue) {
    const minInterval = 150;
    const maxInterval = 1500;
    const ratio = (10 - rawValue) / 9;
    this.intervalMs = Math.round(minInterval + ratio * (maxInterval - minInterval));
    if (this.state === PlaybackState.RUNNING) {
      this._restartTimer();
    }
  }

  stepForward() {
    if (this.currentStep >= this.totalSteps) return;
    this.currentStep += 1;
    this.onStepChange(this.currentStep, this.totalSteps);
    if (this.currentStep >= this.totalSteps) {
      this.stopAutorun();
      this._setState(PlaybackState.FINISHED);
    }
  }

  stepBackward() {
    if (this.currentStep <= 0) return;
    this.currentStep -= 1;
    this.onStepChange(this.currentStep, this.totalSteps);
    if (this.state === PlaybackState.FINISHED) {
      this._setState(PlaybackState.PAUSED);
    }
  }

  startAutorun() {
    if (this.totalSteps === 0 || this.currentStep >= this.totalSteps) return;
    this._setState(PlaybackState.RUNNING);
    this._restartTimer();
  }

  pauseAutorun() {
    this._clearTimer();
    if (this.state === PlaybackState.RUNNING) {
      this._setState(PlaybackState.PAUSED);
    }
  }

  stopAutorun() {
    this._clearTimer();
  }

  reset() {
    this._clearTimer();
    this.currentStep = 0;
    this._setState(PlaybackState.IDLE);
    this.onStepChange(this.currentStep, this.totalSteps);
  }

  _restartTimer() {
    this._clearTimer();
    this._timerId = setInterval(() => this.stepForward(), this.intervalMs);
  }

  _clearTimer() {
    if (this._timerId !== null) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
  }

  _setState(state) {
    this.state = state;
    this.onStateChange(state);
  }
}