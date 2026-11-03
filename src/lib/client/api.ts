import type { BuildPhase, BuildView, PartStatus, PrintRunInput } from '#lib/domain/types.ts';
import type { ThreeMfPlate, ThreeMfSummary } from '#lib/domain/threemf.ts';
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

// ---- Design tab and shareable designs

export interface DesignRoleInput {
	key?: string;
	name: string;
	material: string;
	hex: string;
}

/** Edit a build's colors: move parts between slots, add a slot, remove an unused one. */
export const setBuildDesign = (
	id: string,
	patch: { partRoles?: Record<string, string>; addRole?: DesignRoleInput; removeRole?: string }
) => call('PATCH', `${b(id)}/design`, patch);

export const createDesign = (input: { buildId: string; name: string; isPublic: boolean }) =>
	call<{ id: string; slug: string }>('POST', '/api/designs', input);

export const updateDesignMeta = (id: string, patch: { name?: string; isPublic?: boolean }) =>
	call('PATCH', `/api/designs/${encodeURIComponent(id)}`, patch);

export const deleteDesign = (id: string) =>
	call('DELETE', `/api/designs/${encodeURIComponent(id)}`);

/** Replace a build's colors with a saved design. */
export const applyDesign = (id: string, buildId: string) =>
	call('POST', `/api/designs/${encodeURIComponent(id)}/apply`, { buildId });

/** Upload the PNG preview of a design you wrote (up to 2 MB). */
export async function uploadDesignSnapshot(id: string, png: Blob): Promise<void> {
	const res = await fetch(`/api/designs/${encodeURIComponent(id)}/snapshot`, {
		method: 'PUT',
		headers: { 'content-type': 'image/png' },
		body: png
	});
	if (!res.ok) {
		let msg = `Request failed (${res.status})`;
		try {
			msg = ((await res.json()) as { error?: string }).error ?? msg;
		} catch {
			/* non-JSON error body */
		}
		throw new Error(msg);
	}
}

// ---- Plate layouts and slicer uploads (milestone 5)

export interface PlateLayoutInfo {
	key: string;
	name: string;
	printerNote: string;
	isDefault: boolean;
	plateCount: number;
}
export const templatePlateLayouts = (templateId: string) =>
	call<{ layouts: PlateLayoutInfo[] }>(
		'GET',
		`/api/templates/${encodeURIComponent(templateId)}/plate-layouts`
	).then((r) => r.layouts);
export const buildPlateLayouts = (buildId: string) =>
	call<{ layouts: PlateLayoutInfo[]; current: string | null }>(
		'GET',
		`${b(buildId)}/plates/layouts`
	);
export const setPlateLayout = (buildId: string, key: string, convertRuns = false) =>
	call<{ plates: number; convertedRuns: number }>('POST', `${b(buildId)}/plates/layout`, {
		key,
		convertRuns
	});

export type UploadedPlate = Omit<ThreeMfPlate, 'thumbnail'> & { hasThumbnail: boolean };
export interface UploadSuggestionsDto {
	matches: Record<string, { slug: string | null; confidence: number; reason: string }>;
	mapping: Record<string, string | null>;
	filamentMap: Record<string, string | null>;
	variantChoices: Record<string, string>;
}
export interface UploadResult {
	uploadId: string;
	summary: Omit<ThreeMfSummary, 'plates'> & { plates: UploadedPlate[] };
	suggestions: UploadSuggestionsDto;
}

