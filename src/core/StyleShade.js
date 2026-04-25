/**
 * StyleShade - High-Performance Web Shader System
 * Core Engine v1.0.0
 * 
 * Architecture: Vulkan-inspired explicit GPU pipeline on WebGPU,
 * with automatic WebGL2 fallback. Adapter pattern for Three.js,
 * Babylon.js, and raw contexts.
 */

import { CapabilityDetector } from './CapabilityDetector.js';
import { RenderGraph } from './RenderGraph.js';
import { ShaderCompiler } from './ShaderCompiler.js';
import { PerformanceMonitor } from './PerformanceMonitor.js';
import { MaterialSystem } from './MaterialSystem.js';
import { AddonLoader } from './AddonLoader.js';
import { DebugOverlay } from './DebugOverlay.js';
import { ThreeAdapter } from '../adapters/ThreeAdapter.js';
import { BabylonAdapter } from '../adapters/BabylonAdapter.js';
import { RawWebGPUAdapter } from '../adapters/RawWebGPUAdapter.js';
import { EventEmitter } from '../utils/EventEmitter.js';

const VERSION = '1.0.0';

const PRESETS = {
  cinematic: {
    ssao: { samples: 16, radius: 0.5, bias: 0.025 },
    bloom: { threshold: 0.8, strength: 1.2, radius: 0.4 },
    shadows: 'pcss',
    volumetric: true,
    reflections: 'ssr',
    toneMapping: 'aces',
    colorGrading: true,
    dof: true,
    motionBlur: true,
    ambientLight: 0.15,
  },
  realistic: {
    ssao: { samples: 12, radius: 0.4, bias: 0.02 },
    bloom: { threshold: 0.9, strength: 0.8, radius: 0.3 },
    shadows: 'pcf',
    volumetric: false,
    reflections: 'cubemap',
    toneMapping: 'filmic',
    colorGrading: true,
    dof: false,
    motionBlur: false,
    ambientLight: 0.2,
  },
  stylized: {
    ssao: { samples: 8, radius: 0.6, bias: 0.03 },
    bloom: { threshold: 0.7, strength: 1.8, radius: 0.6 },
    shadows: 'pcf',
    volumetric: false,
    reflections: 'none',
    toneMapping: 'reinhard',
    colorGrading: true,
    outlines: true,
    dof: false,
    motionBlur: false,
    ambientLight: 0.3,
  },
  performance: {
    ssao: false,
    bloom: { threshold: 0.95, strength: 0.4, radius: 0.2 },
    shadows: 'basic',
    volumetric: false,
    reflections: 'none',
    toneMapping: 'linear',
    colorGrading: false,
    dof: false,
    motionBlur: false,
    ambientLight: 0.4,
  },
};

const QUALITY_TIERS = {
  ultra:   { ssaoSamples: 16, shadowMapSize: 4096, bloomRes: 1.0, lodBias: 0.0 },
  high:    { ssaoSamples: 8,  shadowMapSize: 2048, bloomRes: 0.75, lodBias: 0.5 },
  medium:  { ssaoSamples: 4,  shadowMapSize: 1024, bloomRes: 0.5, lodBias: 1.0 },
  low:     { ssaoSamples: 0,  shadowMapSize: 512,  bloomRes: 0.25, lodBias: 2.0 },
};

