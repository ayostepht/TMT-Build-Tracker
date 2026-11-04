/**
 * three.js scene behind ChairViewer.svelte: loads the template GLB (+ optional hardware GLB),
 * instances every placed part with its own material, and handles camera, picking, highlight,
 * snapshots and disposal. Browser only; load it through `loadLibs()` so SSR never imports three.
 */
import type * as T from 'three';
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PartPlacement } from '#lib/domain/types.ts';
import {
	aabbUnion,
	fitMountFrame,
	frontCasterAnchors,
	harnessLayout,
	rearCasterAnchor,
	DEFAULT_GROUND_Y,
	type Aabb,
	type MountFrame,
	type Vec3
} from '#lib/domain/standins.ts';
import { keepBodiesIndex, PART_CLIPS } from '#lib/domain/part-clips.ts';
import { fitDistance, fitDistanceBox } from './fit.ts';
import { isTap, resolvePick } from './picking.ts';
import { buildBuckle, buildCaster, buildRibbon } from './standins.ts';

export interface Libs {
	THREE: typeof T;
	GLTFLoader: typeof GLTFLoader;
	OrbitControls: typeof OrbitControls;
	MeshoptDecoder: unknown;
	RoomEnvironment: new () => T.Scene;
}

export async function loadLibs(): Promise<Libs> {
	const [THREE, gltf, orbit, meshopt, room] = await Promise.all([
		import('three'),
		import('three/addons/loaders/GLTFLoader.js'),
		import('three/addons/controls/OrbitControls.js'),
		import('three/addons/libs/meshopt_decoder.module.js'),
		import('three/addons/environments/RoomEnvironment.js')
	]);
	return {
		THREE,
		GLTFLoader: gltf.GLTFLoader,
		OrbitControls: orbit.OrbitControls,
		MeshoptDecoder: meshopt.MeshoptDecoder,
		RoomEnvironment: room.RoomEnvironment as unknown as Libs['RoomEnvironment']
	};
}

/** True when a WebGL context can be created (probe, without loading three). */
export function webglAvailable(): boolean {
	try {
		const c = document.createElement('canvas');
		const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
		if (!gl) return false;
		gl.getExtension('WEBGL_lose_context')?.loseContext();
		return true;
	} catch {
		return false;
	}
}

export interface SceneCallbacks {
	onpick(slug: string | null): void;
	onready(info: { rendered: string[]; unplaced: string[] }): void;
	onprogress(fraction: number): void;
}

interface Prim {
	geometry: T.BufferGeometry;
	base: T.Matrix4;
}
interface Instance {
	meshes: T.Mesh[];
	material: T.MeshStandardMaterial;
}

const NEUTRAL = '#b9bdc6';
const HIGHLIGHT = 0x3b82f6;
const DIR = [0.9, 0.6, 1.1];
/** Named camera directions (from the chair's centre; +z is the front of the chair, +x its left). */
export const VIEWS = {
	front34: DIR,
	front: [0, 0.25, 1],
	side: [1, 0.2, 0],
	back34: [-0.9, 0.6, -1.1],
	back: [0, 0.3, -1],
	top: [0, 1, 0.001]
} as const;
export type ViewName = keyof typeof VIEWS;

export class ChairScene {
	private THREE: typeof T;
	private renderer: T.WebGLRenderer;
	private scene: T.Scene;
	private camera: T.PerspectiveCamera;
	private controls: OrbitControls;
	private parts: T.Group;
	private hardware: T.Group;
	private raycaster: T.Raycaster;
	private env: T.Texture | null = null;
	private hwMaterial: T.MeshStandardMaterial;
	private treadMaterial: T.MeshStandardMaterial;
	/** Procedural casters (always drawn; the hardware GLB's own casters are hidden). */
	private casters: T.Group;
	private standinOwned: { dispose(): void }[] = [];
	private showHardware = true;

	private prims = new Map<string, Prim[]>(); // slug -> geometry
	private instances = new Map<string, Instance[]>(); // slug -> rendered instances
	private pickables: T.Mesh[] = [];
	private owned: { dispose(): void }[] = [];
	private hwOwned: { dispose(): void }[] = [];

