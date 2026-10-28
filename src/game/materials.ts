import * as THREE from 'three'
import { DataUtils } from 'three'
import type { Terrain } from './terrain'
import { WORLD } from './terrain'

/** Uniforms shared by every animated world material (one update per frame). */
export const WORLD_UNIFORMS = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.45, 0.62, 0.64).normalize() },
  uSkyTop: { value: new THREE.Color('#3f9fe0') },
  uSkyHorizon: { value: new THREE.Color('#bfe8f2') },
  uSunColor: { value: new THREE.Color('#fff1c9') },
}

const NOISE_GLSL = /* glsl */ `
float cw_hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float cw_noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(cw_hash(i), cw_hash(i+vec2(1,0)), u.x), mix(cw_hash(i+vec2(0,1)), cw_hash(i+vec2(1,1)), u.x), u.y); }
float cw_fbm(vec2 p){ float s=0.0; float a=0.5; for(int i=0;i<4;i++){ s+=a*cw_noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
`

/**
 * Adds gentle wind sway to an (instanced) foliage material. Displacement grows with the
 * square of local height so roots stay planted; each instance gets its own phase.
 */
export function windify<T extends THREE.Material>(mat: T, strength: number, height: number, flutter = 0): T {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
      {
        float hgt = max(0.0, transformed.y) / ${height.toFixed(3)};
        float w = hgt * hgt * ${strength.toFixed(3)};
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float ph = ip.x * 0.11 + ip.z * 0.15;
        float gust = 0.65 + 0.35 * sin(uTime * 0.35 + ip.x * 0.01);
        float s = (sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.9) * 0.3) * gust;
        transformed.x += s * w;
        transformed.z += cos(uTime * 1.25 + ph) * 0.45 * w * gust;
        transformed.y += sin(uTime * 7.0 + ph * 3.0 + transformed.x * 2.0) * ${flutter.toFixed(3)} * hgt;
      }`)
  }
  mat.customProgramCacheKey = () => `wind-${strength}-${height}-${flutter}`
  return mat
}

/** Terrain: vertex colours + world-space painterly breakup + emissive lava glow attribute. */
export function terrainMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 })
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying vec3 vWorldP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGlow = aGlow;\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying float vGlow;\nvarying vec3 vWorldP;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        float nA = cw_fbm(vWorldP.xz * 0.21);
        float nB = cw_noise(vWorldP.xz * 1.3);
        diffuseColor.rgb *= 0.86 + 0.22 * nA + 0.07 * nB;`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + vWorldP.x * 0.2 + vWorldP.z * 0.13);
        totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * vGlow * vGlow * vGlow * 0.55 * pulse;`)
  }
  mat.customProgramCacheKey = () => 'cw-terrain'
  return mat
}

/** Height texture shared by water and lava shaders (half-float, linearly filtered). */
export function heightTexture(terrain: Terrain): THREE.DataTexture {
  const N = terrain.N
  const data = new Uint16Array(N * N)
  for (let i = 0; i < N * N; i += 1) data[i] = DataUtils.toHalfFloat(terrain.heights[i])
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog)

/** Stylised water: depth tint, animated shoreline foam bands, sparkles and a sun glint. */
export function waterMaterial(heights: THREE.Texture, level: number, palette: { shallow: string; mid: string; deep: string }, steam = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    depthWrite: false,
    uniforms: {
      ...fogUniforms(),
      uTime: WORLD_UNIFORMS.uTime,
      uSunDir: WORLD_UNIFORMS.uSunDir,
      uSky: WORLD_UNIFORMS.uSkyHorizon,
      uHeights: { value: heights },
      uLevel: { value: level },
      uHalf: { value: WORLD.half },
      uShallow: { value: new THREE.Color(palette.shallow) },
      uMid: { value: new THREE.Color(palette.mid) },
      uDeep: { value: new THREE.Color(palette.deep) },
      uSteam: { value: steam },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      varying vec3 vWorld;
      void main(){
        vec3 p = position;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        wp.y += sin(wp.x * 0.08 + uTime * 0.9) * 0.08 + cos(wp.z * 0.07 + uTime * 0.7) * 0.08;
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSky; uniform sampler2D uHeights;
      uniform float uLevel; uniform float uHalf; uniform vec3 uShallow; uniform vec3 uMid; uniform vec3 uDeep; uniform float uSteam;
      varying vec3 vWorld;
      void main(){
        vec2 uv = (vWorld.xz + uHalf) / (2.0 * uHalf);
        float ground = texture2D(uHeights, uv).r;
        bool inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
        float depth = inside ? uLevel - ground : 30.0;
        if (depth < -0.3) discard;
        vec2 p = vWorld.xz;
        float t = uTime;
        float n1 = cw_noise(p * 0.18 + vec2(t * 0.06, t * 0.04));
        float n2 = cw_noise(p * 0.45 - vec2(t * 0.09, -t * 0.05));
        vec3 nrm = normalize(vec3((n1 - 0.5) * 0.35 + (n2 - 0.5) * 0.2, 1.0, (n2 - 0.5) * 0.35 - (n1 - 0.5) * 0.15));
        vec3 col = mix(uShallow, uMid, smoothstep(0.2, 3.5, depth));
        col = mix(col, uDeep, smoothstep(3.5, 16.0, depth));
        // Shallow-only detail is skipped in deep water (most of the visible sea).
        if (depth < 4.0) {
          float caust = smoothstep(0.62, 0.9, cw_noise(p * 0.9 + t * 0.25) * 0.6 + cw_noise(p * 1.7 - t * 0.2) * 0.5);
          col += caust * 0.12 * (1.0 - smoothstep(0.5, 4.0, depth));
        }
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(V, nrm), 0.0), 3.0);
        col = mix(col, uSky, fres * 0.55);
        vec3 H = normalize(V + uSunDir);
        float spec = pow(max(dot(nrm, H), 0.0), 220.0) * 0.45;
        float glitter = step(0.985, cw_hash(floor(p * 3.0) + floor(t * 4.0))) * 0.25 * spec;
        col += (spec + glitter) * vec3(1.0, 0.95, 0.82);
        float foam = 0.0;
        if (depth < 2.2) {
          float edge = 1.0 - smoothstep(0.0, 0.45 + 0.2 * sin(t * 1.3 + p.x * 0.3), depth);
          foam = edge * smoothstep(0.3, 0.55, cw_noise(p * 0.9 + t * 0.35) + edge * 0.35);
          float band = sin(depth * 3.2 - t * 1.8 + cw_noise(p * 0.2) * 3.0);
          foam += smoothstep(0.93, 1.0, band) * smoothstep(0.15, 0.5, depth) * (1.0 - smoothstep(0.5, 2.2, depth)) * 0.55;
          foam = clamp(foam, 0.0, 1.0);
        }
        col = mix(col, vec3(0.97, 1.0, 1.0), foam * 0.8);
        col = mix(col, vec3(0.92, 0.97, 0.98), uSteam * (0.25 + 0.2 * cw_noise(p * 0.3 + t * 0.2)));
        float alpha = mix(0.55, 0.95, smoothstep(0.0, 2.5, depth));
        alpha = max(alpha, foam);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  })
}

/** Flowing molten lava with cooling crust plates and bright seams; blooms on high quality. */
export function lavaMaterial(heights: THREE.Texture, level: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: { ...fogUniforms(), uTime: WORLD_UNIFORMS.uTime, uHeights: { value: heights }, uLevel: { value: level }, uHalf: { value: WORLD.half } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += sin(wp.x * 0.3 + uTime * 0.8) * 0.12 + cos(wp.z * 0.25 + uTime * 0.6) * 0.12;
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      uniform float uTime; uniform sampler2D uHeights; uniform float uLevel; uniform float uHalf;
      varying vec3 vWorld;
      void main(){
        vec2 uv = (vWorld.xz + uHalf) / (2.0 * uHalf);
        float depth = uLevel - texture2D(uHeights, uv).r;
        if (depth < -0.4) discard;
        vec2 p = vWorld.xz * 0.12;
        float t = uTime * 0.05;
        vec2 flow = vec2(cw_fbm(p + t), cw_fbm(p - t + 3.1));
        float n = cw_fbm(p * 2.0 + flow * 1.6 + vec2(t * 2.0, -t));
        float cells = cw_noise(p * 5.0 + flow * 2.0);
        float crust = smoothstep(0.5, 0.68, n) * smoothstep(0.3, 0.75, cells);
        vec3 hot = mix(vec3(0.95, 0.2, 0.02), vec3(1.0, 0.62, 0.12), smoothstep(0.4, 0.12, n));
        vec3 col = mix(hot * 1.35, vec3(0.13, 0.04, 0.03), crust * 0.92);
        float seam = 1.0 - smoothstep(0.0, 0.05, abs(cells - 0.5));
        col += vec3(1.0, 0.55, 0.1) * seam * crust * 1.2;
        col = mix(col, vec3(0.1, 0.04, 0.03), (1.0 - smoothstep(0.0, 0.9, depth)) * 0.7);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  })
}

/** Painted sky dome: gradient, soft sun, sun halo and drifting cirrus bands. Fog-free. */
export function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: WORLD_UNIFORMS.uTime, uTop: WORLD_UNIFORMS.uSkyTop, uHorizon: WORLD_UNIFORMS.uSkyHorizon, uSunDir: WORLD_UNIFORMS.uSunDir, uSunColor: WORLD_UNIFORMS.uSunColor },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.6, h), 0.8));
        col = mix(col, uHorizon * 0.92, smoothstep(0.02, -0.25, h));
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 18.0) * 0.35 + pow(sd, 4.0) * 0.12);
        float band = smoothstep(0.02, 0.25, h) * (1.0 - smoothstep(0.55, 0.9, h));
        if (band > 0.001) {
          vec2 cp = d.xz / max(d.y + 0.18, 0.05);
          float c = cw_fbm(cp * 0.9 + vec2(uTime * 0.004, uTime * 0.002));
          col = mix(col, mix(vec3(1.0), uSunColor, 0.3), smoothstep(0.5, 0.78, c) * band * 0.55);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

/** Scrolling waterfall ribbon with foamy streaks. */
export function waterfallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: { ...fogUniforms(), uTime: WORLD_UNIFORMS.uTime },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      uniform float uTime; varying vec2 vUv;
      void main(){
        float s = cw_noise(vec2(vUv.x * 18.0, vUv.y * 3.0 - uTime * 2.4));
        float s2 = cw_noise(vec2(vUv.x * 40.0, vUv.y * 6.0 - uTime * 3.6));
        float streak = smoothstep(0.35, 0.9, s * 0.7 + s2 * 0.5);
        vec3 col = mix(vec3(0.45, 0.82, 0.92), vec3(1.0), streak);
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float alpha = (0.55 + streak * 0.45) * edge;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  })
}
