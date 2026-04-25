/**
 * RenderGraph
 * Vulkan-inspired explicit render graph. Manages render passes,
 * resource dependencies, barriers, and execution ordering.
 * 
 * Supports both WebGPU (native command buffers) and WebGL2 (simulated).
 */

import { EventEmitter } from '../utils/EventEmitter.js';

// ── Pass Types ─────────────────────────────────────────────────────────────

export const PassType = {
  GEOMETRY:    'geometry',
  SHADOW:      'shadow',
  SSAO:        'ssao',
  SSAO_BLUR:   'ssao_blur',
  LIGHTING:    'lighting',
  SSR:         'ssr',
  VOLUMETRIC:  'volumetric',
  BLOOM:       'bloom',
  DOF:         'dof',
  MOTION_BLUR: 'motion_blur',
  COLOR_GRADE: 'color_grade',
  TONEMAP:     'tonemap',
  OUTLINE:     'outline',
  COMPOSITE:   'composite',
  PRESENT:     'present',
};

// ── Resource Handle ────────────────────────────────────────────────────────

class TextureResource {
  constructor(name, desc) {
    this.name = name;
    this.desc = desc; // { width, height, format, usage, mips }
    this.handle = null; // actual GPU texture
    this.transient = desc.transient ?? true;
  }
}

// ── Render Pass ────────────────────────────────────────────────────────────

class RenderPass {
  constructor(name, type) {
    this.name = name;
    this.type = type;
    this.enabled = true;
    this.reads = [];
    this.writes = [];
    this.execute = null; // (encoder, resources) => void
    this.gpuCost = 0;   // ms, measured
    this.priority = 0;
  }

  read(resource) { this.reads.push(resource); return this; }
  write(resource) { this.writes.push(resource); return this; }
  run(fn) { this.execute = fn; return this; }
}

// ── Main Render Graph ──────────────────────────────────────────────────────

export class RenderGraph extends EventEmitter {
  constructor(backend, device, config) {
    super();
    this._backend = backend;
    this._device = device;
    this._config = config;
    this._passes = new Map();
    this._resources = new Map();
    this._sortedPasses = [];
    this._compiled = false;
    this._frameCount = 0;
    this._gpuTimeBuffer = [];

    this._buildPasses(config.features);
  }

  // ── Pass Registration ────────────────────────────────────────────────────

  addPass(name, type) {
    const pass = new RenderPass(name, type);
    this._passes.set(name, pass);
    this._compiled = false;
    return pass;
  }

  addResource(name, desc) {
    const res = new TextureResource(name, desc);
    this._resources.set(name, res);
    return res;
  }

  // ── Compilation (Topology Sort + Barrier Insertion) ──────────────────────

  compile() {
    // Topological sort based on read/write dependencies
    const sorted = this._topologicalSort();
    this._sortedPasses = sorted.filter(p => p.enabled);
    this._compiled = true;
    this.emit('compiled', { passes: this._sortedPasses.map(p => p.name) });
    return this;
  }

  _topologicalSort() {
    const visited = new Set();
    const result = [];
    const visit = (pass) => {
      if (visited.has(pass.name)) return;
      visited.add(pass.name);
      // Find passes that write resources we read
      for (const dep of pass.reads) {
        for (const [, p] of this._passes) {
          if (p.writes.includes(dep) && p !== pass) visit(p);
        }
      }
      result.push(pass);
    };
    for (const [, pass] of this._passes) visit(pass);
    return result;
  }

  // ── Execution ────────────────────────────────────────────────────────────

  async execute(scene, camera) {
    if (!this._compiled) this.compile();

    this._frameCount++;

    if (this._backend === 'webgpu') {
      await this._executeWebGPU(scene, camera);
    } else {
      await this._executeWebGL2(scene, camera);
    }
  }

