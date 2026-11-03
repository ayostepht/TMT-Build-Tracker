import type { BuildPhase, BuildView, PartStatus, PrintRunInput } from '#lib/domain/types.ts';
import type { PartSnapshot } from '#lib/domain/logrun.ts';

async function call<T = Record<string, never>>(
	method: string,
	url: string,
	body?: unknown
): Promise<T> {
	const res = await fetch(url, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	let data: { error?: string } & Record<string, unknown> = {};
	try {
		data = await res.json();
	} catch {
		/* non-JSON error body */
	}
	if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
	return data as T;
}

const b = (id: string) => `/api/builds/${encodeURIComponent(id)}`;

export interface NewBuildInput {
	organizationId: string;
	templateId: string;
	designId?: string | null;
	name: string;
	recipient?: string | null;
	hospital?: string | null;
	deliveryDate?: string | null;
	variantChoices?: Record<string, string>;
}
export const createBuild = (input: NewBuildInput) =>
	call<{ id: string }>('POST', '/api/builds', input).then((r) => r.id);

export const updateBuild = (
	id: string,
	patch: {
		name?: string;
		recipient?: string | null;
		hospital?: string | null;
		deliveryDate?: string | null;
		phase?: BuildPhase;
	}
) => call('PATCH', b(id), patch);
export const deleteBuild = (id: string) => call('DELETE', b(id));
export const moveBuild = (id: string, organizationId: string) =>
	call('POST', `${b(id)}/move`, { organizationId });

/** Choose a variant option (group key, option key) for a build. */
export const setVariant = (id: string, group: string, option: string) =>
	call('PATCH', `${b(id)}/variants`, { group, option });

export const setPartStatus = (id: string, slug: string, status: PartStatus) =>
	call('POST', `${b(id)}/parts/${encodeURIComponent(slug)}/status`, { status });
export const updatePart = (
	id: string,
	slug: string,
	patch: { comps?: Record<string, boolean>; assigneeUserId?: string | null }
) => call('PATCH', `${b(id)}/parts/${encodeURIComponent(slug)}`, patch);

export const startPrinting = (id: string, slugs: string[]) =>
	call('POST', `${b(id)}/printing`, { action: 'start', slugs });
export const stopPrinting = (id: string, slugs: string[]) =>
	call('POST', `${b(id)}/printing`, { action: 'stop', slugs });
export const setPrintStart = (id: string, slugs: string[], when: Date | string) =>
	call('POST', `${b(id)}/printing`, {
		action: 'setStart',
		slugs,
		when: typeof when === 'string' ? when : when.toISOString()
	});
export const setRunEstimate = (id: string, slugs: string[], seconds: number | null) =>
	call('POST', `${b(id)}/printing`, { action: 'setEstimate', slugs, seconds });

export const logRun = (id: string, input: PrintRunInput) =>
	call<{ id: string }>('POST', `${b(id)}/runs`, input).then((r) => r.id);
export const deleteRun = (id: string, runId: string, { recompute = true } = {}) =>
	call('DELETE', `${b(id)}/runs/${encodeURIComponent(runId)}${recompute ? '' : '?recompute=0'}`);

/** In `slicerByPart`, a null value clears that part's entry. */
export const updatePlate = (
	id: string,
	number: number,
	patch: { slicerGrams?: number | null; slicerByPart?: Record<string, number | null> }
) => call('PATCH', `${b(id)}/plates/${number}`, patch);

export const updateFilament = (
	id: string,
	role: string,
	patch: { spools?: number; name?: string; hex?: string; material?: string }
) => call('PATCH', `${b(id)}/filaments/${encodeURIComponent(role)}`, patch);

/** Generic printing action (start | stop | setStart | setEstimate). `seconds` undefined/null clears the estimate. */
export const printing = (
	id: string,
	body: {
		action: 'start' | 'stop' | 'setStart' | 'setEstimate';
		slugs: string[];
		when?: string;
		seconds?: number | null;
	}
) => call('POST', `${b(id)}/printing`, body);

/** Fresh BuildView from the server. */
export const getView = (id: string) => call<BuildView>('GET', `${b(id)}/view`);

/** Delete a run and restore the affected parts to `parts` (their state before the run was logged). */
export const undoRun = (id: string, runId: string, parts: PartSnapshot[]) =>
	call('POST', `${b(id)}/runs/${encodeURIComponent(runId)}/undo`, { parts });

/** Correct a past print log; changing result, part or date re-derives the affected parts' statuses. */
export const updateRun = (
	id: string,
	runId: string,
	patch: {
		date?: string;
		result?: PrintRunInput['result'];
		grams?: number | null;
		hours?: number | null;
		note?: string;
		partSlug?: string | null;
	}
) => call('PATCH', `${b(id)}/runs/${encodeURIComponent(runId)}`, patch);

export interface ImportSummary {
	parts: number;
	runs: number;
	plates: number;
	spools: number;
	warnings: string[];
	/** The build has no progress yet (importing needs no "replace"). */
	empty: boolean;
}

/** Import progress from the original prototype. `dryRun` only reports what would happen. */
export const importPrototype = (
	id: string,
	data: unknown,
	opts: { replace?: boolean; dryRun?: boolean } = {}
) =>
	call<ImportSummary & { replaced?: boolean }>(
		'POST',
		`${b(id)}/import${opts.dryRun ? '?dryRun=1' : ''}`,
		{ data, replace: opts.replace === true }
	);