/** Streams the file to the server (raw body, so large files and progress work). */
export function uploadThreeMf(
	buildId: string,
	file: File,
	onProgress?: (fraction: number) => void
): Promise<UploadResult> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${b(buildId)}/plates/upload?name=${encodeURIComponent(file.name)}`);
		xhr.setRequestHeader('content-type', 'application/octet-stream');
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress?.(e.loaded / e.total);
		};
		xhr.onerror = () => reject(new Error('Upload failed. Check the connection and try again.'));
		xhr.onload = () => {
			let data: Record<string, unknown> = {};
			try {
				data = JSON.parse(xhr.responseText);
			} catch {
				/* non-JSON error body */
			}
			if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as UploadResult);
			else
				reject(
					new Error(
						xhr.status === 413
							? ((data.error as string) ?? 'The file is too large for this server')
							: ((data.error as string) ?? `Upload failed (${xhr.status})`)
					)
				);
		};
		xhr.send(file);
	});
}
export const applyPlateUpload = (
	buildId: string,
	uploadId: string,
	body: {
		mapping: Record<string, string | null>;
		filamentMap: Record<string, string | null>;
		variantChoices?: Record<string, string>;
		convertRuns?: boolean;
	}
) =>
	call<{ plates: number; skipped: number; convertedRuns: number }>(
		'POST',
		`${b(buildId)}/plates/upload/${encodeURIComponent(uploadId)}/apply`,
		body
	);
export const discardPlateUpload = (buildId: string, uploadId: string) =>
	call('DELETE', `${b(buildId)}/plates/upload/${encodeURIComponent(uploadId)}`);
export const plateThumbnailUrl = (buildId: string, number: number, v = '') =>
	`${b(buildId)}/plates/${number}/thumbnail${v ? `?v=${encodeURIComponent(v)}` : ''}`;
export const uploadThumbnailUrl = (buildId: string, uploadId: string, number: number) =>
	`${b(buildId)}/plates/upload/${encodeURIComponent(uploadId)}/thumbnail/${number}`;

// ---- 3D model admin (site admin only) --------------------------------------------

export interface ModelJobInfo {
	id: string;
	status: 'queued' | 'running' | 'done' | 'failed';
	progress: number;
	message: string;
	report: {
		file: string;
		slug: string | null;
		slugs?: string[];
		status: 'ok' | 'missing' | 'failed' | 'skipped' | 'unknown';
		triangles?: number;
		ms?: number;
		error?: string;
		detail?: string;
	}[];
	createdAt: string;
	finishedAt: string | null;
}

const tpl = (id: string) => `/api/templates/${encodeURIComponent(id)}`;

/** Upload a raw file as the request body with upload progress (fetch cannot report it). */
function uploadFile<T>(
	url: string,
	file: File,
	contentType: string,
	onProgress?: (fraction: number) => void
): Promise<T> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', url);
		xhr.setRequestHeader('content-type', contentType);
		xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
		xhr.onerror = () => reject(new Error('The upload failed (network error)'));
		xhr.onload = () => {
			let data: { error?: string } & Record<string, unknown> = {};
			try {
				data = JSON.parse(xhr.responseText);
			} catch {
				/* non-JSON body, e.g. a proxy error page */
			}
			if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
			else
				reject(
					new Error(
						data.error ??
							(xhr.status === 413
								? 'The file is too large for the server (see BODY_SIZE_LIMIT in the README)'
								: `Upload failed (${xhr.status})`)
					)
				);
		};
		xhr.send(file);
	});
}

export const uploadStepZip = (
	templateId: string,
	file: File,
	onProgress?: (fraction: number) => void
) =>
	uploadFile<{ jobId: string }>(
		`${tpl(templateId)}/model?name=${encodeURIComponent(file.name)}`,
		file,
		'application/zip',
		onProgress
	).then((r) => r.jobId);

export const getModelJob = (templateId: string, jobId: string) =>
	call<{ job: ModelJobInfo }>(
		'GET',
		`${tpl(templateId)}/model/jobs/${encodeURIComponent(jobId)}`
	).then((r) => r.job);

export const uploadHardwareGlb = (
	templateId: string,
	file: File,
	onProgress?: (fraction: number) => void
) =>
	uploadFile<{ hardwareUrl: string | null }>(
		`${tpl(templateId)}/model/hardware`,
		file,
		'model/gltf-binary',
		onProgress
	);

export const removeHardwareGlb = (templateId: string) =>
	call('DELETE', `${tpl(templateId)}/model/hardware`);

export const savePlacement = (
	templateId: string,
	slug: string,
	patch: { matrix?: number[]; instances?: number[][]; placed?: boolean }
) =>
	call<{ placement: import('#lib/domain/types.ts').PartPlacement }>(
		'PATCH',
		`${tpl(templateId)}/placements/${encodeURIComponent(slug)}`,
		patch
	).then((r) => r.placement);

// ---- printer-aware plate planner

/** Set (or clear with null) the printer a build is planned for. */
export const setPrinter = (
	id: string,
	printer: import('#lib/domain/types.ts').BuildPrinter | null
) => call('PATCH', `${b(id)}/printer`, { printer });

/** Arrange the build's plates for its printer; `convertRuns` confirms converting plate print logs. */
export const arrangePlates = (id: string, convertRuns = false) =>
	call<{
		plates: number;
		convertedRuns: number;
		warnings: import('#lib/domain/arrange.ts').ArrangeWarning[];
	}>('POST', `${b(id)}/plates/arrange`, { convertRuns });

export type ArrangementDto = import('#lib/domain/arrange.ts').ArrangementInfo;
export const getArrangement = (id: string) => call<ArrangementDto>('GET', `${b(id)}/arrangement`);

// ---- print geometry (site admin, kit page)

export interface PrintGeometryRow {
	slug: string;
	/** 'seed' (numbers from the kit data) or the import's note. */
	source: string;
	w: number;
	d: number;
	h: number;
	pieces: number;
	copies: number;
	hasMesh: boolean;
	settings: Record<string, string>;
	updatedAt: string;
}
export interface PrintGeometryImportResult {
	imported: number;
	report: { file: string; matched: number; unmatched: string[]; warnings: string[]; ms: number }[];
}
export const listPrintGeometry = (templateId: string) =>
	call<{ rows: PrintGeometryRow[] }>('GET', `${tpl(templateId)}/print-geometry`).then(
		(r) => r.rows
	);
export const uploadPrintGeometry = (
	templateId: string,
	file: File,
	onProgress?: (fraction: number) => void
) =>
	uploadFile<PrintGeometryImportResult>(
		`${tpl(templateId)}/print-geometry?name=${encodeURIComponent(file.name)}`,
		file,
		'application/octet-stream',
		onProgress
	);

// ---- 3MF export for a slicer

export type ExportPreviewDto = import('#lib/domain/export-types.ts').ExportPreview;
export type ExportFlavor = import('#lib/domain/export-types.ts').Flavor;

function exportQuery(flavor: ExportFlavor, plates?: number[]) {
	const q = new URLSearchParams({ flavor });
	if (plates?.length) q.set('plates', plates.join(','));
	return q.toString();
}
export const exportPreview = (id: string, flavor: ExportFlavor, plates?: number[]) =>
	call<ExportPreviewDto>('GET', `${b(id)}/export/preview?${exportQuery(flavor, plates)}`);
export const exportDownloadUrl = (id: string, flavor: ExportFlavor, plates?: number[]) =>
	`${b(id)}/export.3mf?${exportQuery(flavor, plates)}`;