class StyleShadeEngine extends EventEmitter {
  constructor() {
    super();
    this._initialized = false;
    this._config = null;
    this._adapter = null;
    this._renderGraph = null;
    this._shaderCompiler = null;
    this._perfMonitor = null;
    this._materialSystem = null;
    this._addonLoader = null;
    this._debugOverlay = null;
    this._canvas = null;
    this._gpuDevice = null;
    this._backend = null; // 'webgpu' | 'webgl2'
    this._qualityTier = 'high';
    this._activeFeatures = new Set();
    this._frameCallbacks = [];
    this._shaderExtensions = { vertex: [], fragment: [] };
    this._hotReloadEnabled = false;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Primary initialization entry point.
   * Detects capabilities, configures the pipeline, and hooks into the engine.
   */
  async init(config = {}) {
    if (this._initialized) {
      console.warn('[StyleShade] Already initialized. Call destroy() first.');
      return this;
    }

    this._config = this._resolveConfig(config);
    this.emit('init:start', this._config);

    // 1. Detect GPU capabilities
    const caps = await CapabilityDetector.detect();
    this._caps = caps;
    this.emit('capabilities', caps);

    // 2. Choose backend
    this._backend = this._selectBackend(caps);
    console.info(`[StyleShade v${VERSION}] Backend: ${this._backend.toUpperCase()} | Tier: ${this._qualityTier}`);

    // 3. Acquire GPU device
    if (this._backend === 'webgpu') {
      this._gpuDevice = await this._acquireWebGPUDevice(caps);
    }

    // 4. Init subsystems
    this._shaderCompiler = new ShaderCompiler(this._backend, this._config);
    this._perfMonitor = new PerformanceMonitor(this._config.performance);
    this._materialSystem = new MaterialSystem(this._shaderCompiler, this._config);
    this._addonLoader = new AddonLoader(this);
    this._renderGraph = new RenderGraph(this._backend, this._gpuDevice, this._config);

    // 5. Start perf monitoring loop
    this._perfMonitor.on('tier:change', (tier) => this._onQualityTierChange(tier));
    this._perfMonitor.start();

    // 6. Hot reload (dev only)
    if (this._config.debug?.hotReload) {
      this._enableHotReload();
    }

    // 7. Debug overlay
    if (this._config.debug?.overlay) {
      this._debugOverlay = new DebugOverlay(this._perfMonitor, this._renderGraph);
      this._debugOverlay.mount();
    }

    this._initialized = true;
    this.emit('ready', { backend: this._backend, tier: this._qualityTier, caps });
    return this;
  }

  /**
   * Attach StyleShade to an existing 3D engine instance.
   */
  async attach(options = {}) {
    const { engine, scene, renderer, camera, canvas } = options;

    if (!this._initialized) {
      await this.init({ mode: 'auto', ...options });
    }

    this._canvas = canvas || renderer?.domElement;

    const engineType = options.engine || this._detectEngine(renderer, scene);
    this._adapter = this._createAdapter(engineType, { scene, renderer, camera });
    this._adapter.install(this._renderGraph, this._materialSystem);

    this.emit('attached', { engine: engineType });
    return this;
  }

  /**
   * Create a PBR-capable material with StyleShade features baked in.
   */
  createMaterial(config = {}) {
    this._assertInitialized();
    return this._materialSystem.create({
      lighting: config.lighting || 'pbr',
      shadows: config.shadows || this._config.features?.shadows || 'pcf',
      ao: config.ao || (this._activeFeatures.has('ssao') ? 'ssao' : 'none'),
      ...config,
    });
  }

  /**
   * Inject custom GLSL/WGSL into the render pipeline.
   */
  extendShader(extensions = {}) {
    this._assertInitialized();
    if (extensions.vertex)   this._shaderExtensions.vertex.push(extensions.vertex);
    if (extensions.fragment) this._shaderExtensions.fragment.push(extensions.fragment);
    this._shaderCompiler.invalidateCache();
    this.emit('shader:extended', extensions);
    return this;
  }

  /**
   * Load a named addon (volumetrics, ssr-reflections, etc.)
   */
  async loadAddon(name, options = {}) {
    this._assertInitialized();
    return this._addonLoader.load(name, options);
  }

  /**
   * Apply a named quality preset.
   */
  applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) throw new Error(`[StyleShade] Unknown preset: "${name}". Valid: ${Object.keys(PRESETS).join(', ')}`);
    this._applyFeatureSet(preset);
    this.emit('preset:applied', name);
    return this;
  }

  /**
   * Force a specific quality tier (overrides auto).
   */
  setQuality(tier) {
    const valid = Object.keys(QUALITY_TIERS);
    if (!valid.includes(tier)) throw new Error(`[StyleShade] Unknown tier: "${tier}". Valid: ${valid.join(', ')}`);
    this._qualityTier = tier;
    this._applyTier(tier);
    this.emit('quality:set', tier);
    return this;
  }

  /**
   * Register a per-frame callback (called after render graph resolves).
   */
  onFrame(callback) {
    this._frameCallbacks.push(callback);
    return () => { this._frameCallbacks = this._frameCallbacks.filter(c => c !== callback); };
  }

  /**
   * Get current performance metrics snapshot.
   */
  getMetrics() {
    return this._perfMonitor?.getSnapshot() ?? null;
  }

  /**
   * Full teardown.
   */
  destroy() {
    this._perfMonitor?.stop();
    this._debugOverlay?.unmount();
    this._adapter?.uninstall();
    this._renderGraph?.destroy();
    this._gpuDevice?.destroy();
    this._initialized = false;
    this.emit('destroyed');
  }

  // ─── Config Resolution ─────────────────────────────────────────────────────

  _resolveConfig(raw) {
    const mode = raw.mode || 'auto';
    let preset = raw.preset || 'cinematic';
    let quality = raw.quality || 'auto';

    // In auto mode, detect quality from hardware
    if (quality === 'auto') {
      quality = this._estimateQuality();
    }
    this._qualityTier = quality === 'auto' ? 'high' : quality;

    const presetConfig = PRESETS[preset] || PRESETS.cinematic;
    const tierConfig = QUALITY_TIERS[this._qualityTier] || QUALITY_TIERS.high;

    return {
      mode,
      preset,
      quality: this._qualityTier,
      renderer: raw.renderer || 'webgpu',
      features: {
        lighting: raw.features?.lighting || 'forward+',
        shadows: presetConfig.shadows,
        ssao: presetConfig.ssao,
        bloom: presetConfig.bloom,
        volumetric: presetConfig.volumetric ?? false,
        reflections: presetConfig.reflections || 'none',
        toneMapping: presetConfig.toneMapping || 'aces',
        colorGrading: presetConfig.colorGrading ?? true,
        dof: presetConfig.dof ?? false,
        motionBlur: presetConfig.motionBlur ?? false,
        ...raw.features,
      },
      tier: tierConfig,
      performance: {
        auto: true,
        targetFPS: raw.performance?.targetFPS || 60,
        stabilityBias: raw.performance?.stabilityBias || 0.8,
        gpuBudgetMS: raw.performance?.gpuBudgetMS || 12,
        dynamicResolution: raw.performance?.dynamicResolution ?? true,
        ...raw.performance,
      },
      debug: {
        overlay: raw.debug?.overlay || false,
        hotReload: raw.debug?.hotReload || false,
        drawCalls: raw.debug?.drawCalls || false,
        gpuTimestamps: raw.debug?.gpuTimestamps || false,
        ...raw.debug,
      },
      _raw: raw,
    };
  }

  _estimateQuality() {
    // Heuristic before full caps detection
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    if (cores >= 8 && mem >= 8) return 'ultra';
    if (cores >= 4 && mem >= 4) return 'high';
    if (cores >= 2 && mem >= 2) return 'medium';
    return 'low';
  }

  // ─── Backend Selection ─────────────────────────────────────────────────────

  _selectBackend(caps) {
    const requested = this._config.renderer;
    if (requested === 'webgpu' && caps.webgpu) return 'webgpu';
    if (requested === 'webgl2' && caps.webgl2) return 'webgl2';
    if (caps.webgpu) return 'webgpu';
    if (caps.webgl2) return 'webgl2';
    throw new Error('[StyleShade] Neither WebGPU nor WebGL2 is available in this environment.');
  }

  async _acquireWebGPUDevice(caps) {
    if (!navigator.gpu) throw new Error('[StyleShade] WebGPU not available.');
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) throw new Error('[StyleShade] Failed to get WebGPU adapter.');

    const requiredFeatures = [];
    if (adapter.features.has('timestamp-query') && this._config.debug?.gpuTimestamps) {
      requiredFeatures.push('timestamp-query');
    }
    if (adapter.features.has('texture-compression-bc')) {
      requiredFeatures.push('texture-compression-bc');
    }

    const device = await adapter.requestDevice({
      requiredFeatures,
      requiredLimits: {
        maxTextureDimension2D: Math.min(adapter.limits.maxTextureDimension2D, 8192),
        maxBindGroups: adapter.limits.maxBindGroups,
      },
    });

    device.lost.then((info) => {
      console.error('[StyleShade] WebGPU device lost:', info.reason, info.message);
      this.emit('device:lost', info);
    });

    return device;
  }

  // ─── Adapter Factory ───────────────────────────────────────────────────────

  _detectEngine(renderer, scene) {
    if (renderer?.isWebGLRenderer || renderer?.xr) return 'three';
    if (scene?.getEngine || renderer?.getRenderingCanvas) return 'babylon';
    return 'raw';
  }

  _createAdapter(type, opts) {
    switch (type) {
      case 'three':   return new ThreeAdapter(opts, this._backend, this._config);
      case 'babylon': return new BabylonAdapter(opts, this._backend, this._config);
      default:        return new RawWebGPUAdapter(opts, this._backend, this._config);
    }
  }

  // ─── Quality & Feature Management ─────────────────────────────────────────

  _applyFeatureSet(preset) {
    this._config.features = { ...this._config.features, ...preset };
    this._renderGraph?.rebuildPasses(this._config.features);
  }

  _applyTier(tier) {
    const t = QUALITY_TIERS[tier];
    this._config.tier = t;
    this._renderGraph?.applyTier(t);
    this.emit('tier:applied', tier);
  }

  _onQualityTierChange(newTier) {
    console.info(`[StyleShade] Auto-scaling quality: ${this._qualityTier} → ${newTier}`);
    this._qualityTier = newTier;
    this._applyTier(newTier);
  }

  // ─── Hot Reload ────────────────────────────────────────────────────────────

  _enableHotReload() {
    this._hotReloadEnabled = true;
    console.info('[StyleShade] Hot reload enabled.');
    // In a real build tool integration (Vite/Webpack HMR) you'd hook
    // into import.meta.hot here. For now we expose a manual trigger.
    window.__StyleShade_reload = () => {
      this._shaderCompiler.invalidateCache();
      this._renderGraph?.rebuildPasses(this._config.features);
      this.emit('hot:reload');
    };
  }

  // ─── Guards ────────────────────────────────────────────────────────────────

  _assertInitialized() {
    if (!this._initialized) {
      throw new Error('[StyleShade] Not initialized. Call StyleShade.init() first.');
    }
  }

  // ─── Static Info ───────────────────────────────────────────────────────────

  static get version() { return VERSION; }
  static get presets() { return Object.keys(PRESETS); }
  static get qualityTiers() { return Object.keys(QUALITY_TIERS); }
}

// Singleton export
export const StyleShade = new StyleShadeEngine();
export { StyleShadeEngine, PRESETS, QUALITY_TIERS, VERSION };