	private colors: Record<string, string> = {};
	private hidden = new Set<string>();
	private selected: string | null = null;
	private dim = false;
	private placements: PartPlacement[] = [];
	private autoRotate = false;
	private reduceMotion = false;
	private loaded = false;
	private fitted = false;
	private loadGen = 0;
	private lastInfo = '';

	private raf = 0;
	private dirty = true;
	private inView = true;
	private userMoved = false;
	private disposed = false;
	private radius = 500;
	private fitBox: T.Box3 | null = null;
	private center: T.Vector3;
	private anim: {
		t0: number;
		ms: number;
		fromT: T.Vector3;
		toT: T.Vector3;
		fromP: T.Vector3;
		toP: T.Vector3;
	} | null = null;
	private io: IntersectionObserver | null = null;
	private ro: ResizeObserver | null = null;
	private down: { x: number; y: number; t: number } | null = null;
	private cleanup: (() => void)[] = [];

	constructor(
		private libs: Libs,
		private canvas: HTMLCanvasElement,
		private host: HTMLElement,
		private cb: SceneCallbacks
	) {
		const THREE = (this.THREE = libs.THREE);
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.0;
		this.scene = new THREE.Scene();
		const pmrem = new THREE.PMREMGenerator(this.renderer);
		this.env = pmrem.fromScene(new libs.RoomEnvironment(), 0.04).texture;
		pmrem.dispose();
		this.scene.environment = this.env;
		this.scene.environmentIntensity = 0.55;
		const key = new THREE.DirectionalLight(0xffffff, 1.6);
		key.position.set(600, 900, 700);
		this.scene.add(key, new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 0.5));
		this.camera = new THREE.PerspectiveCamera(32, 1, 1, 10000);
		this.parts = new THREE.Group();
		this.hardware = new THREE.Group();
		this.casters = new THREE.Group();
		this.scene.add(this.parts, this.hardware, this.casters);
		this.raycaster = new THREE.Raycaster();
		this.center = new THREE.Vector3();
		this.hwMaterial = new THREE.MeshStandardMaterial({
			color: 0x8c919c,
			roughness: 0.45,
			metalness: 0.55
		});

		this.treadMaterial = new THREE.MeshStandardMaterial({
			color: 0x2f3138,
			roughness: 0.85,
			metalness: 0
		});

		this.controls = new libs.OrbitControls(this.camera, canvas);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.12;
		this.controls.screenSpacePanning = true;
		this.controls.rotateSpeed = 0.8;
		this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
		this.controls.addEventListener('start', () => (this.userMoved = true));
		this.controls.addEventListener('change', () => (this.dirty = true));

		this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
		this.listen(canvas, 'pointerdown', (e) => {
			this.down = {
				x: (e as PointerEvent).clientX,
				y: (e as PointerEvent).clientY,
				t: performance.now()
			};
		});
		this.listen(canvas, 'pointerup', (e) => {
			const d = this.down;
			this.down = null;
			const pe = e as PointerEvent;
			if (!isTap(d, { x: pe.clientX, y: pe.clientY, t: performance.now() })) return; // a drag
			this.pick(pe.clientX, pe.clientY);
		});
		this.listen(canvas, 'pointercancel', () => (this.down = null));
		this.listen(canvas, 'webglcontextlost', (e) => e.preventDefault());
		this.listen(canvas, 'webglcontextrestored', () => (this.dirty = true));

