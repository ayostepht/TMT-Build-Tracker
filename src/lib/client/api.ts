import type {
	PrinterExpectedView,
	PrinterJobView,
	PrinterKind,
	PrinterPublic,
	PrinterStatus
} from '#lib/printers/status.ts';
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
	patch: {
		slicerGrams?: number | null;
		slicerByPart?: Record<string, number | null>;
		/** Seconds per run typed by hand; overrides the file's time. null clears. */
		manualEstSeconds?: number | null;
	}
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
	/** Groups of parts that share a source object (twins), every template part. */
	twinGroups: string[][];
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
		/** 'plates' (default): the file's plates become the build's plates. 'template': keep my plates, learn per-part data. */
		mode?: 'plates' | 'template';
		/** Template mode: arrange the plates for the build's printer right away with the learned data. */
		arrange?: boolean;
		/** Object keys whose twins are not added: the object stays on the one part it is mapped to. */
		single?: Record<string, boolean>;
	}
) =>
	call<{
		plates: number;
		skipped: number;
		convertedRuns: number;
		mode: 'plates' | 'template';
		learned: number;
		arranged: boolean;
		twinPlates: { plate: number; parts: string[]; runsPerPart: number; totalRuns: number }[];
		warnings: string[];
	}>('POST', `${b(buildId)}/plates/upload/${encodeURIComponent(uploadId)}/apply`, body);
/** Forget the per-part data learned from a sliced file (plates stay). */
export const forgetPrintTemplate = (buildId: string) =>
	call<{ removed: number }>('DELETE', `${b(buildId)}/print-template`);
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
	paintedFaces: number;
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

// ---- assembly, handoff, photos (milestone 6)

/** Tick/untick an assembly item (step key, `<step>:check:<key>` or `<step>:hw:<name>`) or set its note. */
export const setAssemblyItem = (
	id: string,
	itemKey: string,
	patch: { done?: boolean; note?: string }
) => call('PATCH', `${b(id)}/assembly`, { itemKey, ...patch });

export interface HandoffInput {
	recipientName?: string | null;
	organization?: string | null;
	contact?: string | null;
	handedOffOn?: string | null;
	location?: string | null;
	notes?: string;
	safetyChecked?: boolean;
}
export const saveHandoff = (id: string, input: HandoffInput) =>
	call('PATCH', `${b(id)}/handoff`, input);
export const markHandedOff = (id: string, input: HandoffInput = {}) =>
	call('POST', `${b(id)}/handoff`, input);

export const photoUrl = (id: string, photoId: string, thumb = false) =>
	`${b(id)}/photos/${encodeURIComponent(photoId)}${thumb ? '?thumb=1' : ''}`;
export async function uploadPhoto(
	id: string,
	photo: {
		kind: 'progress' | 'finished' | 'handoff';
		file: Blob;
		thumb: Blob | null;
		width: number;
		height: number;
		caption?: string;
	}
): Promise<string> {
	const form = new FormData();
	form.set('kind', photo.kind);
	form.set('caption', photo.caption ?? '');
	form.set('width', String(photo.width));
	form.set('height', String(photo.height));
	form.set('file', photo.file, 'photo');
	if (photo.thumb) form.set('thumb', photo.thumb, 'thumb');
	const res = await fetch(`${b(id)}/photos`, { method: 'POST', body: form });
	let data: { error?: string; id?: string } = {};
	try {
		data = await res.json();
	} catch {
		/* non-JSON error body */
	}
	if (!res.ok || !data.id) throw new Error(data.error ?? `Upload failed (${res.status})`);
	return data.id;
}
export const deletePhoto = (id: string, photoId: string) =>
	call('DELETE', `${b(id)}/photos/${encodeURIComponent(photoId)}`);

// ---- guide import (site admin, kit page)

export interface GuideStatusDto {
	uploaded: number[];
	pages: { page: number; title: string; pdfPage: number | null }[];
}
export const getGuideStatus = (templateId: string) =>
	call<GuideStatusDto>('GET', `${tpl(templateId)}/guide`);
