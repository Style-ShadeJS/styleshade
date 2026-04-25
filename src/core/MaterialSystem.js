/**
 * MaterialSystem — creates and caches StyleShade-enhanced materials
 */
export class MaterialSystem {
  constructor(shaderCompiler, config) {
    this._compiler = shaderCompiler;
    this._config   = config;
    this._materials = new Map();
  }

  create(config = {}) {
    const key = JSON.stringify(config);
    if (this._materials.has(key)) return this._materials.get(key);

    const mat = {
      id: `ss_mat_${this._materials.size}`,
      config,
      chunks: this._resolveChunks(config),
      uniforms: this._defaultUniforms(config),
      __isStyleShadeMaterial: true,
    };

    const compiled = this._compiler.compile(
      'material',
      mat.chunks,
      this._defineMap(config)
    );
    mat.source = compiled.source;

    this._materials.set(key, mat);
    return mat;
  }

  _resolveChunks(cfg) {
    const chunks = ['common_uniforms'];
    if (cfg.lighting === 'pbr') chunks.push('pbr_material');
    if (cfg.shadows === 'pcss') chunks.push('shadow_pcss');
    if (cfg.ao === 'ssao')      chunks.push('ssao');
    chunks.push('tone_aces');
    return chunks;
  }

  _defineMap(cfg) {
    return {
      USE_PBR:    cfg.lighting === 'pbr' ? 1 : 0,
      USE_PCSS:   cfg.shadows === 'pcss' ? 1 : 0,
      USE_SSAO:   cfg.ao === 'ssao'      ? 1 : 0,
    };
  }

  _defaultUniforms(cfg) {
    return {
      albedo:    [1, 1, 1, 1],
      metallic:  cfg.metallic   ?? 0.0,
      roughness: cfg.roughness  ?? 0.5,
      emissive:  [0, 0, 0],
    };
  }
}