		this.ro = new ResizeObserver(() => this.resize());
		this.ro.observe(host);
		this.io = new IntersectionObserver((entries) => {
			this.inView = entries.some((e) => e.isIntersecting);
			this.kick();
		});
		this.io.observe(host);
		this.listen(document, 'visibilitychange', () => this.kick());
		this.resize();
		this.kick();
	}

	private listen(target: EventTarget, type: string, fn: (e: Event) => void) {
		target.addEventListener(type, fn);
		this.cleanup.push(() => target.removeEventListener(type, fn));
	}

	// ---- loading -----------------------------------------------------------------

	async loadModel(url: string, hardwareUrl: string | null): Promise<void> {
		const gen = ++this.loadGen;
		const loader = new this.libs.GLTFLoader();
		loader.setMeshoptDecoder(this.libs.MeshoptDecoder as never);
		const load = (u: string, weight: number, base: number) =>
			loader.loadAsync(u, (e) => {
				if (e.total) this.cb.onprogress(base + weight * (e.loaded / e.total));
			});
		const [main, hw] = await Promise.all([
			load(url, hardwareUrl ? 0.8 : 1, 0),
			hardwareUrl ? load(hardwareUrl, 0.2, 0.8).catch(() => null) : Promise.resolve(null)
		]);
		if (gen !== this.loadGen || this.disposed) {
			this.freeGltf(main);
			if (hw) this.freeGltf(hw);
			return;
		}
		this.installModel(main, hw);
	}

	private freeGltf(g: GLTF) {
		g.scene.traverse((o) => {
			const m = o as T.Mesh;
			if (m.isMesh) {
				m.geometry.dispose();
				([] as T.Material[]).concat(m.material).forEach((x) => x.dispose());
			}
		});
	}

	/** Raw glTF node name of the node an object came from (three strips ':' and '.' from `name`). */
	private rawName(gltf: GLTF, obj: T.Object3D): string {
		for (let o: T.Object3D | null = obj; o; o = o.parent) {
			const assoc = gltf.parser.associations.get(o);
			if (assoc && assoc.nodes !== undefined) {
				const def = gltf.parser.json.nodes?.[assoc.nodes];
				return def?.name ?? o.name;
			}
		}
		return obj.name;
	}

	private installModel(main: GLTF, hw: GLTF | null) {
		const THREE = this.THREE;
		this.clearModel();
		main.scene.updateMatrixWorld(true);
		const hwNodes: { geometry: T.BufferGeometry; matrix: T.Matrix4 }[] = [];
		main.scene.traverse((o) => {
			const mesh = o as T.Mesh;
			if (!mesh.isMesh) return;
			const name = this.rawName(main, mesh);
			this.owned.push(mesh.geometry);
			([] as T.Material[]).concat(mesh.material).forEach((m) => this.owned.push(m));
			if (name.startsWith('hw:')) {
				hwNodes.push({ geometry: mesh.geometry, matrix: mesh.matrixWorld.clone() });
				return;
			}
			const list = this.prims.get(name) ?? [];
			list.push({ geometry: mesh.geometry, base: mesh.matrixWorld.clone() });
			this.prims.set(name, list);
		});
		// Loose bodies the placement cannot serve (see part-clips.ts) are dropped whole, never sliced.
		for (const [slug, clip] of Object.entries(PART_CLIPS)) {
			for (const prim of this.prims.get(slug) ?? []) {
				const g = prim.geometry;
				const pos = g.getAttribute('position');
				const xyz = new Float32Array(pos.count * 3);
				for (let i = 0; i < pos.count; i++) xyz.set([pos.getX(i), pos.getY(i), pos.getZ(i)], 3 * i);
				const keep = keepBodiesIndex(xyz, g.index ? g.index.array : null, prim.base.elements, clip);
				if (!keep) continue;
				const filtered = new THREE.BufferGeometry();
				for (const [name, attr] of Object.entries(g.attributes)) filtered.setAttribute(name, attr);
				filtered.setIndex(new THREE.BufferAttribute(keep, 1));
				this.owned.push(filtered);
				prim.geometry = filtered;
			}
		}
		for (const n of hwNodes) {
			const m = new THREE.Mesh(n.geometry, this.hwMaterial);
			m.matrixAutoUpdate = false;
			m.matrix.copy(n.matrix);
			m.matrixWorldNeedsUpdate = true;
			this.hardware.add(m);
		}
		if (hw) {
			hw.scene.updateMatrixWorld(true);
			hw.scene.traverse((o) => {
				const m = o as T.Mesh;
				if (!m.isMesh) return;
				this.hwOwned.push(m.geometry);
				([] as T.Material[]).concat(m.material).forEach((x) => x.dispose());
				m.material = this.hwMaterial;
				// The stand-in casters replace the vendor casters; keep bolts, bearings and the like.
				if (/caster/i.test(this.rawName(hw, m))) m.visible = false;
			});
			this.hardware.add(hw.scene);
		}
		this.hardware.traverse((o) => {
			(o as T.Mesh).raycast = () => {};
		});
		this.hardware.visible = this.showHardware;
		this.loaded = true;
		this.rebuild();
		this.fit(false);
		this.cb.onprogress(1);
	}

	private clearModel() {
		this.clearInstances();
		for (const o of this.owned) o.dispose();
		for (const o of this.hwOwned) o.dispose();
		this.owned = [];
		this.hwOwned = [];
		this.prims.clear();
		this.fitted = false;
		this.hardware.clear();
	}

	// ---- parts -------------------------------------------------------------------

	private clearInstances() {
		this.removeStandins();
		for (const list of this.instances.values()) for (const i of list) i.material.dispose();
		this.instances.clear();
		this.parts.clear();
		this.pickables = [];
	}

	/** Recreates every part instance from the current placements (cheap: geometry is shared). */
	private rebuild() {
		if (!this.loaded) return;
		const THREE = this.THREE;
		this.clearInstances();
		const rendered: string[] = [];
		const known = new Set<string>(this.prims.keys());
		for (const p of this.placements) known.add(p.slug);
		for (const p of this.placements) {
			const prims = this.prims.get(p.slug);
			if (!p.placed || !prims || p.matrix.length !== 16) continue;
			rendered.push(p.slug);
			const list: Instance[] = [];
			for (const m of [p.matrix, ...p.instances]) {
				if (m.length !== 16) continue;
				const place = new THREE.Matrix4().fromArray(m);
				const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
				const meshes = prims.map((prim) => {
					const mesh = new THREE.Mesh(prim.geometry, material);
					mesh.matrixAutoUpdate = false;
					mesh.matrix.multiplyMatrices(place, prim.base);
					mesh.userData.slug = p.slug;
					mesh.matrixWorldNeedsUpdate = true;
					this.parts.add(mesh);
					return mesh;
				});
				list.push({ meshes, material });
			}
			this.instances.set(p.slug, list);
		}
		for (const s of this.buildStandins()) if (!rendered.includes(s)) rendered.push(s);
		const unplaced = [...known].filter((s) => !rendered.includes(s)).sort();
		if (!this.fitted && rendered.length) this.fit(false);
		this.applyLook();
		const key = rendered.join(',') + '|' + unplaced.join(',');
		if (key !== this.lastInfo) {
			this.lastInfo = key;
			this.cb.onready({ rendered, unplaced });
		}
		this.dirty = true;
	}

	/** Colours, hidden parts, selection highlight and dimming; no geometry work. */
	private applyLook() {
		const pick: T.Mesh[] = [];
		for (const [slug, list] of this.instances) {
			const hidden = this.hidden.has(slug);
			const isSel = this.selected === slug;
			const dimmed = this.dim && this.selected !== null && !isSel;
			for (const inst of list) {
				const mat = inst.material;
				mat.color.set(this.colors[slug] || NEUTRAL);
				mat.emissive.set(isSel ? HIGHLIGHT : 0x000000);
				mat.emissiveIntensity = isSel ? 0.35 : 0;
				mat.transparent = dimmed;
				mat.opacity = dimmed ? 0.16 : 1;
				mat.depthWrite = !dimmed;
				mat.needsUpdate = true;
				for (const m of inst.meshes) {
					m.visible = !hidden;
					// Dimmed parts stay pickable: a tap on one switches the selection to it.
					if (!hidden) pick.push(m);
				}
			}
		}
		this.pickables = pick;
		const dimHw = this.dim && this.selected !== null;
		this.hwMaterial.transparent = dimHw;
		this.hwMaterial.opacity = dimHw ? 0.12 : 1;
		this.hwMaterial.depthWrite = !dimHw;
		this.hwMaterial.needsUpdate = true;
		this.treadMaterial.transparent = dimHw;
		this.treadMaterial.opacity = dimHw ? 0.12 : 1;
		this.treadMaterial.depthWrite = !dimHw;
		this.treadMaterial.needsUpdate = true;
		this.dirty = true;
	}

	// ---- stand-ins (casters, harness) -------------------------------------------

	/** World boxes, one per instance. `precise` boxes the vertices: a turned mesh's transformed local box is loose. */
	private instanceBoxes(slug: string, precise = false): Aabb[] {
		const THREE = this.THREE;
		const out: Aabb[] = [];
		for (const inst of this.instances.get(slug) ?? []) {
			const box = new THREE.Box3();
			for (const m of inst.meshes) box.expandByObject(m, precise);
			if (!box.isEmpty())
				out.push({ min: box.min.toArray() as Aabb['min'], max: box.max.toArray() as Aabb['max'] });
		}
		return out;
	}

	/**
	 * Where a caster attaches to each visible instance of a mount: a plate with a pin hole inside a
	 * downward wall, so fire rays up at it around its centre (inside the wall), fit the underside
	 * plane through the first hits and take the rays that pass through as the hole.
	 */
	private mountFrames(slug: string): (MountFrame | null)[] {
		const THREE = this.THREE;
		if (this.hidden.has(slug)) return [];
		const rc = new THREE.Raycaster();
		const up = new THREE.Vector3(0, 1, 0);
		return (this.instances.get(slug) ?? []).flatMap((inst) => {
			const box = new THREE.Box3();
			for (const m of inst.meshes) box.expandByObject(m);
			if (box.isEmpty()) return [];
			const cx = (box.min.x + box.max.x) / 2;
			const cz = (box.min.z + box.max.z) / 2;
			const sides = inst.meshes.map((m) => (m.material as T.Material).side);
			inst.meshes.forEach((m) => ((m.material as T.Material).side = THREE.DoubleSide));
			const under: Vec3[] = [];
			const holes: [number, number][] = [];
			for (let dx = -10; dx <= 10; dx += 2) {
				for (let dz = -18; dz <= 18; dz += 2) {
					rc.set(new THREE.Vector3(cx + dx, box.min.y - 10, cz + dz), up);
					const hit = rc.intersectObjects(inst.meshes, false)[0];
					if (hit) under.push(hit.point.toArray() as Vec3);
					else holes.push([cx + dx, cz + dz]);
				}
			}
			inst.meshes.forEach((m, i) => ((m.material as T.Material).side = sides[i]));
			return [fitMountFrame(under, holes, [cx, cz])];
		});
	}

	private removeStandins() {
		for (const key of ['harness', 'buckles']) {
			const list = this.instances.get(key);
			if (!list) continue;
			for (const i of list) {
				i.material.dispose();
				for (const m of i.meshes) this.parts.remove(m);
			}
			this.instances.delete(key);
		}
		for (const o of this.standinOwned) o.dispose();
		this.standinOwned = [];
		this.casters.clear();
	}

	/**
	 * Draws the generic casters and the stylized harness from the placed parts' boxes. Returns the
	 * slugs it rendered (harness, buckles) so they do not count as unplaced.
	 */
	private buildStandins(): string[] {
		this.removeStandins();
		if (!this.loaded) return [];
		const THREE = this.THREE;
		this.parts.updateMatrixWorld(true);
		const vis = (s: string) => !this.hidden.has(s);
		const boxesOf = (slugs: string[]) => slugs.filter(vis).flatMap((s) => this.instanceBoxes(s));
		const known = (s: string) => this.placements.some((p) => p.slug === s);

		// Casters (neutral grey, always drawn when their mounts are).
		// Precise: the tire segments are turned in 45 degree steps, which loosens their boxes by tens of mm.
		const wheels = this.instanceBoxes('tires', true);
		const ground = wheels.length ? Math.min(...wheels.map((b) => b.min[1])) : DEFAULT_GROUND_Y;
		const rear = rearCasterAnchor(
			boxesOf([
				'rear-caster-left',
				'rear-caster-right',
				'rear-caster-left-mcmaster',
				'rear-caster-right-mcmaster'
			]),
			ground
		);
		const mountBoxes = boxesOf(['front-caster-mount']);
		const anchors = [
			...frontCasterAnchors(mountBoxes, this.mountFrames('front-caster-mount'), ground),
			...(rear ? [rear] : [])
		];
		for (const a of anchors)
			this.casters.add(
				buildCaster(THREE, a, { metal: this.hwMaterial, tread: this.treadMaterial })
			);

		// Harness: needs a seat and a back to hang on.
		const rendered: string[] = [];
		if (known('harness') || known('buckles')) {
			const seat =
				vis('cushion-base') && this.instanceBoxes('cushion-base')[0]
					? this.instanceBoxes('cushion-base')[0]
					: this.instanceBoxes('seat-center')[0];
			const back =
				vis('cushion-top') && this.instanceBoxes('cushion-top')[0]
					? this.instanceBoxes('cushion-top')[0]
					: aabbUnion([
							...this.instanceBoxes('seat-back-top'),
							...this.instanceBoxes('seat-back-bottom')
						]);
			if (seat && back) {
				const foot = aabbUnion(boxesOf(['footrest', 'footrest-front', 'footrest-rear']));
				const layout = harnessLayout({ seat, back, footrest: foot });
				const strapMeshes: T.Mesh[] = [];
				const buckleMeshes: T.Mesh[] = [];
				const strapMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
				const buckleMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
				strapMat.side = THREE.DoubleSide;
				for (const s of layout.straps) {
					const geo = buildRibbon(THREE, s, 3);
					this.standinOwned.push(geo);
					const mesh = new THREE.Mesh(geo, strapMat);
					mesh.userData.slug = 'harness';
					strapMeshes.push(mesh);
				}
				for (const b of layout.buckles) {
					const geo = buildBuckle(THREE, b);
					this.standinOwned.push(geo);
					const mesh = new THREE.Mesh(geo, buckleMat);
					mesh.userData.slug = 'buckles';
					buckleMeshes.push(mesh);
				}
				for (const m of [...strapMeshes, ...buckleMeshes]) this.parts.add(m);
				this.instances.set('harness', [{ meshes: strapMeshes, material: strapMat }]);
				this.instances.set('buckles', [{ meshes: buckleMeshes, material: buckleMat }]);
				rendered.push('harness', 'buckles');
			}
		}
		return rendered;
	}

	setPlacements(p: PartPlacement[]) {
		this.placements = p.map((x) => ({ ...x }));
		this.rebuild();
	}
	setColors(c: Record<string, string>) {
		this.colors = { ...c };
		this.applyLook();
	}
	setHidden(h: string[]) {
		this.hidden = new Set(h);
		// Stand-ins hang on whichever seat/back/mount variants are visible.
		if (this.loaded) this.buildStandins();
		this.applyLook();
	}
	/** Show or hide the offline hardware GLB (bolts, bearings); the stand-in casters stay. */
	setShowHardware(on: boolean) {
		this.showHardware = on;
		this.hardware.visible = on;
		this.dirty = true;
	}
	setSelection(slug: string | null, dim: boolean) {
		this.selected = slug;
		this.dim = dim;
		this.applyLook();
	}
	setAutoRotate(on: boolean) {
		this.autoRotate = on;
		this.controls.autoRotate = on && !this.reduceMotion;
		this.controls.autoRotateSpeed = 1.2;
		this.kick();
	}

	// ---- camera ------------------------------------------------------------------

	private bounds(slug?: string): T.Box3 {
		const THREE = this.THREE;
		const box = new THREE.Box3();
		this.parts.updateMatrixWorld(true);
		for (const [s, list] of this.instances) {
			if (slug && s !== slug) continue;
			if (!slug && this.hidden.has(s)) continue;
			for (const inst of list) for (const m of inst.meshes) box.expandByObject(m);
		}
		if (box.isEmpty() && !slug) box.setFromObject(this.hardware);
		return box;
	}

	private boxDistance(box: T.Box3, dir: T.Vector3, aspect: number): number {
		const c = box.getCenter(new this.THREE.Vector3());
		const corners: [number, number, number][] = [];
		for (const x of [box.min.x, box.max.x])
			for (const y of [box.min.y, box.max.y])
				for (const z of [box.min.z, box.max.z]) corners.push([x - c.x, y - c.y, z - c.z]);
		return fitDistanceBox(corners, [dir.x, dir.y, dir.z], this.camera.fov, aspect);
	}

	private aspect() {
		const w = this.host.clientWidth || 1;
		const h = this.host.clientHeight || 1;
		return w / h;
	}

	/** Frame the whole chair. `animate` eases to the new view instead of jumping. */
	private fit(animate: boolean) {
		const THREE = this.THREE;
		const box = this.bounds();
		if (box.isEmpty()) return;
		this.fitted = true;
		const sphere = box.getBoundingSphere(new THREE.Sphere());
		this.radius = Math.max(sphere.radius, 1);
		this.center.copy(box.getCenter(new THREE.Vector3()));
		this.fitBox = box.clone();
		const dir = new THREE.Vector3(...DIR).normalize();
		const d = this.boxDistance(box, dir, this.aspect());
		const pos = this.center.clone().add(dir.clone().multiplyScalar(d));
		this.camera.near = Math.max(this.radius * 0.02, 0.5);
		this.camera.far = d + this.radius * 20;
		this.camera.updateProjectionMatrix();
		this.controls.minDistance = this.radius * 0.15;
		this.controls.maxDistance = d * 3;
		this.moveCamera(this.center.clone(), pos, animate);
	}

	private moveCamera(target: T.Vector3, pos: T.Vector3, animate: boolean) {
		if (!animate || this.reduceMotion) {
			this.anim = null;
			this.controls.target.copy(target);
			this.camera.position.copy(pos);
			this.controls.update();
		} else {
			this.anim = {
				t0: performance.now(),
				ms: 380,
				fromT: this.controls.target.clone(),
				toT: target,
				fromP: this.camera.position.clone(),
				toP: pos
			};
		}
		this.dirty = true;
		this.kick();
	}

	resetView() {
		this.userMoved = false;
		this.fit(true);
	}

	/** True once a model has been installed (used by tests and screenshot tooling). */
	isLoaded(): boolean {
		return this.loaded;
	}

	/** Look at the whole chair from a named direction (no animation). */
	setView(name: ViewName) {
		const THREE = this.THREE;
		const box = this.bounds();
		if (box.isEmpty()) return;
		const dir = new THREE.Vector3(...VIEWS[name]).normalize();
		const d = this.boxDistance(box, dir, this.aspect());
		const c = box.getCenter(new THREE.Vector3());
		this.userMoved = true;
		this.moveCamera(c, c.clone().add(dir.multiplyScalar(d)), false);
	}

	focus(slug: string) {
		const THREE = this.THREE;
		const box = this.bounds(slug);
		if (box.isEmpty()) return;
		const s = box.getBoundingSphere(new THREE.Sphere());
		const dir = this.camera.position.clone().sub(this.controls.target).normalize();
		const d = Math.min(
			fitDistance(Math.max(s.radius, 5), this.camera.fov, this.aspect(), 1.5),
			this.controls.maxDistance
		);
		this.userMoved = true;
		this.moveCamera(s.center.clone(), s.center.clone().add(dir.multiplyScalar(d)), true);
	}

	private resize() {
		if (this.disposed) return;
		const w = this.host.clientWidth;
		const h = this.host.clientHeight;
		if (!w || !h) return;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		// Until the user has moved the camera, keep the whole chair framed (phone rotation, panel resize).
		if (this.loaded && !this.userMoved) this.fit(false);
		this.dirty = true;
	}

	// ---- picking -----------------------------------------------------------------

	private pick(cx: number, cy: number) {
		const rect = this.canvas.getBoundingClientRect();
		const ndc = new this.THREE.Vector2(
			((cx - rect.left) / rect.width) * 2 - 1,
			-((cy - rect.top) / rect.height) * 2 + 1
		);
		this.raycaster.setFromCamera(ndc, this.camera);
		const hits = this.raycaster.intersectObjects(this.pickables, false);
		const r = resolvePick(
			hits.map((h) => ({ slug: h.object.userData.slug as string | undefined }))
		);
		// A tap on a part (even a dimmed one) selects it; a tap on empty space deselects.
		this.cb.onpick(r.kind === 'hit' ? r.slug : null);
	}

	// ---- render loop -------------------------------------------------------------

	private kick() {
		if (this.raf || this.disposed) return;
		if (!this.inView || document.hidden) return;
		this.raf = requestAnimationFrame(this.frame);
	}

	private frame = () => {
		this.raf = 0;
		if (this.disposed || !this.inView || document.hidden) return;
		if (this.anim) {
			const a = this.anim;
			const k = Math.min(1, (performance.now() - a.t0) / a.ms);
			const e = k * k * (3 - 2 * k);
			this.controls.target.lerpVectors(a.fromT, a.toT, e);
			this.camera.position.lerpVectors(a.fromP, a.toP, e);
			if (k >= 1) this.anim = null;
			this.dirty = true;
		}
		const moved = this.controls.update();
		if (this.dirty || moved) {
			this.dirty = false;
			this.renderer.render(this.scene, this.camera);
		}
		this.raf = requestAnimationFrame(this.frame);
	};

	// ---- snapshot ----------------------------------------------------------------

	/** PNG of the current view. Different aspect ratios keep the viewing direction and re-frame the chair. */
	snapshot(opts: { width?: number; height?: number; background?: string } = {}): Promise<Blob> {
		const THREE = this.THREE;
		const cw = this.host.clientWidth || 1;
		const ch = this.host.clientHeight || 1;
		const width = Math.round(opts.width ?? Math.min(1600, cw * 2));
		const height = Math.round(opts.height ?? (width * ch) / cw);
		const savedPos = this.camera.position.clone();
		const savedAspect = this.camera.aspect;
		const prevColor = new THREE.Color();
		this.renderer.getClearColor(prevColor);
		const prevAlpha = this.renderer.getClearAlpha();
		return new Promise<Blob>((resolve, reject) => {
			try {
				this.renderer.setPixelRatio(1);
				this.renderer.setSize(width, height, false);
				this.camera.aspect = width / height;
				if (Math.abs(this.camera.aspect / savedAspect - 1) > 0.05) {
					const dir = savedPos.clone().sub(this.controls.target).normalize();
					const d = this.fitBox
						? this.boxDistance(this.fitBox, dir, this.camera.aspect)
						: fitDistance(this.radius, this.camera.fov, this.camera.aspect);
					this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(d));
				}
				this.camera.updateProjectionMatrix();
				if (opts.background) this.renderer.setClearColor(opts.background, 1);
				else this.renderer.setClearColor(0x000000, 0);
				this.renderer.render(this.scene, this.camera);
				this.canvas.toBlob(
					(b) => (b ? resolve(b) : reject(new Error('Could not create the image'))),
					'image/png'
				);
			} catch (e) {
				reject(e);
			} finally {
				this.renderer.setClearColor(prevColor, prevAlpha);
				this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
				this.camera.position.copy(savedPos);
				this.camera.aspect = savedAspect;
				this.camera.updateProjectionMatrix();
				this.resize();
				this.dirty = true;
				this.kick();
			}
		});
	}

	// ---- teardown ----------------------------------------------------------------

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		cancelAnimationFrame(this.raf);
		this.io?.disconnect();
		this.ro?.disconnect();
		this.cleanup.forEach((f) => f());
		this.controls.dispose();
		this.clearModel();
		this.hwMaterial.dispose();
		this.treadMaterial.dispose();
		this.env?.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
	}
}
