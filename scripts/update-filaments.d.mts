export const SOURCE_URL: string;
export function normalise(
	rows: unknown,
	opts?: { fetchedAt?: string }
): import('#lib/server/filaments/types.ts').FilamentCatalog;
export function mergeSupplement(
	catalog: import('#lib/server/filaments/types.ts').FilamentCatalog,
	supplement: import('#lib/server/filaments/types.ts').FilamentSupplement | null | undefined
): import('#lib/server/filaments/types.ts').FilamentCatalog;
