// Generic 3D voxel viewer: draws a list of unit cubes on a grid with orbit/zoom/pan controls.
// Deliberately knows nothing about where its voxels came from -- recipe patterns
// (the wiki's assets/recipeVoxels.js) are one caller; schematics (schematicVoxels.ts) are the
// other, feeding it decoded Indices/BlockIds instead. Keep recipe- or
// schematic-specific logic in those adapters, not here.
//
// Rendering is one InstancedMesh per distinct opacity (colors are per-instance), so cost scales
// with voxel count, not with the number of distinct colors/block codes -- unlike the original
// schematic-preview project's one-Mesh-per-block approach, which gets slow on large schematics.
// Frames are rendered on demand (camera change / resize / restyle), never in a continuous loop.
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";

/**
 * Integer grid position (y is up) plus a default color. Callers may attach any other fields
 * (layer index, block code, ...) -- they're passed back untouched to `setStyle`/`pick`.
 */
export interface ViewerVoxel {
  x: number;
  y: number;
  z: number;
  color?: THREE.ColorRepresentation;
  /** Box size along each axis (default 1); x/y/z is then the box's center. Used for chiseled-block cuboids. */
  sx?: number;
  sy?: number;
  sz?: number;
}

/** `null` hides the voxel; `opacity < 1` draws it as a translucent ghost. */
export type VoxelStyle = { color?: THREE.ColorRepresentation; opacity?: number } | null;

export interface VoxelViewerOptions<V extends ViewerVoxel> {
  voxels: V[];
  /** Accessible name of the canvas. */
  label?: string;
  /** Default camera offset direction from the model's center (y up). */
  viewDirection?: [number, number, number];
}

export interface VoxelViewer<V extends ViewerVoxel> {
  /** Restyle every voxel; omit `styleFn` to show all voxels plainly. Rebuilds the instanced meshes. */
  setStyle(styleFn?: (voxel: V, index: number) => VoxelStyle): void;
  resetView(): void;
  /** The voxel under a viewport point (e.g. a click), or null. Only opaque voxels are pickable. */
  pick(clientX: number, clientY: number): { voxel: V; index: number } | null;
  dispose(): void;
  render(): void;
}

const DEFAULT_COLOR = "#9a8f80";

// A white tile with a darker 1px border, multiplied by each instance's color: gives every cube
// visible grid edges, which is what makes a solid blob of same-colored cubes readable as voxels.
function edgeTexture(): THREE.CanvasTexture {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

/**
 * Mount a viewer into `container` (which should have a CSS height). Returns null if WebGL is
 * unavailable, so callers can leave their non-3D fallback in place.
 */
export function createVoxelViewer<V extends ViewerVoxel>(
  container: HTMLElement,
  { voxels, label = "3D voxel view", viewDirection = [1, 1.1, 1.4] }: VoxelViewerOptions<V>,
): VoxelViewer<V> | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (err) {
    console.warn("voxelViewer: WebGL unavailable", err);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", label);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Fixed (not camera-attached) lights, so top/side faces always shade differently from each
  // other -- orientation stays legible while orbiting.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.6, 1, 0.35);
  scene.add(sun);

  // Center the model's bounding box on the origin.
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const v of voxels) {
    const half = new THREE.Vector3((v.sx ?? 1) / 2, (v.sy ?? 1) / 2, (v.sz ?? 1) / 2);
    min.min(new THREE.Vector3(v.x, v.y, v.z).sub(half));
    max.max(new THREE.Vector3(v.x, v.y, v.z).add(half));
  }
  if (!voxels.length) {
    min.set(-0.5, -0.5, -0.5);
    max.set(0.5, 0.5, 0.5);
  }
  const extent = new THREE.Vector3().subVectors(max, min);
  const offset = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.addEventListener("change", render);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const texture = edgeTexture();
  const meshes: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>[] = [];
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  function render(): void {
    renderer.render(scene, camera);
  }

  function resize(): void {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  }

  function resetView(): void {
    const radius = extent.length() / 2;
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
    const dir = new THREE.Vector3(...viewDirection).normalize();
    camera.position.copy(dir.multiplyScalar(distance));
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 0.5;
    controls.maxDistance = distance * 4;
    controls.update();
    render();
  }

  // Rebuilds the instanced meshes (cheap at the sizes this is used for).
  function setStyle(styleFn?: (voxel: V, index: number) => VoxelStyle): void {
    for (const mesh of meshes) {
      scene.remove(mesh);
      mesh.material.dispose();
      mesh.dispose();
    }
    meshes.length = 0;

    const byOpacity = new Map<number, { voxel: V; index: number; color: THREE.ColorRepresentation }[]>();
    voxels.forEach((voxel, index) => {
      const style = styleFn ? styleFn(voxel, index) : {};
      if (style === null) return;
      const opacity = style.opacity ?? 1;
      if (!byOpacity.has(opacity)) byOpacity.set(opacity, []);
      byOpacity.get(opacity)!.push({ voxel, index, color: style.color ?? voxel.color ?? DEFAULT_COLOR });
    });

    for (const [opacity, entries] of byOpacity) {
      const translucent = opacity < 1;
      const material = new THREE.MeshLambertMaterial({
        map: texture,
        transparent: translucent,
        opacity,
        depthWrite: !translucent,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      mesh.renderOrder = translucent ? 1 : 0;
      entries.forEach(({ voxel, color: c }, i) => {
        matrix.makeScale(voxel.sx ?? 1, voxel.sy ?? 1, voxel.sz ?? 1);
        matrix.setPosition(voxel.x - offset.x, voxel.y - offset.y, voxel.z - offset.z);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, color.set(c));
      });
      mesh.userData.voxelIndices = entries.map((e) => e.index);
      meshes.push(mesh);
      scene.add(mesh);
    }
    render();
  }

  function pick(clientX: number, clientY: number): { voxel: V; index: number } | null {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes.filter((m) => !m.material.transparent))[0];
    if (!hit || hit.instanceId === undefined) return null;
    const index: number = hit.object.userData.voxelIndices[hit.instanceId];
    return { voxel: voxels[index], index };
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  function dispose(): void {
    resizeObserver.disconnect();
    controls.dispose();
    for (const mesh of meshes) mesh.material.dispose();
    geometry.dispose();
    texture.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  setStyle();
  resize();
  resetView();

  return { setStyle, resetView, pick, dispose, render };
}
