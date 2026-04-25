/**
 * ThreeAdapter
 * Hooks StyleShade's render graph into a Three.js WebGLRenderer or WebGPURenderer.
 * Uses Three's onBeforeRender / onAfterRender hooks and custom ShaderMaterial injection.
 */

export class ThreeAdapter {
  constructor({ scene, renderer, camera }, backend, config) {
    this._scene    = scene;
    this._renderer = renderer;
    this._camera   = camera;
    this._backend  = backend;
    this._config   = config;
    this._graph    = null;
    this._matSys   = null;
    this._hooks    = [];
  }

  install(renderGraph, materialSystem) {
    this._graph  = renderGraph;
    this._matSys = materialSystem;

    if (!this._renderer || !this._scene) {
      console.warn('[StyleShade:ThreeAdapter] No renderer/scene provided. Call attach() properly.');
      return;
    }

    // Patch renderer's render method to drive StyleShade's graph
    const origRender = this._renderer.render.bind(this._renderer);
    this._origRender = origRender;

    this._renderer.render = (scene, camera) => {
      this._graph?.execute(scene, camera);
      origRender(scene, camera);
    };

    // Hook scene for per-object material enhancement
    this._installSceneMaterialHooks();

    console.info('[StyleShade] ThreeAdapter installed.');
  }

  uninstall() {
    if (this._origRender) {
      this._renderer.render = this._origRender;
    }
    this._removeSceneMaterialHooks();
  }

  _installSceneMaterialHooks() {
    if (!this._scene) return;

    this._scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        this._patchMaterial(obj.material);
      }
    });

    // Watch for future additions
    const onAdd = (e) => {
      if (e.object?.isMesh && e.object.material) {
        this._patchMaterial(e.object.material);
      }
    };
    this._scene.addEventListener('childadded', onAdd);
    this._hooks.push(() => this._scene.removeEventListener('childadded', onAdd));
  }

  _removeSceneMaterialHooks() {
    for (const cleanup of this._hooks) cleanup();
    this._hooks = [];
  }

  _patchMaterial(mat) {
    if (mat.__styleshade_patched) return;
    mat.__styleshade_patched = true;

    // Inject custom onBeforeCompile to add PBR chunks & features
    const origOnBeforeCompile = mat.onBeforeCompile?.bind(mat) ?? (() => {});

    mat.onBeforeCompile = (shader) => {
      origOnBeforeCompile(shader);

      // Inject StyleShade uniforms
      shader.uniforms.ss_time       = { value: 0 };
      shader.uniforms.ss_resolution = { value: [1920, 1080] };
      shader.uniforms.ss_nearFar    = { value: [0.1, 1000] };

      // Prepend common chunk
      shader.vertexShader   = `// StyleShade v${this._config.version ?? '1.0.0'}\n` + shader.vertexShader;
      shader.fragmentShader = this._buildFragmentPreamble() + shader.fragmentShader;

      mat.__styleshade_shader = shader;
    };

    // Tick uniforms each frame
    const origOnBeforeRender = mat.onBeforeRender?.bind(mat) ?? (() => {});
    mat.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
      origOnBeforeRender(renderer, scene, camera, geometry, object, group);
      if (mat.__styleshade_shader) {
        mat.__styleshade_shader.uniforms.ss_time.value = performance.now() * 0.001;
      }
    };
  }

  _buildFragmentPreamble() {
    const f = this._config.features;
    let preamble = '';
    if (f?.ssao)               preamble += '#define USE_SSAO\n';
    if (f?.bloom)              preamble += '#define USE_BLOOM\n';
    if (f?.shadows === 'pcss') preamble += '#define USE_PCSS\n';
    if (f?.reflections==='ssr')preamble += '#define USE_SSR\n';
    return preamble;
  }
}
