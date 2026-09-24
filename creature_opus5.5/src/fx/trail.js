import * as THREE from 'three';

/** Ribbon following the glaive blade (base..tip) for a short history window. */
export class Trail {
  constructor(scene, segments = 18) {
    this.n = segments;
    this.samples = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 2 * 3);
    this.alpha = new Float32Array(this.n * 2);
    this.side = new Float32Array(this.n * 2);
    const idx = [];
    for (let i = 0; i < this.n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i < this.n; i++) { this.side[i * 2] = 0; this.side[i * 2 + 1] = 1; }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.8, 0.95, 1.0).multiplyScalar(2.2) }, uI: { value: 1 } },
      vertexShader: `attribute float aAlpha; attribute float aSide; varying float vA; varying float vS;
        void main(){ vA = aAlpha; vS = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uI; varying float vA; varying float vS;
        void main(){ float a = vA * smoothstep(0.0, 0.7, vS) * (0.35 + 0.65 * vS) * uI; if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * (0.7 + vS), a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    scene.add(this.mesh);
    this.emitting = false;
    this.life = 0.13;
  }
  push(base, tip, t) {
    if (this.emitting) this.samples.push({ b: base.clone(), t: tip.clone(), time: t });
    while (this.samples.length && t - this.samples[0].time > this.life) this.samples.shift();
    while (this.samples.length > this.n) this.samples.shift();
    const S = this.samples, m = S.length;
    for (let i = 0; i < this.n; i++) {
      const s = S[Math.max(0, m - this.n + i)] || S[m - 1];
      const k = i * 2;
      if (!s) { this.alpha[k] = this.alpha[k + 1] = 0; continue; }
      this.pos.set([s.b.x, s.b.y, s.b.z], k * 3);
      this.pos.set([s.t.x, s.t.y, s.t.z], (k + 1) * 3);
      const age = (t - s.time) / this.life;
      const a = m - this.n + i < 0 ? 0 : Math.max(0, 1 - age);
      this.alpha[k] = this.alpha[k + 1] = a * a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
