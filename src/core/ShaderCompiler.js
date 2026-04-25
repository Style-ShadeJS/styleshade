/**
 * ShaderCompiler
 * 
 * Chunk-based shader composition system.
 * - WGSL primary (WebGPU), GLSL fallback (WebGL2)
 * - Automatic optimization pass before compilation
 * - Variant caching to eliminate runtime branching
 * - Hot-reload via cache invalidation
 */

export class ShaderCompiler {
  constructor(backend, config) {
    this._backend = backend;
    this._config = config;
    this._cache = new Map();   // key → compiled pipeline/program
    this._chunks = new Map();  // name → source string
    this._defines = new Map();

    this._registerBuiltinChunks();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Compile a full shader from a list of chunks + defines.
   * Returns cached result if available.
   */
  compile(type, chunks, defines = {}) {
    const key = this._cacheKey(type, chunks, defines);
    if (this._cache.has(key)) return this._cache.get(key);

    const merged = this._mergeChunks(chunks, defines);
    const optimized = this._optimize(merged, type);
    const result = { source: optimized, key };

    this._cache.set(key, result);
    return result;
  }

  /**
   * Register a custom shader chunk by name.
   */
  registerChunk(name, source) {
    this._chunks.set(name, source);
    return this;
  }

  /**
   * Set a global define across all shaders.
   */
  define(key, value) {
    this._defines.set(key, value);
    this.invalidateCache();
    return this;
  }

  /**
   * Bust the entire compiled cache (used on hot reload or feature change).
   */
  invalidateCache() {
    this._cache.clear();
  }

  // ── Chunk Merging ──────────────────────────────────────────────────────────

  _mergeChunks(chunkNames, localDefines) {
    const allDefines = { ...Object.fromEntries(this._defines), ...localDefines };
    const defineBlock = this._backend === 'webgpu'
      ? '' // WGSL doesn't use #define
      : Object.entries(allDefines).map(([k, v]) => `#define ${k} ${v}`).join('\n');

    const sources = chunkNames.map(name => {
      const chunk = this._chunks.get(name);
      if (!chunk) {
        console.warn(`[StyleShade:ShaderCompiler] Unknown chunk "${name}"`);
        return `// missing chunk: ${name}`;
      }
      return chunk;
    });

    return [defineBlock, ...sources].join('\n');
  }

  // ── Optimization Pass ──────────────────────────────────────────────────────

  _optimize(source, type) {
    // Remove dead branches based on defines
    let opt = source;

    // Strip debug output in production
    if (!this._config.debug?.overlay) {
      opt = opt.replace(/\/\/ DEBUG_START[\s\S]*?\/\/ DEBUG_END/g, '');
    }

    // Collapse consecutive whitespace (lightweight)
    opt = opt.replace(/\n{3,}/g, '\n\n');

    return opt;
  }

  // ── Cache Key ──────────────────────────────────────────────────────────────

  _cacheKey(type, chunks, defines) {
    return `${type}::${chunks.join('+')}::${JSON.stringify(defines)}::${this._backend}`;
  }

  // ── Built-in Chunks ────────────────────────────────────────────────────────

  _registerBuiltinChunks() {
    // ── WGSL Chunks ──────────────────────────────────────────────────────────
    if (this._backend === 'webgpu') {
      this._registerWGSLChunks();
    } else {
      this._registerGLSLChunks();
    }
  }

  _registerWGSLChunks() {
    this._chunks.set('common_uniforms', /* wgsl */`
struct FrameUniforms {
  viewMatrix:       mat4x4<f32>,
  projMatrix:       mat4x4<f32>,
  viewProjMatrix:   mat4x4<f32>,
  invViewProjMatrix:mat4x4<f32>,
  cameraPosition:   vec3<f32>,
  time:             f32,
  resolution:       vec2<f32>,
  nearFar:          vec2<f32>,
};
@group(0) @binding(0) var<uniform> frame: FrameUniforms;
`);

    this._chunks.set('pbr_material', /* wgsl */`
struct Material {
  albedo:    vec4<f32>,
  metallic:  f32,
  roughness: f32,
  ao:        f32,
  emissive:  vec3<f32>,
};

fn fresnel_schlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn distribution_ggx(N: vec3<f32>, H: vec3<f32>, roughness: f32) -> f32 {
  let a      = roughness * roughness;
  let a2     = a * a;
  let NdotH  = max(dot(N, H), 0.0);
  let NdotH2 = NdotH * NdotH;
  let num    = a2;
  var denom  = (NdotH2 * (a2 - 1.0) + 1.0);
  denom      = 3.14159265 * denom * denom;
  return num / denom;
}

fn geometry_schlick_ggx(NdotV: f32, roughness: f32) -> f32 {
  let r = (roughness + 1.0);
  let k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

fn geometry_smith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
  let NdotV = max(dot(N, V), 0.0);
  let NdotL = max(dot(N, L), 0.0);
  return geometry_schlick_ggx(NdotV, roughness) * geometry_schlick_ggx(NdotL, roughness);
}

fn cook_torrance_brdf(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, mat: Material, lightColor: vec3<f32>) -> vec3<f32> {
  let H      = normalize(V + L);
  let F0     = mix(vec3<f32>(0.04), mat.albedo.rgb, mat.metallic);
  let NDF    = distribution_ggx(N, H, mat.roughness);
  let G      = geometry_smith(N, V, L, mat.roughness);
  let F      = fresnel_schlick(max(dot(H, V), 0.0), F0);
  let kD     = (vec3<f32>(1.0) - F) * (1.0 - mat.metallic);
  let num    = NDF * G * F;
  let denom  = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
  let spec   = num / denom;
  let NdotL  = max(dot(N, L), 0.0);
  return (kD * mat.albedo.rgb / 3.14159265 + spec) * lightColor * NdotL;
}
`);

    this._chunks.set('tone_aces', /* wgsl */`
fn aces_filmic(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;  let b = 0.03;
  let c = 2.43;  let d = 0.59;  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}
`);

    this._chunks.set('tone_reinhard', /* wgsl */`
fn reinhard_extended(x: vec3<f32>) -> vec3<f32> {
  let Lwhite = 4.0;
  return x * (1.0 + x / (Lwhite * Lwhite)) / (1.0 + x);
}
`);

    this._chunks.set('ssao', /* wgsl */`
// HBAO+-style SSAO
fn ssao_sample(depth_tex: texture_depth_2d, normal_tex: texture_2d<f32>,
               uv: vec2<f32>, kernel: array<vec3<f32>, 16>, noiseScale: vec2<f32>) -> f32 {
  // Stub: full impl reconstructs position from depth, samples hemisphere
  return 1.0;
}
`);

    this._chunks.set('shadow_pcss', /* wgsl */`
// Percentage Closer Soft Shadows
fn pcss(shadow_map: texture_depth_2d, shadow_sampler: sampler_comparison,
        shadow_coord: vec4<f32>, light_size: f32) -> f32 {
  // Stub: blocker search + PCF filtering
  return 1.0;
}
`);

    this._chunks.set('forward_plus_light', /* wgsl */`
struct Light {
  position:  vec3<f32>,
  range:     f32,
  color:     vec3<f32>,
  intensity: f32,
  direction: vec3<f32>,
  spotAngle: f32,
  kind:      u32, // 0=point 1=directional 2=spot
  _pad:      vec3<f32>,
};
@group(1) @binding(0) var<storage, read> lights: array<Light>;
@group(1) @binding(1) var<storage, read> lightIndices: array<u32>;
@group(1) @binding(2) var<storage, read> lightGrid: array<vec2<u32>>;

fn evaluate_lights(pos: vec3<f32>, N: vec3<f32>, V: vec3<f32>, mat: Material, tileCoord: vec2<u32>) -> vec3<f32> {
  var result = vec3<f32>(0.0);
  let gridOffset = lightGrid[tileCoord.y * 32u + tileCoord.x];
  for (var i = gridOffset.x; i < gridOffset.x + gridOffset.y; i++) {
    let light = lights[lightIndices[i]];
    let L = normalize(light.position - pos);
    let dist = length(light.position - pos);
    let atten = clamp(1.0 - dist / light.range, 0.0, 1.0);
    result += cook_torrance_brdf(N, V, L, mat, light.color * light.intensity * atten);
  }
  return result;
}
`);

    this._chunks.set('bloom_dual_kawase', /* wgsl */`
// Dual Kawase Bloom - better quality/perf than standard gaussian
fn kawase_downsample(tex: texture_2d<f32>, samp: sampler, uv: vec2<f32>, offset: f32, texelSize: vec2<f32>) -> vec4<f32> {
  var sum = textureSample(tex, samp, uv) * 4.0;
  sum += textureSample(tex, samp, uv + vec2<f32>( offset,  offset) * texelSize);
  sum += textureSample(tex, samp, uv + vec2<f32>(-offset,  offset) * texelSize);
  sum += textureSample(tex, samp, uv + vec2<f32>( offset, -offset) * texelSize);
  sum += textureSample(tex, samp, uv + vec2<f32>(-offset, -offset) * texelSize);
  return sum / 8.0;
}

fn kawase_upsample(tex: texture_2d<f32>, samp: sampler, uv: vec2<f32>, offset: f32, texelSize: vec2<f32>) -> vec4<f32> {
  var sum = vec4<f32>(0.0);
  sum += textureSample(tex, samp, uv + vec2<f32>(-offset * 2.0, 0.0) * texelSize);
  sum += textureSample(tex, samp, uv + vec2<f32>(-offset, offset) * texelSize) * 2.0;
  sum += textureSample(tex, samp, uv + vec2<f32>(0.0, offset * 2.0) * texelSize);
  sum += textureSample(tex, samp, uv + vec2<f32>(offset, offset) * texelSize) * 2.0;
  sum += textureSample(tex, samp, uv + vec2<f32>(offset * 2.0, 0.0) * texelSize);
  sum += textureSample(tex, samp, uv + vec2<f32>(offset, -offset) * texelSize) * 2.0;
  sum += textureSample(tex, samp, uv + vec2<f32>(0.0, -offset * 2.0) * texelSize);
  sum += textureSample(tex, samp, uv + vec2<f32>(-offset, -offset) * texelSize) * 2.0;
  return sum / 12.0;
}
`);

    this._chunks.set('volumetric_fog', /* wgsl */`
// Froxel-based volumetric fog
fn sample_volumetric(froxel_tex: texture_3d<f32>, samp: sampler, uvd: vec3<f32>) -> vec4<f32> {
  return textureSample(froxel_tex, samp, uvd);
}

fn apply_volumetric(color: vec3<f32>, vol: vec4<f32>) -> vec3<f32> {
  return color * vol.a + vol.rgb;
}
`);

    this._chunks.set('ssr', /* wgsl */`
// Screen-Space Reflections with hierarchical Z tracing
fn ssr_trace(depth_tex: texture_depth_2d, color_tex: texture_2d<f32>,
             normal_tex: texture_2d<f32>, uv: vec2<f32>,
             viewPos: vec3<f32>, viewNormal: vec3<f32>,
             projMatrix: mat4x4<f32>, invProjMatrix: mat4x4<f32>) -> vec4<f32> {
  // Stub: binary search along reflected ray in screen space
  return vec4<f32>(0.0);
}
`);
  }

  _registerGLSLChunks() {
    this._chunks.set('common_uniforms', `
uniform mat4 viewMatrix;
uniform mat4 projMatrix;
uniform mat4 viewProjMatrix;
uniform vec3 cameraPosition;
uniform float time;
uniform vec2 resolution;
uniform vec2 nearFar;
`);

    this._chunks.set('pbr_material', `
vec3 fresnel_schlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
float distribution_ggx(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float NdotH2 = NdotH * NdotH;
  float denom = NdotH2 * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * denom * denom);
}
float geometry_schlick(float NdotV, float roughness) {
  float k = pow(roughness + 1.0, 2.0) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}
float geometry_smith(vec3 N, vec3 V, vec3 L, float roughness) {
  return geometry_schlick(max(dot(N,V),0.0), roughness)
       * geometry_schlick(max(dot(N,L),0.0), roughness);
}
`);

    this._chunks.set('tone_aces', `
vec3 aces_filmic(vec3 x) {
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}
`);
  }
}
