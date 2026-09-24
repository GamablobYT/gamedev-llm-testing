import * as THREE from 'three';
import { Atmosphere } from './atmosphere.js';
import { Sky } from './sky.js';
import { Water } from './water.js';

export const ARENA_R = 36;

/** Scene lighting, sky, mirror water, arena set dressing and environment reflections. */
export class World {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.atmo = new Atmosphere();
    this.sky = new Sky(this.atmo);
    scene.add(this.sky.mesh);
    this.water = new Water(this.atmo);
    scene.add(this.water.mesh);
    scene.fog = new THREE.FogExp2(0xffffff, 0.004);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    Object.assign(s.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 260 });
    s.bias = -0.0006; s.normalBias = 0.04; s.radius = 2;
    scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8899ff, 0);
    scene.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(this.hemi);

    // environment map rendered from the sky only (for glossy carapace + crystal reflections)
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(this.atmo);
    this.envScene.add(this.envSky.mesh);
    this.envTimer = 0;
    this.focus = new THREE.Vector3();
  }

  async load(gltfLoader) {
    const gltf = await gltfLoader.loadAsync('assets/arena.glb');
    const root = gltf.scene;
    const mats = {
      AR_Salt: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0, flatShading: true, envMapIntensity: 0.35 }),
      AR_Bone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.6 }),
      AR_Wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      AR_Cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color(0.25, 0.1, 0.0) }),
      // phase-2 spires: darker salt that glows faintly from within, fades when it blocks the view
      Spire: new THREE.MeshStandardMaterial({ vertexColors: true, color: new THREE.Color(0.55, 0.55, 0.7), roughness: 0.45, flatShading: true,
        envMapIntensity: 0.5, emissive: new THREE.Color(0.1, 0.12, 0.3), transparent: true, opacity: 1 }),
    };
    this.mesaMat = new THREE.MeshBasicMaterial({ color: 0x777788, fog: false });
    root.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material.name;
      if (o.name.startsWith('Horizon') || name === 'AR_Ridge') { o.material = this.mesaMat; o.renderOrder = -900; return; }
      o.material = mats[name] || mats.AR_Salt;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.spireTemplate = root.getObjectByName('Spire');
    if (this.spireTemplate) this.spireTemplate.removeFromParent();
    this.scene.add(root);
    this.arena = root;
    this.mats = mats;
  }

  /** landmarks that the player and camera collide with (x, z, r) */
  get obstacles() {
    return [{ x: 30, z: -40, r: 2.2 }, { x: -46, z: -12, r: 4 }, { x: -30, z: 38, r: 3 }];
  }

  applyAtmosphere() {
    const a = this.atmo.cur;
    this.sun.color.copy(a.sunColor); this.sun.intensity = a.sunI;
    this.moon.color.copy(a.moonColor); this.moon.intensity = a.moonI;
    this.hemi.color.copy(a.hemiSky); this.hemi.groundColor.copy(a.hemiGround); this.hemi.intensity = a.hemiI;
    this.scene.fog.color.copy(a.fog); this.scene.fog.density = a.fogDensity;
    this.renderer.toneMappingExposure = a.exposure;
    this.mesaMat.color.copy(a.horizon).lerp(a.mid, 0.45).multiplyScalar(0.8);
    this.water.sync();
  }

  update(dt, time, focus) {
    this.atmo.update(dt);
    this.sky.update(time);
    this.water.uniforms.uTime.value = time;
    this.applyAtmosphere();
    // the shadow frustum follows the fight
    this.focus.copy(focus);
    const a = this.atmo.cur;
    const lightDir = a.sunI > 0.05 ? a.sunDir : a.moonDir;
    const shadowLight = a.sunI > 0.05 ? this.sun : this.moon;
    this.sun.castShadow = shadowLight === this.sun;
    this.moon.castShadow = shadowLight === this.moon;
    if (this.moon.castShadow && !this.moon.shadow.map) {
      Object.assign(this.moon.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 260 });
      this.moon.shadow.mapSize.set(2048, 2048); this.moon.shadow.bias = -0.0006; this.moon.shadow.normalBias = 0.04;
    }
    for (const L of [this.sun, this.moon]) {
      const d = L === this.sun ? a.sunDir : a.moonDir;
      L.position.copy(focus).addScaledVector(d.y > 0.02 ? d : lightDir, 120);
      L.target.position.copy(focus);
      L.target.updateMatrixWorld();
    }
    // refresh env map occasionally, continuously while the sky is changing
    this.envTimer -= dt;
    if (!this.envRT || (this.atmo.blending && this.envTimer <= 0) || this.atmo.changed && this.envTimer <= -1) {
      this.envSky.update(time);
      const old = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
      this.scene.environment = this.envRT.texture;
      if (old) old.dispose();
      this.envTimer = 0.2;
    }
  }
}
