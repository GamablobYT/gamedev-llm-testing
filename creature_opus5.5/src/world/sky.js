import * as THREE from 'three';

// Sky dome evaluated purely from view direction, so it renders identically in the mirror pass.
const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */`
uniform vec3 uSunDir, uMoonDir;
uniform vec3 uZenith, uMid, uHorizon, uGlow, uBelt, uShadowBand, uCloud, uSunColor;
uniform float uStars, uTime, uSunI, uGain;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hh = max(h, 0.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, hh));
  col = mix(col, uZenith, smoothstep(0.18, 0.85, hh));

  // anti-sun side: earth shadow band (deep blue) under the belt of Venus (pink)
  vec2 sd = normalize(uSunDir.xz + 1e-5);
  vec2 dd = normalize(d.xz + 1e-5);
  float anti = smoothstep(-0.1, -0.9, dot(sd, dd));
  float belt = smoothstep(0.03, 0.09, hh) * (1.0 - smoothstep(0.1, 0.26, hh));
  float band = 1.0 - smoothstep(0.0, 0.07, hh);
  col = mix(col, uBelt, belt * anti * 0.75);
  col = mix(col, uShadowBand, band * anti * 0.55);

  // sun glow + disc
  float s = max(dot(d, uSunDir), 0.0);
  col += uGlow * (pow(s, 6.0) * 0.55 + pow(s, 48.0) * 0.9) * (0.4 + 0.6 * (1.0 - hh));
  float disc = smoothstep(0.99975, 0.99988, s) * step(-0.01, h);
  col += mix(uSunColor, uGlow, 0.4) * disc * 2.2 * uSunI / 3.0;

  // long horizontal streak clouds, lit by the sun from below
  float az = atan(d.z, d.x);
  float c = fbm(vec2(az * 3.0, hh * 26.0 + 3.0) + vec2(uTime * 0.004, 0.0));
  c = smoothstep(0.52, 0.78, c) * smoothstep(0.02, 0.06, hh) * (1.0 - smoothstep(0.1, 0.24, hh));
  vec3 cloudCol = mix(uCloud * 0.85, uGlow * 1.3, pow(s, 3.0));
  col = mix(col, cloudCol, c * 0.55);

  // stars (phase 2)
  if (uStars > 0.001) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float r = hash3(cell);
    float star = step(0.9965, r);
    vec3 f = fract(sp) - 0.5;
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 4.0) + r * 60.0);
    col += vec3(0.85, 0.88, 1.0) * star * smoothstep(0.35, 0.0, length(f)) * tw * smoothstep(0.02, 0.2, hh) * uStars * 1.8;
    // faint galactic band
    float mw = fbm(vec2(az * 2.0, d.y * 5.0) * 1.5);
    col += vec3(0.12, 0.1, 0.22) * smoothstep(0.45, 0.8, mw) * exp(-pow((d.y - 0.45 + 0.3 * sin(az)) * 2.5, 2.0)) * uStars * 0.5;
    // thin moon
    float m = dot(d, uMoonDir);
    float moon = smoothstep(0.99925, 0.9995, m) - smoothstep(0.99925, 0.9995, dot(d, normalize(uMoonDir + vec3(0.012, 0.004, 0.0))));
    col += vec3(1.0, 0.96, 0.9) * max(moon, 0.0) * 3.0 * uStars;
    col += vec3(0.3, 0.35, 0.6) * pow(max(m, 0.0), 200.0) * 0.3 * uStars;
  }
  // below the horizon: fog colour continues (the far water plane blends into this)
  if (h < 0.0) col = mix(uHorizon, uHorizon * 0.9, smoothstep(0.0, -0.2, h));
  gl_FragColor = vec4(col * uGain, 1.0);
}`;

export class Sky {
  constructor(atmo) {
    this.atmo = atmo;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() },
      uZenith: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uBelt: { value: new THREE.Color() }, uShadowBand: { value: new THREE.Color() },
      uCloud: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 }, uTime: { value: 0 }, uSunI: { value: 1 }, uGain: { value: 0.72 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.onBeforeRender = (r, s, cam) => { this.mesh.position.copy(cam.position); this.mesh.updateMatrixWorld(); };
    this.sync();
  }
  sync() {
    const a = this.atmo.cur, u = this.uniforms;
    u.uSunDir.value.copy(a.sunDir); u.uMoonDir.value.copy(a.moonDir);
    u.uZenith.value.copy(a.zenith); u.uMid.value.copy(a.mid); u.uHorizon.value.copy(a.horizon);
    u.uGlow.value.copy(a.glow); u.uBelt.value.copy(a.belt); u.uShadowBand.value.copy(a.shadowBand);
    u.uCloud.value.copy(a.cloud); u.uSunColor.value.copy(a.sunColor);
    u.uStars.value = a.stars; u.uSunI.value = a.sunI;
  }
  update(t) { this.uniforms.uTime.value = t; this.sync(); }
}
