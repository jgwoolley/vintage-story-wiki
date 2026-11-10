// An outdoor backdrop for the voxel viewer (voxelViewer.ts `setEnvironment`): a grass ground plane out to the horizon and a sky dome,
// instead of the grey floor slab and the page background. It is for still renders and previews of a model or schematic "in the world".
//
// With the game's own images (a client install's assets; the wiki never has them) it draws what the game draws:
// - the sky is a port of the colour lookup in the game's shaderincludes/skycolor.fsh (`getSkyColorAt`, without its fog, dither and
//   godrays): sky.png is indexed by the sun's height (u) and pow(1 - view elevation, 0.25) (v), and sunlight.png adds the glow around
//   the sun (alpha-blended, v = how far the view is from the sun);
// - the ground is the top of the creativegrass block (block/plant/grasscoverage/normal-top.png, one tile per block) multiplied by its
//   `climatePlantTint` colour map (environment/planttint.png, 4 px padding; x = temperature, y = rainfall, as shaderincludes/colormap.vsh
//   reads it) at one fixed temperate climate. The seasonal grass map and frost are left out.
// Without them both are drawn from built-in colours. The ground and the model fade into the horizon colour with distance (three.js fog),
// so the edge of the plane never shows.
import * as THREE from "three";
import type { TextureImage } from "./voxelViewer.js";

/** The game images the environment draws with; any one missing is drawn from built-in colours. */
export interface EnvironmentImages {
  /** survival textures/block/plant/grasscoverage/normal-top.png */
  grass?: TextureImage;
  /** game textures/environment/planttint.png (the climatePlantTint colour map) */
  plantTint?: TextureImage;
  /** game textures/environment/sky.png */
  sky?: TextureImage;
  /** game textures/environment/sunlight.png */
  sunlight?: TextureImage;
}

export interface ViewerEnvironment {
  /** A grass ground plane at the data-space y = 0 plane (where `setFloor` draws), out to the horizon. */
  grass?: boolean;
  /** A sky dome behind everything. */
  sky?: boolean;
  images?: EnvironmentImages;
}

/** The climate the grass is tinted for: tempRel/rainfallRel in 0..1, as the game packs them into a block's colormap data. */
export const GRASS_CLIMATE = { temperature: 0.6, rainfall: 0.7 };
/** planttint.png's padding (config/colormaps.json). */
const COLORMAP_PADDING = 4;

// Built-in colours: roughly the game's midday sky.png column and a mid-green grass.
const FALLBACK_ZENITH = "#3b56c4";
const FALLBACK_HORIZON = "#93abd4";
const FALLBACK_GRASS = [0x5d, 0x8c, 0x3a];

/** What the viewer hands the environment each frame. */
export interface EnvironmentFrame {
  camera: THREE.PerspectiveCamera;
  /** The point the camera orbits. */
  target: THREE.Vector3;
}

export interface Environment {
  /** Follows the camera (the sky is centred on it, the ground under it) and sets the fog for its distance. Call before each render. */
  update(frame: EnvironmentFrame): void;
  dispose(): void;
}

export interface EnvironmentPlacement {
  /** World y of the ground. */
  groundY: number;
  /** Data units per block: one grass tile each. */
  cell: number;
  /** World x/z of a block edge, so tiles line up with the blocks. */
  edgeX: number;
  edgeZ: number;
  /** Radius of the model's bounding sphere: the fog starts beyond it. */
  radius: number;
  /** Direction to the sun (the viewer's directional light). */
  sun: THREE.Vector3;
  /** For anisotropic filtering of the ground. */
  renderer: THREE.WebGLRenderer;
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext("2d", { willReadFrequently: true })!];
}

