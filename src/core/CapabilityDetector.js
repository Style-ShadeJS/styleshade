/**
 * CapabilityDetector
 * Probes the browser/GPU environment and returns a structured
 * capability report used to drive all backend decisions.
 */

export class CapabilityDetector {
  static async detect() {
    const caps = {
      webgpu: false,
      webgl2: false,
      webgl1: false,
      gpuVendor: 'unknown',
      gpuRenderer: 'unknown',
      maxTextureSize: 2048,
      maxVertexAttribs: 8,
      floatTextures: false,
      halfFloatTextures: false,
      instancedArrays: false,
      drawBuffers: false,
      compressedTextures: [],
      anisotropy: 1,
      timestampQuery: false,
      indirectDraw: false,
      computeShaders: false,
      deviceMemoryGB: navigator.deviceMemory || 4,
      hardwareConcurrency: navigator.hardwareConcurrency || 4,
      mobile: /Mobi|Android/i.test(navigator.userAgent),
      highDPI: window.devicePixelRatio > 1.5,
    };

    // ── WebGPU probe ────────────────────────────────────────────────────────
    if ('gpu' in navigator) {
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
          caps.webgpu = true;
          caps.computeShaders = true;
          caps.indirectDraw = true;
          caps.timestampQuery = adapter.features.has('timestamp-query');
          caps.gpuVendor = (await adapter.requestAdapterInfo?.())?.vendor || 'unknown';

          const limits = adapter.limits;
          caps.maxTextureSize = limits.maxTextureDimension2D;
          caps.maxBindGroups = limits.maxBindGroups;
          caps.maxStorageBufferSize = limits.maxStorageBufferBindingSize;

          if (adapter.features.has('texture-compression-bc'))  caps.compressedTextures.push('bc');
          if (adapter.features.has('texture-compression-etc2')) caps.compressedTextures.push('etc2');
          if (adapter.features.has('texture-compression-astc')) caps.compressedTextures.push('astc');
        }
      } catch (e) {
        // WebGPU probe failed silently
      }
    }

    // ── WebGL2 probe ────────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) {
      caps.webgl2 = true;
      caps.floatTextures = !!gl2.getExtension('EXT_color_buffer_float');
      caps.halfFloatTextures = !!gl2.getExtension('EXT_color_buffer_half_float');
      caps.drawBuffers = true;
      caps.instancedArrays = true;

      const dbExt = gl2.getExtension('EXT_texture_filter_anisotropic')
                 || gl2.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
      if (dbExt) caps.anisotropy = gl2.getParameter(dbExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);

      const debugInfo = gl2.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo && !caps.webgpu) {
        caps.gpuVendor   = gl2.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        caps.gpuRenderer = gl2.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      }

      caps.maxTextureSize = Math.max(caps.maxTextureSize, gl2.getParameter(gl2.MAX_TEXTURE_SIZE));

      const extComp = [
        'WEBGL_compressed_texture_s3tc',
        'WEBGL_compressed_texture_etc',
        'WEBGL_compressed_texture_astc',
        'WEBGL_compressed_texture_pvrtc',
      ];
      for (const ext of extComp) {
        if (gl2.getExtension(ext)) caps.compressedTextures.push(ext.replace('WEBGL_compressed_texture_', ''));
      }

      gl2.getExtension('OES_texture_float');
      gl2.getExtension('OES_texture_half_float');
    }

    // ── WebGL1 fallback probe ───────────────────────────────────────────────
    if (!caps.webgl2) {
      const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl1) caps.webgl1 = true;
    }

    canvas.remove();
    return caps;
  }

  /**
   * Recommend a quality tier from capability data.
   */
  static recommendTier(caps) {
    if (!caps.webgpu && !caps.webgl2) return 'low';
    if (caps.mobile) return caps.webgpu ? 'medium' : 'low';
    if (caps.webgpu && caps.deviceMemoryGB >= 8 && caps.hardwareConcurrency >= 8) return 'ultra';
    if ((caps.webgpu || caps.webgl2) && caps.deviceMemoryGB >= 4) return 'high';
    if (caps.webgl2) return 'medium';
    return 'low';
  }
}
