/**
 * AddonLoader — lazy loads heavy effect modules
 */
export class AddonLoader {
  constructor(engine) {
    this._engine  = engine;
    this._loaded  = new Map();
    this._registry = {
      'volumetrics':    () => import('../addons/Volumetrics.js'),
      'ssr-reflections':() => import('../addons/SSR.js'),
      'lens-flare':     () => import('../addons/LensFlare.js'),
      'outlines':       () => import('../addons/Outlines.js'),
      'motion-blur':    () => import('../addons/MotionBlur.js'),
      'god-rays':       () => import('../addons/GodRays.js'),
      'chromatic-aberration': () => import('../addons/ChromaticAberration.js'),
    };
  }

  async load(name, options = {}) {
    if (this._loaded.has(name)) return this._loaded.get(name);
    const loader = this._registry[name];
    if (!loader) throw new Error(`[StyleShade] Unknown addon: "${name}". Available: ${Object.keys(this._registry).join(', ')}`);

    const mod = await loader();
    const addon = new mod.default(this._engine, options);
    await addon.init?.();
    this._loaded.set(name, addon);
    this._engine.emit('addon:loaded', name);
    return addon;
  }

  isLoaded(name) { return this._loaded.has(name); }
}

/**
 * DebugOverlay — real-time GPU stats HUD
 */
export class DebugOverlay {
  constructor(perfMonitor, renderGraph) {
    this._perf  = perfMonitor;
    this._graph = renderGraph;
    this._el    = null;
    this._raf   = null;
  }

  mount() {
    this._el = document.createElement('div');
    Object.assign(this._el.style, {
      position:       'fixed',
      top:            '12px',
      right:          '12px',
      background:     'rgba(0,0,0,0.75)',
      color:          '#00ff88',
      fontFamily:     'monospace',
      fontSize:       '11px',
      padding:        '10px 14px',
      borderRadius:   '6px',
      zIndex:         '99999',
      backdropFilter: 'blur(8px)',
      border:         '1px solid rgba(0,255,136,0.2)',
      lineHeight:     '1.7',
      minWidth:       '180px',
      pointerEvents:  'none',
    });
    this._el.id = '__styleshade_debug';
    document.body.appendChild(this._el);

    this._perf.on('frame', () => this._update());
  }

  unmount() {
    this._el?.remove();
    cancelAnimationFrame(this._raf);
  }

  _update() {
    if (!this._el) return;
    const s = this._perf.getSnapshot();
    const health = this._perf.getHealth();
    const color = health > 0.8 ? '#00ff88' : health > 0.5 ? '#ffcc00' : '#ff4444';
    this._el.style.color = color;
    this._el.innerHTML = [
      `<b>StyleShade Debug</b>`,
      `─────────────────`,
      `FPS:       ${s.fps}`,
      `Frame:     ${s.frameTimeMS} ms`,
      `GPU:       ${s.gpuTimeMS} ms`,
      `Draws:     ${s.drawCalls}`,
      `Tris:      ${(s.triangles/1000).toFixed(1)}k`,
      `Tier:      ${s.tier.toUpperCase()}`,
      `Target:    ${s.targetFPS} fps`,
    ].join('<br>');
  }
}

/**
 * EventEmitter — tiny typed event bus
 */
export class EventEmitter {
  constructor() { this._listeners = new Map(); }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const arr = this._listeners.get(event);
    if (arr) this._listeners.set(event, arr.filter(f => f !== fn));
  }

  emit(event, ...args) {
    this._listeners.get(event)?.forEach(fn => fn(...args));
  }

  once(event, fn) {
    const unsub = this.on(event, (...args) => { fn(...args); unsub(); });
  }
}