  async _executeWebGPU(scene, camera) {
    const encoder = this._device.createCommandEncoder({
      label: `StyleShade-Frame-${this._frameCount}`,
    });

    const resources = this._allocateTransientResources();

    for (const pass of this._sortedPasses) {
      if (!pass.enabled || !pass.execute) continue;

      const passStart = performance.now();
      try {
        await pass.execute(encoder, resources, scene, camera);
      } catch (e) {
        console.error(`[StyleShade] Pass "${pass.name}" failed:`, e);
      }
      pass.gpuCost = performance.now() - passStart;
    }

    const commandBuffer = encoder.finish();
    this._device.queue.submit([commandBuffer]);

    this._releaseTransientResources(resources);
    this.emit('frame:complete', { frameCount: this._frameCount });
  }

  async _executeWebGL2(scene, camera) {
    // WebGL2 path: sequential pass execution with FBO switching
    const resources = this._allocateWebGL2Resources();

    for (const pass of this._sortedPasses) {
      if (!pass.enabled || !pass.execute) continue;
      try {
        await pass.execute(null, resources, scene, camera);
      } catch (e) {
        console.error(`[StyleShade] Pass "${pass.name}" (GL2) failed:`, e);
      }
    }

    this._releaseWebGL2Resources(resources);
    this.emit('frame:complete', { frameCount: this._frameCount });
  }

  // ── Resource Management ──────────────────────────────────────────────────

  _allocateTransientResources() {
    const res = {};
    for (const [name, resource] of this._resources) {
      if (resource.transient && this._backend === 'webgpu' && this._device) {
        resource.handle = this._device.createTexture({
          label: name,
          size: [resource.desc.width || 1920, resource.desc.height || 1080, 1],
          format: resource.desc.format || 'rgba16float',
          usage: resource.desc.usage || (
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.STORAGE_BINDING
          ),
          mipLevelCount: resource.desc.mips || 1,
        });
      }
      res[name] = resource.handle;
    }
    return res;
  }

  _releaseTransientResources(resources) {
    for (const [name, resource] of this._resources) {
      if (resource.transient && resource.handle) {
        resource.handle.destroy?.();
        resource.handle = null;
      }
    }
  }

  _allocateWebGL2Resources() {
    // Placeholder: real implementation creates FBOs
    return {};
  }

  _releaseWebGL2Resources(resources) {}

  // ── Feature-Driven Pass Construction ────────────────────────────────────

  _buildPasses(features) {
    this._passes.clear();
    this._resources.clear();

    // Always-on resources
    const gbuffer = this.addResource('gbuffer_color',  { format: 'rgba8unorm',   transient: true });
    const gbuffer_n= this.addResource('gbuffer_normal', { format: 'rgba16float',  transient: true });
    const gbuffer_d= this.addResource('gbuffer_depth',  { format: 'depth24plus',  transient: true });
    const hdrColor = this.addResource('hdr_color',      { format: 'rgba16float',  transient: true });
    const ldrColor = this.addResource('ldr_color',      { format: 'rgba8unorm',   transient: true });

    // ── Geometry Pass
    this.addPass('geometry', PassType.GEOMETRY)
      .write(gbuffer).write(gbuffer_n).write(gbuffer_d)
      .run(this._makeGeometryPass(features));

    // ── Shadow Pass
    if (features?.shadows && features.shadows !== 'none') {
      const shadowMap = this.addResource('shadow_map', { format: 'depth32float', transient: true });
      this.addPass('shadow', PassType.SHADOW)
        .write(shadowMap)
        .run(this._makeShadowPass(features.shadows));
    }

    // ── SSAO
    if (features?.ssao) {
      const ssaoTex  = this.addResource('ssao_raw',    { format: 'r8unorm', transient: true });
      const ssaoBlur = this.addResource('ssao_blur',   { format: 'r8unorm', transient: true });
      this.addPass('ssao', PassType.SSAO)
        .read(gbuffer_n).read(gbuffer_d).write(ssaoTex)
        .run(this._makeSSAOPass(features.ssao));
      this.addPass('ssao_blur', PassType.SSAO_BLUR)
        .read(ssaoTex).write(ssaoBlur)
        .run(this._makeBlurPass('ssao_raw', 'ssao_blur'));
    }

    // ── Lighting
    this.addPass('lighting', PassType.LIGHTING)
      .read(gbuffer).read(gbuffer_n).read(gbuffer_d).write(hdrColor)
      .run(this._makeLightingPass(features));

    // ── SSR
    if (features?.reflections === 'ssr') {
      const ssrTex = this.addResource('ssr', { format: 'rgba16float', transient: true });
      this.addPass('ssr', PassType.SSR)
        .read(hdrColor).read(gbuffer_n).read(gbuffer_d).write(ssrTex)
        .run(this._makeSSRPass());
    }

    // ── Volumetric
    if (features?.volumetric) {
      const volTex = this.addResource('volumetric', { format: 'rgba16float', transient: true });
      this.addPass('volumetric', PassType.VOLUMETRIC)
        .read(gbuffer_d).write(volTex)
        .run(this._makeVolumetricPass());
    }

    // ── Bloom
    if (features?.bloom) {
      const bloomTex = this.addResource('bloom', { format: 'rgba16float', transient: true });
      this.addPass('bloom', PassType.BLOOM)
        .read(hdrColor).write(bloomTex)
        .run(this._makeBloomPass(features.bloom));
    }

    // ── DoF
    if (features?.dof) {
      const dofTex = this.addResource('dof', { format: 'rgba16float', transient: true });
      this.addPass('dof', PassType.DOF)
        .read(hdrColor).read(gbuffer_d).write(dofTex)
        .run(this._makeDoFPass());
    }

    // ── Tone Mapping + Color Grade → LDR
    this.addPass('tonemap', PassType.TONEMAP)
      .read(hdrColor).write(ldrColor)
      .run(this._makeTonemapPass(features?.toneMapping || 'aces'));

    // ── Present (blit to canvas)
    this.addPass('present', PassType.PRESENT)
      .read(ldrColor)
      .run(this._makePresentPass());

    this.compile();
  }

