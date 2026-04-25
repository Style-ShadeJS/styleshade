/**
 * PerformanceMonitor
 * 
 * Tracks frame timing, GPU budget, and automatically
 * scales quality tier to maintain target FPS.
 * 
 * Uses an exponential moving average for stability
 * to prevent thrashing between tiers.
 */

import { EventEmitter } from '../utils/EventEmitter.js';

const TIER_ORDER = ['ultra', 'high', 'medium', 'low'];
const HYSTERESIS_UP   = 1500; // ms stable before upgrading
const HYSTERESIS_DOWN = 500;  // ms before downgrading (faster)

export class PerformanceMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    this._targetFPS     = config.targetFPS     ?? 60;
    this._gpuBudgetMS   = config.gpuBudgetMS   ?? 12;
    this._stabilityBias = config.stabilityBias ?? 0.8;
    this._auto          = config.auto          ?? true;

    this._fps         = 60;
    this._frameTimeMS = 16.67;
    this._gpuTimeMS   = 0;
    this._drawCalls   = 0;
    this._triangles   = 0;
    this._currentTier = 'high';

    this._frameTimes  = new Float32Array(120); // ring buffer
    this._frameHead   = 0;
    this._lastFrame   = 0;
    this._running     = false;
    this._rafHandle   = null;

    this._stableHighSince = 0;
    this._stableLowSince  = 0;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._running = true;
    this._lastFrame = performance.now();
    this._tick();
  }

  stop() {
    this._running = false;
    if (this._rafHandle) cancelAnimationFrame(this._rafHandle);
  }

  // ── Per-Frame Update (called by engine) ───────────────────────────────────

  beginFrame() {
    this._frameStart = performance.now();
  }

  endFrame(metadata = {}) {
    const now = performance.now();
    const dt  = now - this._frameStart;

    // Ring buffer
    this._frameTimes[this._frameHead % 120] = dt;
    this._frameHead++;

    // EMA for smoothness
    this._frameTimeMS = this._frameTimeMS * 0.9 + dt * 0.1;
    this._fps         = 1000 / this._frameTimeMS;
    this._drawCalls   = metadata.drawCalls  ?? this._drawCalls;
    this._triangles   = metadata.triangles  ?? this._triangles;
    this._gpuTimeMS   = metadata.gpuTimeMS  ?? this._frameTimeMS * 0.7;

    if (this._auto) this._autoScale(now);
  }

  // ── Auto Quality Scaling ──────────────────────────────────────────────────

  _autoScale(now) {
    const targetDT  = 1000 / (this._targetFPS * this._stabilityBias);
    const critical  = 1000 / (this._targetFPS * 0.5);
    const tidx      = TIER_ORDER.indexOf(this._currentTier);

    if (this._frameTimeMS > critical) {
      // Immediate downgrade — we're dropping hard
      if (tidx < TIER_ORDER.length - 1) {
        this._changeTier(TIER_ORDER[tidx + 1]);
        this._stableLowSince = now;
        this._stableHighSince = 0;
      }
    } else if (this._frameTimeMS > targetDT) {
      // Gradual downgrade
      if (!this._stableLowSince) this._stableLowSince = now;
      if (now - this._stableLowSince > HYSTERESIS_DOWN && tidx < TIER_ORDER.length - 1) {
        this._changeTier(TIER_ORDER[tidx + 1]);
        this._stableLowSince = now;
        this._stableHighSince = 0;
      }
    } else {
      // Performing well — try upgrading after hysteresis
      this._stableLowSince = 0;
      if (!this._stableHighSince) this._stableHighSince = now;
      if (now - this._stableHighSince > HYSTERESIS_UP && tidx > 0) {
        this._changeTier(TIER_ORDER[tidx - 1]);
        this._stableHighSince = now;
      }
    }
  }

  _changeTier(tier) {
    if (tier === this._currentTier) return;
    this._currentTier = tier;
    this.emit('tier:change', tier);
  }

  // ── RAF loop (for monitoring when not driven by engine) ───────────────────

  _tick() {
    if (!this._running) return;
    const now = performance.now();
    const dt  = now - this._lastFrame;
    this._lastFrame = now;

    this._frameTimes[this._frameHead % 120] = dt;
    this._frameHead++;
    this._frameTimeMS = this._frameTimeMS * 0.95 + dt * 0.05;
    this._fps         = 1000 / this._frameTimeMS;

    if (this._auto) this._autoScale(now);
    this.emit('frame', this.getSnapshot());

    this._rafHandle = requestAnimationFrame(() => this._tick());
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────

  getSnapshot() {
    return {
      fps:         Math.round(this._fps),
      frameTimeMS: +this._frameTimeMS.toFixed(2),
      gpuTimeMS:   +this._gpuTimeMS.toFixed(2),
      drawCalls:   this._drawCalls,
      triangles:   this._triangles,
      tier:        this._currentTier,
      targetFPS:   this._targetFPS,
    };
  }

  /**
   * Returns a 0-1 "health" score (1 = perfect, 0 = tanking).
   */
  getHealth() {
    const target = 1000 / this._targetFPS;
    return Math.max(0, Math.min(1, target / this._frameTimeMS));
  }
}
