// Quick GLB inspector: lists nodes, meshes, materials, animations and their channels.
import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const verbose = process.argv.includes('-v');
console.log('nodes', gltf.nodes.length, 'meshes', (gltf.meshes || []).length, 'skins', (gltf.skins || []).length);
console.log('materials', (gltf.materials || []).map(m => m.name).join(', '));
if (verbose) gltf.nodes.forEach((n, i) => console.log(' node', i, n.name, n.mesh !== undefined ? '(mesh)' : '', n.children ? 'children:' + n.children.length : ''));
for (const m of gltf.meshes || []) {
  let tris = 0;
  for (const p of m.primitives) tris += gltf.accessors[p.indices].count / 3;
  console.log(' mesh', m.name, 'tris', tris, 'attrs', Object.keys(m.primitives[0].attributes).join(','));
}
for (const a of gltf.animations || []) {
  const targets = new Set(a.channels.map(c => gltf.nodes[c.target.node].name + '.' + c.target.path));
  const s0 = a.samplers[0];
  const acc = gltf.accessors[s0.input];
  console.log(' anim', a.name, 'channels', a.channels.length, 'dur', acc.max && acc.max[0].toFixed(2));
  if (verbose) console.log('   ', [...targets].join(' '));
}
console.log('bytes', buf.length);