  rebuildPasses(features) {
    this._buildPasses(features);
  }

  applyTier(tier) {
    // Adjust pass parameters based on tier
    const ssaoPass = this._passes.get('ssao');
    if (ssaoPass && tier.ssaoSamples === 0) ssaoPass.enabled = false;
    if (ssaoPass && tier.ssaoSamples > 0)  ssaoPass.enabled = true;
    this.compile();
  }

  // ── Pass Factories (WGSL shader stubs) ───────────────────────────────────

  _makeGeometryPass(features) {
    return async (encoder, resources, scene, camera) => {
      // Real impl: iterate scene drawables, bind material pipelines, issue draws
    };
  }

  _makeShadowPass(mode) {
    return async (encoder, resources, scene, camera) => {
      // Shadow map rendering with PCSS/PCF kernel selection
    };
  }

  _makeSSAOPass(config) {
    return async (encoder, resources, scene, camera) => {
      // HBAO+ style SSAO using depth+normal gbuffer
    };
  }

  _makeBlurPass(src, dst) {
    return async (encoder, resources, scene, camera) => {
      // Separable Gaussian blur
    };
  }

  _makeLightingPass(features) {
    return async (encoder, resources, scene, camera) => {
      // Forward+ or clustered lighting accumulation
    };
  }

  _makeSSRPass() {
    return async (encoder, resources, scene, camera) => {
      // Screen-space reflections with hierarchical Z tracing
    };
  }

  _makeVolumetricPass() {
    return async (encoder, resources, scene, camera) => {
      // Froxel-based volumetric fog & lighting
    };
  }

  _makeBloomPass(config) {
    return async (encoder, resources, scene, camera) => {
      // Dual-kawase or threshold + multi-scale downsample/upsample
    };
  }

  _makeDoFPass() {
    return async (encoder, resources, scene, camera) => {
      // Bokeh depth of field with CoC buffer
    };
  }

  _makeTonemapPass(operator) {
    const operators = {
      aces:     'aces_filmic',
      filmic:   'hejl_burgess',
      reinhard: 'reinhard_extended',
      linear:   'linear',
    };
    return async (encoder, resources, scene, camera) => {
      // Apply tone mapping operator + LUT color grading
    };
  }

  _makePresentPass() {
    return async (encoder, resources, scene, camera) => {
      // Blit final LDR buffer to canvas swap chain
    };
  }

  destroy() {
    for (const [, resource] of this._resources) {
      resource.handle?.destroy?.();
    }
    this._passes.clear();
    this._resources.clear();
  }
}
