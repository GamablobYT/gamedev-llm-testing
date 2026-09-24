import * as THREE from 'three';

export const MAX_RIPPLES = 28;
export const LAYER_NO_REFLECT = 2;

/**
 * The flooded salt flat: a lit standard material (receives shadows, fog) with hexagonal salt crust,
 * dynamic ripple rings and a planar mirror reflection mixed in by fresnel.
 */
export class Water {
  constructor(atmo) {
    this.atmo = atmo;
    this.rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 0 });
    this.texMat = new THREE.Matrix4();
    this.virtualCam = new THREE.PerspectiveCamera();
    this.ripples = [];
    for (let i = 0; i < MAX_RIPPLES; i++) this.ripples.push({ a: new THREE.Vector4(0, 0, -99, 0), b: new THREE.Vector4(6, 0.6, 5, 1.2) });
    this.ripIdx = 0;

    this.uniforms = {
      tReflect: { value: this.rt.texture }, uTexMat: { value: this.texMat }, uTime: { value: 0 },
      uRip: { value: this.ripples.map((r) => r.a) }, uRipB: { value: this.ripples.map((r) => r.b) },
      uSalt: { value: new THREE.Color() }, uSaltWet: { value: new THREE.Color() }, uWetness: { value: 0.9 },
      uHexGlow: { value: 0 }, uHexGlowColor: { value: new THREE.Color() }, uArenaR: { value: 36 },
      uGlowPos: { value: new THREE.Vector3(0, 0, 0) }, uGlowColor: { value: new THREE.Color(1, 0.4, 0.3) }, uGlowI: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform mat4 uTexMat; varying vec3 vWPos; varying vec4 vReflUv;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vReflUv = uTexMat * vec4(transformed, 1.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tReflect; uniform float uTime, uWetness, uHexGlow, uArenaR, uGlowI;
          uniform vec4 uRip[${MAX_RIPPLES}]; uniform vec4 uRipB[${MAX_RIPPLES}];
          uniform vec3 uSalt, uSaltWet, uHexGlowColor, uGlowPos, uGlowColor;
          varying vec3 vWPos; varying vec4 vReflUv;
          float gRidge; vec2 gGrad; float gRipI; float gDeep;
          float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
          vec4 hexGrid(vec2 p) {
            const vec2 s = vec2(1.0, 1.7320508);
            vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
            vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
            return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
          }
          float hexEdge(vec2 h) { h = abs(h); return 0.5 - max(dot(h, vec2(0.5, 0.8660254)), h.x); }
          `)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec2 xz = vWPos.xz;
            float r = length(xz);
            gDeep = smoothstep(uArenaR - 2.0, uArenaR + 7.0, r);
            vec2 p = xz / 2.7;
            p += 0.18 * vec2(vn(p * 0.8) - 0.5, vn(p * 0.8 + 7.3) - 0.5);
            vec4 hx = hexGrid(p);
            float e = hexEdge(hx.xy);
            float fw = fwidth(e);
            float w = 0.03 + 0.02 * h21(hx.zw);
            float ridge = 1.0 - smoothstep(w, w + fw * 1.5 + 0.01, e);
            float fade = 1.0 - smoothstep(0.02, 0.1, fw);
            // secondary fine crust inside cells
            float fine = smoothstep(0.62, 0.9, vn(xz * 1.7)) * 0.35;
            gRidge = (ridge * fade + fine * fade * 0.5) * (1.0 - gDeep * 0.85);
            float cellVar = h21(hx.zw) * 0.5 + 0.5;
            vec3 wet = uSaltWet * mix(0.85, 1.1, cellVar) * mix(1.0, 0.55, gDeep);
            diffuseColor.rgb = mix(wet, uSalt, clamp(gRidge + 0.18 * (1.0 - fade), 0.0, 1.0));

            // ripples
            gGrad = vec2(0.0); gRipI = 0.0;
            for (int i = 0; i < ${MAX_RIPPLES}; i++) {
              vec4 R = uRip[i]; vec4 B = uRipB[i];
              float age = uTime - R.z;
              if (age < 0.0 || age > 5.0) continue;
              vec2 dv = xz - R.xy; float d = length(dv) + 1e-3;
              float x = d - age * B.x;
              float env = exp(-x * x / (B.y * B.y)) * exp(-age * B.w) * R.w / sqrt(1.0 + d * 0.35);
              gGrad += (dv / d) * env * cos(x * B.z) * B.z * 0.06;
              gRipI += env * (0.5 + 0.5 * sin(x * B.z));
            }
            // almost still: very faint breath of wind
            gGrad += 0.0035 * vec2(sin(xz.x * 0.9 + uTime * 0.7 + sin(xz.y * 0.4)), cos(xz.y * 0.8 - uTime * 0.5 + sin(xz.x * 0.3)));
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize((viewMatrix * vec4(normalize(vec3(-gGrad.x, 1.0, -gGrad.y)), 0.0)).xyz);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(0.55, 0.95, gRidge);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float pulse = 0.7 + 0.3 * sin(uTime * 0.8 + vWPos.x * 0.05 + vWPos.z * 0.07);
            float near = 1.0 - smoothstep(10.0, 70.0, length(vWPos.xz - cameraPosition.xz));
            totalEmissiveRadiance += uHexGlowColor * gRidge * uHexGlow * pulse * (0.25 + 0.75 * near) * 0.35;
            float gd = length(vWPos.xz - uGlowPos.xz);
            totalEmissiveRadiance += uGlowColor * uGlowI * exp(-gd * gd / 30.0) * 0.08 * (0.4 + gRidge);
          }`)
        .replace('#include <opaque_fragment>', `
          {
            vec3 V = normalize(cameraPosition - vWPos);
            vec3 Nw = normalize(vec3(-gGrad.x, 1.0, -gGrad.y));
            float ndv = clamp(dot(Nw, V), 0.0, 1.0);
            float fres = mix(0.3, 1.0, pow(1.0 - ndv, 4.0));
            vec2 ruv = vReflUv.xy / vReflUv.w + gGrad * 0.5;
            vec3 refl = texture2D(tReflect, ruv).rgb;
            float wetness = uWetness * (1.0 - gRidge * 0.8);
            outgoingLight = mix(outgoingLight, refl, clamp(fres * wetness, 0.0, 1.0));
            outgoingLight += vec3(gRipI) * 0.05 * (1.0 - gDeep);
          }
          #include <opaque_fragment>`);
    };
    this.material = mat;
    const geo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'Water';
    this._tmp = { n: new THREE.Vector3(0, 1, 0), view: new THREE.Vector3(), target: new THREE.Vector3(), look: new THREE.Vector3(),
      rot: new THREE.Matrix4(), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4(), camPos: new THREE.Vector3(),
      mirPos: new THREE.Vector3() };
  }

  /** spawn a ripple ring. amp ~ 0.3 (footstep) .. 3 (slam). speed m/s, width m, freq rad/m, decay 1/s */
  ripple(x, z, amp = 1, speed = 5, width = 0.8, freq = 5, decay = 1.1) {
    const r = this.ripples[this.ripIdx];
    this.ripIdx = (this.ripIdx + 1) % MAX_RIPPLES;
    r.a.set(x, z, this.uniforms.uTime.value, amp);
    r.b.set(speed, width, freq, decay);
  }

  clearRipples() { for (const r of this.ripples) r.a.z = -99; }

  setSize(w, h) { this.rt.setSize(Math.max(256, Math.floor(w * 0.5)), Math.max(256, Math.floor(h * 0.5))); }

  sync() {
    const a = this.atmo.cur, u = this.uniforms;
    u.uSalt.value.copy(a.salt); u.uSaltWet.value.copy(a.saltWet); u.uWetness.value = a.wetness;
    u.uHexGlow.value = a.hexGlow; u.uHexGlowColor.value.copy(a.hexGlowColor);
  }

  /** render the mirror image (mirrors Reflector.js, with an oblique clip plane at y = 0) */
  renderReflection(renderer, scene, camera) {
    const T = this._tmp, vc = this.virtualCam;
    T.mirPos.setFromMatrixPosition(this.mesh.matrixWorld);
    T.camPos.setFromMatrixPosition(camera.matrixWorld);
    T.view.subVectors(T.mirPos, T.camPos);
    if (T.view.dot(T.n) > 0) return;
    T.view.reflect(T.n).negate().add(T.mirPos);
    T.rot.extractRotation(camera.matrixWorld);
    T.look.set(0, 0, -1).applyMatrix4(T.rot).add(T.camPos);
    T.target.subVectors(T.mirPos, T.look).reflect(T.n).negate().add(T.mirPos);
    vc.position.copy(T.view);
    vc.up.set(0, 1, 0).applyMatrix4(T.rot).reflect(T.n);
    vc.lookAt(T.target);
    vc.far = camera.far; vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.layers.mask = camera.layers.mask & ~(1 << LAYER_NO_REFLECT);
    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMat.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse).multiply(this.mesh.matrixWorld);
    T.plane.setFromNormalAndCoplanarPoint(T.n, T.mirPos).applyMatrix4(vc.matrixWorldInverse);
    T.clip.set(T.plane.normal.x, T.plane.normal.y, T.plane.normal.z, T.plane.constant);
    const pm = vc.projectionMatrix.elements;
    T.q.x = (Math.sign(T.clip.x) + pm[8]) / pm[0];
    T.q.y = (Math.sign(T.clip.y) + pm[9]) / pm[5];
    T.q.z = -1.0;
    T.q.w = (1.0 + pm[10]) / pm[14];
    T.clip.multiplyScalar(2.0 / T.clip.dot(T.q));
    pm[2] = T.clip.x; pm[6] = T.clip.y; pm[10] = T.clip.z + 1.0 - 0.003; pm[14] = T.clip.w;
    this.mesh.visible = false;
    const cur = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(cur);
    this.mesh.visible = true;
  }
}
