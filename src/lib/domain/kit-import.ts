/**
 * Kit import planning, pure: given what a dropped file turned out to be (its kind and, for zips
 * and 3MFs, its entry names) decide what it can feed in the kit (3D chair, print geometry, guide)
 * and in which order the import runs. No DOM, no network; `kit-probe.ts` does the
 * sniffing, `KitImportCard.svelte` runs the plan.
 */

export type TargetKind = 'model' | 'print' | 'guide' | 'sliced';
export type FileKind = 'zip' | '3mf' | 'step' | 'pdf' | 'unknown';

/** What a file (or a zip entry, one level down) was sniffed to be. */
export interface Probe {
	name: string;
	/** Entry path inside the parent zip; undefined for a dropped file. */
	entry?: string;
	size: number;
	kind: FileKind;
	/** Entry names of a zip or 3MF. */
	entries?: string[];
	/** Zips/3MFs found inside a zip, probed one level deep. */
	children?: Probe[];
	/** PDF page count when known (a PDF, or the PDF inside a 3MF). */
	pdfPages?: number;
	/** Set on a 3MF that was sliced (G-code and/or sliced plates in `slice_info.config`). */
	sliced?: { plates: number };
}

export interface Feed {
	kind: TargetKind;
	/** "3D chair (41 STEP files)" */
	label: string;
	enabled: boolean;
	/** Why it is off or what to know. */
	note?: string;
}

export type ItemStatus = 'ok' | 'unknown' | 'duplicate' | 'container';

export interface PlanItem {
	/** Stable for a given drop: `<fileId>` or `<fileId>/<entry>`. */
	id: string;
	fileId: number;
	/** Entry names below the dropped file (empty for the dropped file itself). */
	entryPath: string[];
	/** Display name, "outer.zip > inner.zip". */
	name: string;
	size: number;
	probe: Probe;
	status: ItemStatus;
	note: string;
	feeds: Feed[];
}

export interface Plan {
	items: PlanItem[];
	warnings: string[];
}

export interface PlanInput {
	fileId: number;
	probe: Probe;
}

export interface Step {
	id: string;
	kind: TargetKind;
	title: string;
	itemIds: string[];
}

// ---- name helpers -----------------------------------------------------------------

export const isJunkEntry = (name: string) =>
	name.endsWith('/') || /(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$)/i.test(name);
export const isStepName = (name: string) => /\.(step|stp)$/i.test(name) && !isJunkEntry(name);
export const is3mfName = (name: string) => /\.3mf$/i.test(name) && !isJunkEntry(name);
export const isZipName = (name: string) => /\.zip$/i.test(name) && !isJunkEntry(name);
export const isPdfName = (name: string) => /\.pdf$/i.test(name) && !isJunkEntry(name);
export const isGlbName = (name: string) => /\.glb$/i.test(name) && !isJunkEntry(name);
export const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;

/** A 3MF is a zip with the model part at its root. */
export const looks3mf = (entries: string[]) =>
	entries.some((e) => e.toLowerCase() === '3d/3dmodel.model');

/** Guide PDFs a MakeGood 3MF carries under `Auxiliaries/`. */
export const guidePdfEntries = (entries: string[]) =>
	entries.filter((e) => /(^|\/)Auxiliaries\/.*\.pdf$/i.test(e) && !isJunkEntry(e));

/** Plates of a Bambu/Orca project: distinct `Metadata/plate_<n>.*` numbers. */
export function plateCount(entries: string[]): number {
	const n = new Set<string>();
	for (const e of entries) {
		const m = /^Metadata\/plate_(\d+)\./i.exec(e);
		if (m) n.add(m[1]);
	}
	return n.size;
}

/** Entries of a sliced plate: `Metadata/plate_<n>.gcode` (the G-code itself, not its `.md5`). */
export const isGcodeEntry = (name: string) => /^Metadata\/plate_\d+\.gcode$/i.test(name);

/** Where a sliced project keeps its per-plate predictions (read to tell a sliced project from a saved one). */
export const SLICE_INFO_ENTRY = 'Metadata/slice_info.config';

/**
 * Is this 3MF a sliced project? It has G-code for a plate, or `slice_info.config` lists plates
 * (an unsliced Bambu/Orca save has the file with a header only). `sliceInfo` is the file's text
 * when it was read. Returns the number of sliced plates, or null for an unsliced 3MF.
 */