export const guidePageImageUrl = (templateId: string, page: number, version = '') =>
	`${tpl(templateId)}/guide/${page}.webp${version ? `?v=${encodeURIComponent(version)}` : ''}`;
export const uploadedGuidePageUrl = (templateId: string, pdfPage: number, version = '') =>
	`${tpl(templateId)}/guide/pages/${pdfPage}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
export async function uploadGuidePage(templateId: string, pdfPage: number, image: Blob) {
	const res = await fetch(`${tpl(templateId)}/guide/pages/${pdfPage}`, {
		method: 'POST',
		headers: { 'content-type': image.type || 'application/octet-stream' },
		body: image
	});
	let data: { error?: string } = {};
	try {
		data = await res.json();
	} catch {
		/* non-JSON error body */
	}
	if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
}
export const saveGuideMapping = (templateId: string, map: Record<number, number | null>) =>
	call<{ changed: number }>('PUT', `${tpl(templateId)}/guide`, { map });
export const clearGuideImages = (templateId: string) => call('DELETE', `${tpl(templateId)}/guide`);

// ---- printers and Spoolman (milestone 7)

export interface PrinterInput {
	organizationId?: string;
	name?: string;
	kind?: PrinterKind;
	host?: string;
	port?: number | null;
	catalogId?: string | null;
	enabled?: boolean;
	/** Camera override (same host as the printer); null or blank = automatic. */
	cameraUrl?: string | null;
	cameraEnabled?: boolean;
	/** Only the fields typed; blank clears a stored value, omitted keeps it. */
	secrets?: Record<string, string>;
}
export interface DiscoveredPrinterDto {
	host: string;
	name: string;
	machineName: string;
	brand: string;
	mainboardId: string;
	firmware: string;
}
export interface SpoolDto {
	id: number;
	name: string;
	vendor: string | null;
	material: string | null;
	colorHex: string | null;
	remainingG: number | null;
	usedG: number | null;
	initialG: number | null;
	archived: boolean;
	location: string | null;
}
export interface OrgSettingsDto {
	spoolmanUrl: string | null;
	spoolmanAutoDeduct: boolean;
	autoLogPrints: boolean;
}

export const listPrinters = (org: string) =>
	call<{
		printers: PrinterPublic[];
		jobs: PrinterJobView[];
		canEdit: boolean;
		autoLogPrints: boolean;
	}>('GET', `/api/printers?org=${encodeURIComponent(org)}`);
export interface PrinterWorkspace {
	id: string;
	name: string;
	personal: boolean;
	canEdit: boolean;
	printers: PrinterPublic[];
}
/** Printers of every workspace the user belongs to; `first` (a workspace id) leads. */
export const listMyPrinters = (first?: string) =>
	call<{ workspaces: PrinterWorkspace[] }>(
		'GET',
		`/api/printers/mine${first ? `?first=${encodeURIComponent(first)}` : ''}`
	);
export const addPrinter = (org: string, input: PrinterInput) =>
	call<{ printer: PrinterPublic }>('POST', '/api/printers', { ...input, organizationId: org });
export const updatePrinter = (id: string, input: PrinterInput) =>
	call<{ printer: PrinterPublic }>('PATCH', `/api/printers/${encodeURIComponent(id)}`, input);
export const removePrinter = (id: string) =>
	call('DELETE', `/api/printers/${encodeURIComponent(id)}`);
export const testPrinter = (org: string, input: PrinterInput & { id?: string }) =>
	call<{ connected: boolean; status: PrinterStatus | null; message?: string }>(
		'POST',
		'/api/printers/test',
		{ ...input, organizationId: org }
	);
export interface CameraInfo {
	supported: boolean;
	enabled: boolean;
	available: boolean;
	origin: 'custom' | 'default' | 'moonraker' | 'octoprint' | null;
}
export const printerCameraInfo = (printerId: string) =>
	call<CameraInfo>('GET', `/api/printers/${encodeURIComponent(printerId)}/camera`);
export const testPrinterCamera = (org: string, input: PrinterInput & { id?: string }) =>
	call<{ works: boolean; message?: string; image?: string; origin?: string }>(
		'POST',
		'/api/printers/camera-test',
		{ ...input, organizationId: org }
	);
export const discoverPrinters = (org: string) =>
	call<{ found: DiscoveredPrinterDto[] }>('POST', '/api/printers/discover', {
		organizationId: org
	});
export const buildPrinterJobs = (buildId: string) =>
	call<{
		organizationId: string;
		jobs: PrinterJobView[];
		printers: PrinterPublic[];
		expected: PrinterExpectedView[];
	}>('GET', `${b(buildId)}/printer-jobs`);
export const jobAction = (
	jobId: string,
	body:
		| { action: 'link'; buildId: string; plateNumber: number; partSlugs?: string[] }
		| { action: 'unlink' | 'dismiss' }
		| {
				action: 'confirm';
				result?: 'Success' | 'Failed' | 'Partial';
				grams?: number | null;
				hours?: number | null;
				note?: string;
		  }
) =>
	call<{ runId?: string; spoolmanWarning?: string }>(
		'POST',
		`/api/printers/jobs/${encodeURIComponent(jobId)}`,
		body
	);

export const getOrgSettings = (org: string) =>
	call<{ settings: OrgSettingsDto; canEdit: boolean; blocked?: string | null }>(
		'GET',
		`/api/spoolman?org=${encodeURIComponent(org)}`
	);
export const saveOrgSettings = (org: string, patch: Partial<OrgSettingsDto>) =>
	call<{ settings: OrgSettingsDto }>('PUT', '/api/spoolman', { ...patch, organizationId: org });
export const testSpoolman = (org: string, spoolmanUrl?: string) =>
	call<{ version: string | null; spoolCount: number }>('POST', '/api/spoolman/test', {
		organizationId: org,
		spoolmanUrl
	});
export const buildSpoolman = (buildId: string, all = false) =>
	call<{
		configured: boolean;
		autoDeduct: boolean;
		linked: Record<string, SpoolDto | null>;
		spools: SpoolDto[];
		error?: string;
	}>('GET', `${b(buildId)}/spoolman${all ? '?all=1' : ''}`);
export const linkFilamentSpool = (
	buildId: string,
	role: string,
	spoolId: number | null,
	spoolName?: string
) =>
	call('PUT', `${b(buildId)}/filaments/${encodeURIComponent(role)}/spool`, { spoolId, spoolName });
export const expectOnPrinter = (
	printerId: string,
	buildId: string,
	plateNumber: number,
	partSlugs?: string[]
) =>
	call('POST', `/api/printers/${encodeURIComponent(printerId)}/expect`, {
		buildId,
		plateNumber,
		partSlugs
	});

// ---- kit status (any signed-in user)

export const getKitStatus = (templateId: string) =>
	call<{ status: import('#lib/domain/kit-import.ts').KitStatusDto; canImport: boolean }>(
		'GET',
		`${tpl(templateId)}/kit-status`
	);

// ---- setup wizard

/** Remember the setup step (1 to 5) a build is on; null = setup finished. */
export const setSetupStep = (buildId: string, step: number | null) =>
	call('PATCH', `${b(buildId)}/setup`, { step });

/** Step 1: `own: true` points the build at a workspace-owned copy of its kit (for your own files). */
export const chooseTemplate = (buildId: string, own: boolean) =>
	call<{ templateId: string }>('POST', `${b(buildId)}/template`, { own });

/** Studio draft → tracked build. The draft keeps its design, variants, printer, plates and files. */
export const promoteDraft = (buildId: string) => call('POST', `${b(buildId)}/promote`);

/** A Studio draft in a workspace (no tracking); returns its id. */
export const createDraft = (organizationId: string, templateId: string, name: string) =>
	call<{ id: string }>('POST', '/api/builds', { organizationId, templateId, name, kind: 'draft' });

export interface FoundAccount {
	id: string;
	name: string;
	email: string;
	isAdmin: boolean;
	canGrant: boolean;
}

/** Site admins only: accounts matching `q` (name or email), for the hand-over picker. */
export const searchAccounts = async (q: string) =>
	(await call<{ users?: FoundAccount[] }>('GET', `/api/account/users?q=${encodeURIComponent(q)}`))
		.users ?? [];
