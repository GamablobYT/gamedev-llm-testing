# HALCYON — Art Direction

Three candidate directions were written before any asset was built. They differ in world,
value structure, and material language, not just palette.

---

## A. "Vermilion Rite": ink duel on a chalk field

- **Concept:** A ceremonial duel in a white chalk quarry cut into terraces. The world is drawn
  like sumi-e: bone-white planes, black ink contours, and one colour, vermilion, reserved
  entirely for danger and life.
- **Mood:** Severe, silent, ritual.
- **Palette:** Chalk white `#EDEAE2`, ink `#15131A`, vermilion `#E0371F`. Nothing else.
- **Materials:** Flat toon bands, heavy inverted-hull outlines, paper grain overlay.
- **Creature shape language:** A folded origami-like mantis. Straight creases, knife planes.
- **Environment shape language:** Stepped rectilinear terraces, long horizontal cuts.
- **Lighting:** Almost none. Flat overcast; form is carried by outline and a two-tone ramp.
- **VFX:** Ink splatter, brush-stroke slashes, red spray on hit.
- **Emotional effect:** The held breath before a single decisive cut.
- **Risk:** Tends toward pastiche (Okami, Sekiro). Toon outlines also cost a lot and clash
  with glTF skinning. A nearly monochrome field gives little atmospheric depth.

## B. "Pollen Noon": overexposed flower basin

- **Concept:** A sun-blasted hilltop crater filled with giant waxy flowers. The boss is a
  velvet moth-beetle pollinator, bloated and territorial.
- **Mood:** Drowsy, hot, uncanny-pleasant.
- **Palette:** Marigold, chartreuse, bleached cream sky, violet shadows.
- **Materials:** Soft subsurface wax, fuzzy fresnel velvet, dusty pollen haze.
- **Creature shape language:** Round, soft, heavy. Bulbous abdomen, fan wings.
- **Environment shape language:** Radial petals, domes, concentric bowls.
- **Lighting:** High noon, hard top light, bounced warm fill, heavy bloom.
- **VFX:** Pollen puffs, spore clouds, petal confetti.
- **Emotional effect:** Wrongness under beauty, a pleasant place turned hostile.
- **Risk:** High-key everywhere makes telegraphs hard to read. Soft round shapes read as
  harmless, and pollen clutter competes with gameplay VFX.

## C. "Still Water": blue hour on a flooded salt mirror  ← **CHOSEN**

- **Concept:** An endless flooded salt flat at blue hour. A film of water turns the ground
  into a mirror of the sky. Out here a colossal stilt-legged wader, part heron and part
  harvestman, carries a salt-crystal shell on its back and a lantern organ beneath its
  body. It keeps the water still.
- **Mood:** Hushed, vast, melancholic, beautiful. Then, in phase two, nocturnal and feverish.
- **Palette:** Sky peach `#F2B8A0` → lavender `#B7A6CF` → cobalt `#2B3A6E`; salt white
  `#E9E4EE`; creature ink-indigo `#141626`; *coral lantern* `#FF6A5A` (boss danger);
  *marigold* `#F2B33D` (player identity); pale cyan-white (player strikes).
- **Materials:** Glossy black-indigo lacquer carapace with a cool rim. Translucent pale salt
  crystal. Matte cloth for the player. The floor is wet salt: hexagonal crust ridges
  (dry, matte) around mirror-wet cells.
- **Creature shape language:** *Needles and a lamp.* A dense body raised high on four
  harvestman legs whose knees rise above the body, plus a long S-neck ending in a spear
  beak. Everything that hurts is a point: legs pierce, the beak lances. The one soft, round
  shape is the lantern, which is the weak point and the tell.
- **Environment shape language:** Horizontal, with nothing but the horizon line. Vertical
  accents are hexagonal salt columns and the needle-bones of a dead predecessor, echoing the
  boss's legs. Hex cells on the floor let the player read distance.
- **Lighting:** Phase 1 has a low sun just below the horizon, a warm rim, cool sky fill and
  long shadows. The environment is light and the creature is dark, so its silhouette owns
  the frame. Phase 2 inverts this: the sun is gone, stars reflect in the mirror, the shell
  shatters, and the creature's lantern and veins become the key light, making a light
  creature in a dark world.
- **VFX:** Ripple rings on the mirror are the main effect language: footsteps, stabs and
  shockwaves all write to the water. Telegraphs are thin coral lines that fill up over the
  windup, drawn on the water. Strikes are thin pale arcs. Salt crystal shards and water spray
  on impact. No fire, no smoke.
- **Emotional effect:** A small person standing on the sky, dueling something ancient and
  quiet. Awe first, then dread, then stillness.

### Why C

- **Screenshot identity.** A mirror floor doubles every silhouette. A dark stilt creature
  standing on a reflected peach sky is instantly recognisable, and it avoids the brown
  ruins and torches of generic dark fantasy.
- **The world is the gameplay UI.** Water ripples are a natural, diegetic carrier for
  telegraphs, shockwaves, and footstep rhythm. The hex crust gives distance cues an
  otherwise featureless plain would lack.
- **Anatomy, attacks and place agree.** A wader belongs in shallow water. Stilt legs explain
  the piercing stomps. A heron neck explains the lance and the sweep. A lantern under the
  body explains the ring pulse and gives a soft target.
- **Phase 2 changes the image as well as the numbers.** The lighting inverts (dusk to night,
  dark creature to glowing creature), the shell breaks, new terrain appears (salt spires),
  and the boss starts vaulting across the arena.
- **Feasible.** Mostly smooth procedural forms and gradient lighting, which suits
  script-driven Blender modelling and a WebGL renderer. A and B each depend on expensive
  stylisation, heavy outlines or dense foliage, to land.

### Rules to hold to

1. Coral means boss danger and nothing else. Marigold means the player.
2. The environment stays high-key in phase 1. The darkest values in the frame belong to the
   boss.
3. No prop without a job: landmark, scale reference, leading line, or story.
4. Effects go on the water first, then in the air, and sparingly.
