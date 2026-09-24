import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Final grade: vignette, film grain, hit chromatic aberration, desaturation (death), radial impact blur.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uChroma: { value: 0 },
    uDesat: { value: 0 }, uLift: { value: new THREE.Vector3(0.0, 0.0, 0.012) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    uRadial: { value: 0 }, uRadialCenter: { value: new THREE.Vector2(0.5, 0.5) }, uFade: { value: 0 }, uFadeColor: { value: new THREE.Color(0, 0, 0) },
    uAspect: { value: 1 }, uContrast: { value: 1.12 }, uSat: { value: 1.08 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uChroma, uDesat, uRadial, uFade, uAspect, uContrast, uSat;
    uniform vec3 uLift, uGain, uFadeColor; uniform vec2 uRadialCenter;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 17.0) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 dc = uv - 0.5;
      vec3 col;
      if (uRadial > 0.001) {
        vec2 dir = uv - uRadialCenter; col = vec3(0.0);
        for (int i = 0; i < 8; i++) { float k = float(i) / 7.0; col += texture2D(tDiffuse, uv - dir * k * uRadial * 0.08).rgb; }
        col /= 8.0;
      } else col = texture2D(tDiffuse, uv).rgb;
      if (uChroma > 0.001) {
        vec2 off = dc * uChroma * 0.012;
        col.r = texture2D(tDiffuse, uv + off).r;
        col.b = texture2D(tDiffuse, uv - off).b;
      }
      col = col * uGain + uLift * (1.0 - col);
      // gentle S-curve around mid grey + saturation
      col = clamp((col - 0.45) * uContrast + 0.45, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.25);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = mix(col, vec3(l) * vec3(0.95, 0.97, 1.05), uDesat);
      vec2 vd = dc * vec2(uAspect, 1.0);
      float v = smoothstep(0.35, 1.05, length(vd) * 1.25);
      col *= 1.0 - v * uVignette;
      col += (hash(uv * 800.0) - 0.5) * 0.018;
      col = mix(col, uFadeColor, uFade);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 3000);

    const size = r.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.45, 1.25);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.grade.uniforms.uAspect.value = w / h;
    this.onResize && this.onResize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }

  render(t) {
    this.grade.uniforms.uTime.value = t;
    this.composer.render();
  }
}