/** The colour (CSS hex) of `image` at fractional position (u, v) from its top left. */
function sampleImage(image: TextureImage, u: number, v: number): string {
  const [, ctx] = canvasOf(image.width, image.height);
  ctx.drawImage(image, 0, 0);
  const x = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
  const y = Math.min(image.height - 1, Math.max(0, Math.floor(v * image.height)));
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** The climate tint at GRASS_CLIMATE, read the way colormap.vsh does (rect = the map inside its padding). */
export function grassTint(plantTint: TextureImage): string {
  const inner = (size: number, rel: number) => (COLORMAP_PADDING + (size - 2 * COLORMAP_PADDING) * rel) / size;
  return sampleImage(plantTint, inner(plantTint.width, GRASS_CLIMATE.temperature), inner(plantTint.height, GRASS_CLIMATE.rainfall));
}

/** A 16x16 mottled green tile (deterministic), for when there is no grass texture. */
function fallbackGrass(): HTMLCanvasElement {
  const [canvas, ctx] = canvasOf(16, 16);
  const image = ctx.createImageData(16, 16);
  let seed = 0x2f6b1d;
  const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) / 0x1000000;
  for (let i = 0; i < 256; i++) {
    const shade = 0.82 + random() * 0.3;
    image.data.set([...FALLBACK_GRASS.map((c) => Math.min(255, Math.round(c * shade))), 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** A stand-in for sky.png: every column the same zenith-to-horizon gradient (so the sun's height doesn't matter). */
function fallbackSky(): HTMLCanvasElement {
  const [canvas, ctx] = canvasOf(2, 64);
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, FALLBACK_ZENITH);
  gradient.addColorStop(1, FALLBACK_HORIZON);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 64);
  return canvas;
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// getSkyColorAt from the game's skycolor.fsh: Ks = sky(u, pow(1 - y, 0.25)), Kg = glow(u, 1 - vl); colour = Ks * (1 - Kg.a) + Kg * Kg.a.
// Textures are uploaded unflipped, so v = 0 is the image's top row, as the game samples them; colours pass through unconverted.
const SKY_FRAGMENT = /* glsl */ `
uniform sampler2D sky;
uniform sampler2D glow;
uniform float hasGlow;
uniform vec3 sunPosition;
varying vec3 vDirection;
void main() {
  vec3 direction = normalize(vDirection);
  float u = (sunPosition.y + 1.0) / 2.0;
  float invHorizonDistance = pow(max(0.0, 1.0 - direction.y), 0.25);
  vec4 Ks = texture2D(sky, vec2(u, invHorizonDistance));
  float vl = 1.0 - clamp(distance(direction, sunPosition) / 6.0, 0.0, 1.0);
  vec4 Kg = hasGlow > 0.5 ? texture2D(glow, vec2(clamp(u, 0.0, 1.0), 1.0 - vl)) : vec4(0.0);
  gl_FragColor = vec4(Ks.rgb * (1.0 - Kg.a) + Kg.rgb * Kg.a, 1.0);
}`;

function rawTexture(image: TextureImage): THREE.Texture {
  const t = new THREE.Texture(image);
  t.flipY = false;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Adds the environment to `scene` (sets `scene.fog`). */
export function createEnvironment(scene: THREE.Scene, env: ViewerEnvironment, at: EnvironmentPlacement): Environment {
  const images = env.images ?? {};
  const sun = at.sun.clone().normalize();
  const disposables: { dispose(): void }[] = [];
  const objects: THREE.Object3D[] = [];

  // The horizon colour (the bottom row of the sky texture's column for this sun height) is the fog colour, so far ground meets the sky.
  const skyImage = images.sky ?? fallbackSky();
  const horizon = sampleImage(skyImage, (sun.y + 1) / 2, 1);
  const fog = new THREE.Fog(horizon, 1, 2);
  scene.fog = fog;

  let sky: THREE.Mesh | undefined;
  if (env.sky) {
    const skyTexture = rawTexture(skyImage);
    const glowTexture = rawTexture(images.sunlight ?? skyImage);
    const material = new THREE.ShaderMaterial({
      uniforms: { sky: { value: skyTexture }, glow: { value: glowTexture }, hasGlow: { value: images.sunlight ? 1 : 0 }, sunPosition: { value: sun } },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const geometry = new THREE.SphereGeometry(1, 48, 24);
    sky = new THREE.Mesh(geometry, material);
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    disposables.push(skyTexture, glowTexture, material, geometry);
    objects.push(sky);
  }

  let ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial> | undefined;
  let groundTexture: THREE.Texture | undefined;
  if (env.grass) {
    groundTexture = new THREE.Texture(images.grass ?? fallbackGrass());
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.magFilter = THREE.NearestFilter;
    groundTexture.minFilter = THREE.LinearMipmapLinearFilter;
    groundTexture.anisotropy = at.renderer.capabilities.getMaxAnisotropy();
    groundTexture.needsUpdate = true;
    const tint = images.grass && images.plantTint ? grassTint(images.plantTint) : "#ffffff";
    const material = new THREE.MeshLambertMaterial({ map: groundTexture, color: tint });
    const geometry = new THREE.PlaneGeometry(1, 1);
    ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    // A hair below y = 0, so the bottom faces of blocks standing on it don't z-fight with it.
    ground.position.y = at.groundY - at.cell * 0.002;
    ground.frustumCulled = false;
    disposables.push(groundTexture, material, geometry);
    objects.push(ground);
  }
  scene.add(...objects);

  const fraction = (n: number) => n - Math.floor(n);
  return {
    update({ camera, target }) {
      const distance = camera.position.distanceTo(target);
      fog.near = distance + at.radius * 2;
      fog.far = Math.max(fog.near * 1.5, camera.far * 0.8);
      if (sky) {
        sky.position.copy(camera.position);
        sky.scale.setScalar(camera.far * 0.9);
      }
      if (ground && groundTexture) {
        // Centred under the camera and as wide as it can see, so it always reaches past the fog; the texture offset keeps each tile on its block.
        const size = camera.far * 2;
        const tiles = size / at.cell;
        ground.scale.set(size, size, 1);
        ground.position.x = camera.position.x;
        ground.position.z = camera.position.z;
        groundTexture.repeat.set(tiles, tiles);
        groundTexture.offset.set(
          fraction(-((at.edgeX - ground.position.x) / at.cell + tiles / 2)),
          fraction(-(-(at.edgeZ - ground.position.z) / at.cell + tiles / 2)),
        );
      }
    },
    dispose() {
      for (const o of objects) scene.remove(o);
      if (scene.fog === fog) scene.fog = null;
      for (const d of disposables) d.dispose();
    },
  };
}
