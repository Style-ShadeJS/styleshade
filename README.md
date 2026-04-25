# StyleShade

**High-performance web shader system — Vulkan-inspired WebGPU pipeline.**

[![npm](https://img.shields.io/npm/v/styleshade?color=00e5ff&labelColor=020406)](https://npmjs.com/package/styleshade)
[![license](https://img.shields.io/badge/license-MIT-7b61ff?labelColor=020406)](./LICENSE)
[![WebGPU](https://img.shields.io/badge/backend-WebGPU%20%7C%20WebGL2-00ff88?labelColor=020406)](https://github.com/styleshade/styleshade)

> "Simple outside, powerful inside." — AAA visuals on the web with minimal setup and maximum performance.

---

## Features

- **Explicit render graph** — Vulkan-style DAG with automatic resource barriers and transient texture aliasing
- **WebGPU-first** — compute shaders, indirect draw, GPU-driven culling; automatic WebGL2 fallback
- **Cook-Torrance PBR** — full GGX microfacet BRDF in WGSL and GLSL
- **Forward+ lighting** — tile-based light culling, thousands of dynamic lights
- **Auto quality scaling** — EMA frame-time monitor with hysteresis tier transitions
- **Adapter pattern** — Three.js, Babylon.js, raw WebGPU
- **Chunk-based shaders** — modular WGSL/GLSL with define-driven dead-code elimination
- **Lazy addons** — volumetrics, SSR, lens flare, outlines, motion blur, god rays

---

## Install

```bash
npm install styleshade
# or
yarn add styleshade
```

CDN:
```html
<script type="module">
  import { StyleShade } from 'https://cdn.jsdelivr.net/npm/styleshade/dist/styleshade.esm.js';
</script>
```

---

## Quick Start

```js
import { StyleShade } from 'styleshade';

// Auto mode — detects hardware, picks preset, manages quality
await StyleShade.init({ mode: 'auto', preset: 'cinematic' });
await StyleShade.attach({ engine: 'three', scene, renderer, camera });
```

---

## Advanced Usage

```js
await StyleShade.init({
  mode: 'advanced',
  renderer: 'webgpu',
  features: {
    lighting:    'forward+',
    shadows:     'pcss',
    ssao:        true,
    bloom:       { threshold: 0.8, strength: 1.2 },
    volumetric:  true,
    reflections: 'ssr',
    toneMapping: 'aces',
  },
  performance: { targetFPS: 60, gpuBudgetMS: 12 },
  debug: { overlay: true, hotReload: true },
});

// PBR material
const mat = StyleShade.createMaterial({ lighting: 'pbr', shadows: 'pcss', ao: 'ssao' });

// Custom shader injection
StyleShade.extendShader({ fragment: `color.rgb *= vec3(1.05, 0.98, 0.95);` });

// Lazy-load addons
await StyleShade.loadAddon('volumetrics', { density: 0.04 });
await StyleShade.loadAddon('ssr-reflections');

// React to auto quality changes
StyleShade.on('tier:change', tier => console.log('Quality:', tier));
```

---

## Quality Tiers

| Feature | Ultra | High | Medium | Low |
|---------|-------|------|--------|-----|
| SSAO Samples | 16 | 8 | 4 | — |
| Shadows | PCSS | PCF | Basic | — |
| Shadow Map | 4096² | 2048² | 1024² | 512² |
| Bloom Res | 100% | 75% | 50% | 25% |
| Volumetrics | High | Low Res | Low Res | — |

---

## Render Pipeline

```
Geometry → Shadow → SSAO → Lighting → SSR → Volumetric → Bloom → Tonemap → Present
```

Each pass is a node in the render graph DAG. Optional passes (SSAO, SSR, Volumetric) 
are automatically disabled at lower quality tiers.

---

## Addons

```js
await StyleShade.loadAddon('volumetrics');        // ~18kb
await StyleShade.loadAddon('ssr-reflections');    // ~22kb
await StyleShade.loadAddon('lens-flare');         // ~6kb
await StyleShade.loadAddon('outlines');           // ~9kb
await StyleShade.loadAddon('motion-blur');        // ~11kb
await StyleShade.loadAddon('god-rays');           // ~14kb
await StyleShade.loadAddon('chromatic-aberration'); // ~4kb
```

---

## GitHub Pages

The documentation site lives in `/docs` and is hosted via GitHub Pages.

To enable: **Settings → Pages → Source: Deploy from branch → `main` → `/docs`**

---

## License

MIT © StyleShade Contributors
