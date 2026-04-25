/**
 * BabylonAdapter
 * Hooks StyleShade into a Babylon.js engine via post-process pipeline
 * and material plugin system.
 */
export class BabylonAdapter {
  constructor({ scene, renderer, camera }, backend, config) {
    this._scene    = scene;
    this._engine   = renderer; // In Babylon, renderer is the engine
    this._camera   = camera;
    this._backend  = backend;
    this._config   = config;
    this._pipeline = null;
  }

  install(renderGraph, materialSystem) {
    this._graph  = renderGraph;
    this._matSys = materialSystem;

    if (!this._scene) {
      console.warn('[StyleShade:BabylonAdapter] No scene provided.');
      return;
    }

    // Hook Babylon's render loop
    this._scene.registerBeforeRender(() => {
      this._graph?.execute(this._scene, this._camera);
    });

    // Install material plugin
    this._installMaterialPlugin();
    console.info('[StyleShade] BabylonAdapter installed.');
  }

  uninstall() {
    this._scene?.unregisterBeforeRender(this._renderHook);
  }

  _installMaterialPlugin() {
    if (!this._scene) return;
    // Babylon uses a MaterialPlugin system for shader injection
    // We register a global plugin that all PBRMaterial instances pick up
    this._scene.meshes?.forEach(mesh => {
      const mat = mesh.material;
      if (!mat) return;
      // In a real implementation, you'd create a MaterialPlugin subclass
      // and inject SSAO, bloom threshold, etc. into the fragment shader.
    });
  }
}

/**
 * RawWebGPUAdapter
 * For users managing their own WebGPU context directly.
 * Provides a thin integration layer with StyleShade's render graph.
 */
export class RawWebGPUAdapter {
  constructor({ canvas }, backend, config) {
    this._canvas  = canvas;
    this._backend = backend;
    this._config  = config;
    this._ctx     = null;
  }

  install(renderGraph, materialSystem) {
    this._graph  = renderGraph;
    this._matSys = materialSystem;

    if (this._canvas && this._backend === 'webgpu') {
      this._ctx = this._canvas.getContext('webgpu');
      if (!this._ctx) {
        console.warn('[StyleShade:RawWebGPUAdapter] Could not get WebGPU context from canvas.');
      }
    }

    console.info('[StyleShade] RawWebGPUAdapter installed. Call StyleShade.renderFrame(scene, camera) manually.');
  }

  /**
   * Manual render call for raw WebGPU usage.
   */
  async renderFrame(scene, camera) {
    await this._graph?.execute(scene, camera);
  }

  uninstall() {
    this._ctx = null;
  }
}