export function slicedPlates(entries: string[], sliceInfo?: string | null): number | null {
	const gcode = new Set<string>();
	for (const e of entries) if (isGcodeEntry(e)) gcode.add(e.toLowerCase());
	const listed = sliceInfo ? (sliceInfo.match(/<plate\b/g) ?? []).length : 0;
	const n = Math.max(gcode.size, listed);
	return n > 0 ? n : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pdfDesc = (pages?: number) => (pages ? `${pages}-page PDF` : 'PDF');

// ---- per-file rules ---------------------------------------------------------------

function threeMfFeeds(p: Probe): Feed[] {
	const entries = p.entries ?? [];
	const plates = plateCount(entries);
	if (p.sliced) {
		// A sliced project belongs to a build's own plates; its meshes are valid kit geometry, but only on request.
		return [
			{
				kind: 'sliced',
				enabled: true,
				label: `Sliced file: use it for this build's plates (${plural(p.sliced.plates, 'sliced plate')})`
			},
			{
				kind: 'print',
				enabled: false,
				label: 'Import as kit print geometry instead (its meshes are valid)',
				note: 'Only for adding the kit files. A sliced project is normally uploaded for one build.'
			}
		];
	}
	const feeds: Feed[] = [
		{
			kind: 'print',
			enabled: true,
			label: plates
				? `Print geometry (profile with ${plural(plates, 'plate')})`
				: 'Print geometry (3MF, no plate data)'
		}
	];
	if (guidePdfEntries(entries).length)
		feeds.push({
			kind: 'guide',
			enabled: true,
			label: `Guide (${pdfDesc(p.pdfPages)} inside this 3MF)`
		});
	return feeds;
}

function zipFeeds(p: Probe): Feed[] {
	const entries = (p.entries ?? []).filter((e) => !isJunkEntry(e));
	const steps = entries.filter(isStepName).length;
	const mfs = entries.filter(is3mfName).length;
	const pdfs = entries.filter(isPdfName).filter((e) => !/(^|\/)Auxiliaries\//i.test(e));
	const feeds: Feed[] = [];
	if (steps)
		feeds.push({
			kind: 'model',
			enabled: true,
			label: `3D chair (${plural(steps, 'STEP file')})`
		});
	if (mfs)
		feeds.push({
			kind: 'print',
			enabled: true,
			label: `Print geometry (zip of ${plural(mfs, '3MF file')})`
		});
	const innerGuide = (p.children ?? []).filter((c) => c.kind === '3mf' && c.entry).length
		? (p.children ?? []).find((c) => c.kind === '3mf' && guidePdfEntries(c.entries ?? []).length)
		: undefined;
	if (pdfs.length)
		feeds.push({
			kind: 'guide',
			enabled: true,
			label: `Guide (${pdfDesc(p.pdfPages)} in this zip)`
		});
	else if (innerGuide)
		feeds.push({
			kind: 'guide',
			enabled: true,
			label: `Guide (${pdfDesc(innerGuide.pdfPages)} inside ${innerGuide.name})`
		});
	return feeds;
}

function describe(
	probe: Probe,
	fileId: number,
	entryPath: string[],
	displayName: string
): PlanItem[] {
	const id = [String(fileId), ...entryPath].join('/');
	let feeds: Feed[] = [];
	let note = '';
	let status: ItemStatus = 'ok';
	switch (probe.kind) {
		case 'step':
			feeds = [{ kind: 'model', enabled: true, label: '3D chair (loose STEP file)' }];
			break;
		case 'pdf':
			feeds = [{ kind: 'guide', enabled: true, label: `Guide (${pdfDesc(probe.pdfPages)})` }];
			break;
		case '3mf':
			feeds = threeMfFeeds(probe);
			break;
		case 'zip':
			feeds = zipFeeds(probe);
			break;
		default:
			status = 'unknown';
	}
	const nestedZips = (probe.children ?? []).filter((c) => c.kind === 'zip' || c.kind === '3mf');
	const nestedItems: PlanItem[] = [];
	if (probe.kind === 'zip')
		for (const c of nestedZips.filter((c) => isZipName(c.entry ?? c.name) && c.kind === 'zip'))
			nestedItems.push(
				...describe(c, fileId, [...entryPath, c.entry ?? c.name], `${displayName} > ${c.name}`)
			);
	if (probe.kind === 'zip' && !feeds.length) {
		if (nestedItems.some((n) => n.status !== 'unknown')) {
			status = 'container';
			note = `Holds ${plural(nestedItems.length, 'zip')}, listed below`;
		} else {
			status = 'unknown';
		}
	}
	if (status === 'unknown')
		note =
			probe.kind === 'zip'
				? 'Nothing in this zip looks like STEP, 3MF or PDF files'
				: isGlbName(probe.name)
					? 'Not needed: the app includes the hardware'
					: 'Not recognised (expected .zip, .step, .3mf or .pdf)';
	return [
		{
			id,
			fileId,
			entryPath,
			name: displayName,
			size: probe.size,
			probe,
			status,
			note,
			feeds
		},
		...nestedItems
	];
}

// ---- the plan ---------------------------------------------------------------------

const PRIORITY: Record<FileKind, number> = {
	pdf: 0,
	'3mf': 1,
	zip: 2,
	step: 3,
	unknown: 9
};

/**
 * Build the import plan for a set of dropped files (in drop order). Duplicates (same name and
 * size dropped twice) are switched off; where only one file can win (the guide) the best
 * candidate stays on (a PDF over a 3MF over a zip, then drop order) and the rest are switched off
 * with a note.
 */
export function buildPlan(inputs: PlanInput[]): Plan {
	const warnings: string[] = [];
	const items: PlanItem[] = [];
	const seen = new Map<string, string>();
	for (const { fileId, probe } of inputs) {
		const group = describe(probe, fileId, [], probe.name);
		const key = `${probe.name.toLowerCase()}|${probe.size}`;
		const first = seen.get(key);
		if (first) {
			for (const it of group) {
				it.status = 'duplicate';
				it.note = `Same file as ${first}, left out`;
				for (const f of it.feeds) f.enabled = false;
			}
		} else seen.set(key, probe.name);
		items.push(...group);
	}
	for (const kind of ['guide'] as const) {
		const cands = items
			.flatMap((it) => it.feeds.filter((f) => f.kind === kind && f.enabled).map((f) => ({ it, f })))
			.sort((a, b) => PRIORITY[a.it.probe.kind] - PRIORITY[b.it.probe.kind]);
		for (const c of cands.slice(1)) {
			c.f.enabled = false;
			c.f.note = `Only one ${kind} can be imported; using ${cands[0].it.name}`;
		}
	}
	// Same STEP file name arriving from two sources: the later one is ignored by the merge.
	const stepNames = new Map<string, string>();
	const dupSteps = new Set<string>();
	for (const it of items) {
		if (!it.feeds.some((f) => f.kind === 'model' && f.enabled)) continue;
		const names =
			it.probe.kind === 'step'
				? [it.probe.name]
				: (it.probe.entries ?? []).filter(isStepName).map((e) => e);
		for (const n of names) {
			const k = n.toLowerCase();
			if (stepNames.has(k) && stepNames.get(k) !== it.id) dupSteps.add(baseName(n));
			else stepNames.set(k, it.id);
		}
	}
	if (dupSteps.size)
		warnings.push(
			`${plural(dupSteps.size, 'STEP file')} appear${dupSteps.size === 1 ? 's' : ''} in more than one source (${[...dupSteps].slice(0, 3).join(', ')}${dupSteps.size > 3 ? ', …' : ''}); the first copy is used.`
		);
	return { items, warnings };
}

/** Items holding a sliced project that is switched to the build's plates (the default). */
export const slicedItems = (plan: Plan) =>
	plan.items.filter((it) => it.feeds.some((f) => f.kind === 'sliced' && f.enabled));

/** How many STEP files an item brings to the 3D chair. */
export function stepCount(it: PlanItem): number {
	if (it.probe.kind === 'step') return 1;
	return (it.probe.entries ?? []).filter(isStepName).length;
}

/** The steps to run for the enabled feeds: 3D chair, print geometry (biggest first), guide. */
export function makeSteps(plan: Plan): Step[] {
	const on = (kind: TargetKind) =>
		plan.items.filter((it) => it.feeds.some((f) => f.kind === kind && f.enabled));
	// 'sliced' feeds are not import steps: the drop zone hands those files to the build's plate upload.
	const steps: Step[] = [];
	const model = on('model');
	if (model.length) {
		const n = model.reduce((a, it) => a + stepCount(it), 0);
		steps.push({
			id: 'model',
			kind: 'model',
			title: `3D chair (${plural(n, 'STEP file')})`,
			itemIds: model.map((i) => i.id)
		});
	}
	// Later imports replace the parts they contain, so the big main profile goes first.
	for (const it of [...on('print')].sort((a, b) => b.size - a.size))
		steps.push({
			id: `print:${it.id}`,
			kind: 'print',
			title: `Print geometry: ${it.name}`,
			itemIds: [it.id]
		});
	const guide = on('guide')[0];
	if (guide)
		steps.push({
			id: 'guide',
			kind: 'guide',
			title: `Guide: ${guide.name}`,
			itemIds: [guide.id]
		});
	return steps;
}

/**
 * The offset between our guide page numbers and PDF pages that most mapped pages share (our page
 * minus PDF page), so the mapping step starts from the last mapping. `fallback` (3) when nothing is mapped.
 */
export function guessOffset(
	pages: { page: number; pdfPage: number | null }[],
	fallback = 3
): number {
	const counts = new Map<number, number>();
	for (const p of pages) {
		if (p.pdfPage === null) continue;
		const d = p.page - p.pdfPage;
		counts.set(d, (counts.get(d) ?? 0) + 1);
	}
	let best = fallback;
	let bestN = 0;
	for (const [d, n] of counts)
		if (n > bestN || (n === bestN && d === fallback)) {
			best = d;
			bestN = n;
		}
	return bestN && best >= 0 ? best : fallback;
}

// ---- kit status checklist ---------------------------------------------------------

/** What the install holds for a kit; built on the server, shown by `KitStatus.svelte`. */
export interface KitStatusDto {
	model: {
		version: string;
		createdAt: string | null;
		source: string;
		/** Parts with geometry in the GLB / parts in the kit. */
		rendered: number;
		total: number;
		placed: number;
		/** Names of parts the GLB has but nobody placed yet. */
		unplaced: string[];
		/** Names of parts the kit places in 3D but the GLB lacks (parts without any STEP, such as stand-ins, are not listed). */
		missing: string[];
	} | null;
	print: {
		withGeometry: number;
		total: number;
		missing: string[];
		paintedFaces: number;
		withSettings: number;
		sources: string[];
	};
	guide: { uploaded: number; pages: number; mapped: number };
	/** True while the bundled MakeGood kit pack is being downloaded or installed (start-up, background). */
	installing?: boolean;
	/** What the install is doing ("Installing MakeGood files…"); only while `installing`. */
	installMessage?: string;
}

import { MAKEGOOD_GUIDE_URL } from '../makegood.ts';
/** Where MakeGood publishes the build guide PDF (it is not bundled); one source of truth. */
export { MAKEGOOD_GUIDE_URL };

export type KitReadiness = 'ready' | 'installing' | 'partial' | 'missing';

/**
 * The overall state of a kit for the setup wizard. The guide never counts (it is not bundled);
 * parts without 3D that no file can add are not in `model.missing`, so they do not either.
 */
export function kitReadiness(s: KitStatusDto): { state: KitReadiness; note: string } {
	if (s.installing) return { state: 'installing', note: s.installMessage ?? '' };
	const hasPrint = s.print.withGeometry > 0;
	if (!s.model && !hasPrint) return { state: 'missing', note: '' };
	if (!s.model) return { state: 'partial', note: 'There is no 3D preview yet.' };
	if (!hasPrint) return { state: 'partial', note: 'Print geometry is missing.' };
	if (s.print.missing.length)
		return {
			state: 'partial',
			note: `${plural(s.print.missing.length, 'part')} without print geometry.`
		};
	if (s.model.missing.length)
		return {
			state: 'partial',
			note: `${plural(s.model.missing.length, 'part')} missing from the 3D model.`
		};
	return { state: 'ready', note: '' };
}

/** Kit parts that have no 3D preview and none is expected (stand-ins, no STEP). */
export const partsWithoutPreview = (m: NonNullable<KitStatusDto['model']>) =>
	Math.max(0, m.total - m.rendered - m.missing.length);

/** `info` is a neutral, optional row: it never needs attention. */
export type RowState = 'ok' | 'partial' | 'missing' | 'info';
export interface ChecklistRow {
	id: TargetKind;
	title: string;
	state: RowState;
	/** Facts, one per line. */
	lines: string[];
	/** Neutral notes (no warning styling). */
	notes: string[];
	/** What to add when missing or partial. */
	hints: string[];
	link?: { href: string; text: string };
}

const names = (list: string[], max = 4) =>
	list.length <= max
		? list.join(', ')
		: `${list.slice(0, max).join(', ')} and ${list.length - max} more`;

/** The checklist rows for a kit status, in the order makers think of them. */
export function kitChecklist(s: KitStatusDto): ChecklistRow[] {
	const rows: ChecklistRow[] = [];
	const m = s.model;
	if (!m)
		rows.push({
			id: 'model',
			title: '3D chair',
			state: 'missing',
			lines: ['No 3D model yet'],
			notes: [],
			hints: ['Add the STEP files (a zip of them, or loose .step files).']
		});
	else {
		const hints: string[] = [];
		const notes: string[] = [];
		if (m.missing.length)
			hints.push(
				`${names(m.missing)} ${m.missing.length === 1 ? 'has' : 'have'} no 3D geometry: add the STEP file for ${m.missing.length === 1 ? 'it' : 'them'}.`
			);
		if (m.unplaced.length)
			hints.push(
				`${names(m.unplaced)} ${m.unplaced.length === 1 ? 'is' : 'are'} not placed yet: nudge in Advanced: part placement.`
			);
		const none = partsWithoutPreview(m);
		if (none)
			notes.push(
				`${plural(none, 'part')} ${none === 1 ? 'has' : 'have'} no 3D preview: drawn as stand-ins or no STEP`
			);
		rows.push({
			id: 'model',
			title: '3D chair',
			state: m.missing.length || m.unplaced.length ? 'partial' : 'ok',
			lines: [
				`${m.rendered} of ${m.total} parts rendered, ${m.placed} placed, ${m.unplaced.length} not placed`,
				`Version ${m.version.slice(0, 8)}${m.createdAt ? `, ${m.createdAt.slice(0, 10)}` : ''}`,
				`Source: ${m.source || 'unknown'}`
			],
			notes,
			hints
		});
	}
	const p = s.print;
	const hints: string[] = [];
	if (p.missing.length)
		hints.push(
			`${names(p.missing)} ${p.missing.length === 1 ? 'has' : 'have'} no print geometry: add a 3MF profile containing ${p.missing.length === 1 ? 'it' : 'them'}.`
		);
	rows.push({
		id: 'print',
		title: 'Print geometry',
		state: p.withGeometry === 0 ? 'missing' : p.missing.length ? 'partial' : 'ok',
		lines:
			p.withGeometry === 0
				? ['Using the built-in footprints only']
				: [
						`${p.withGeometry} of ${p.total} parts with geometry`,
						`${p.paintedFaces.toLocaleString()} painted support faces, settings on ${p.withSettings} parts`,
						`Source: ${p.sources.join(', ') || 'unknown'}`
					],
		notes: [],
		hints:
			p.withGeometry === 0
				? ['Add the 3MF profile (or a zip of profiles such as the harness pack).']
				: hints
	});
	// The guide is not bundled (MakeGood's page numbers are referenced instead): informational only.
	const g = s.guide;
	rows.push({
		id: 'guide',
		title: 'Guide',
		state: g.uploaded > 0 && g.mapped >= g.pages ? 'ok' : 'info',
		lines:
			g.uploaded === 0
				? ["Optional: MakeGood's maker guide is not included"]
				: [
						`${g.uploaded} PDF pages imported`,
						`${g.mapped} of ${g.pages} guide pages mapped to an image`
					],
		notes: [],
		hints:
			g.uploaded > 0 && g.mapped < g.pages
				? ['Set the page offset below and save the mapping.']
				: [],
		...(g.uploaded === 0
			? { link: { href: MAKEGOOD_GUIDE_URL, text: "MakeGood's maker guide" } }
			: {})
	});
	return rows;
}
