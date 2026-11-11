// Tiny shared type guards. Dependency-free (no DB, Svelte or Node imports).

export type Obj = Record<string, unknown>;

/** A non-null, non-array object (class instances and null-prototype objects included). */
export const isObj = (v: unknown): v is Obj =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
