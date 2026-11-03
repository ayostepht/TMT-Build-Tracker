declare module 'occt-import-js' {
	export interface OcctMesh {
		name?: string;
		attributes: {
			position: { array: ArrayLike<number> };
			normal?: { array: ArrayLike<number> };
		};
		index: { array: ArrayLike<number> };
	}
	export interface OcctResult {
		success: boolean;
		meshes: OcctMesh[];
	}
	export interface OcctParams {
		linearUnit?: string;
		linearDeflectionType?: string;
		linearDeflection?: number;
		angularDeflection?: number;
	}
	export interface Occt {
		ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
	}
	const init: () => Promise<Occt>;
	export default init;
}
