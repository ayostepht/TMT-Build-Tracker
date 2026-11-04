/**
 * Kit import planning, pure: given what a dropped file turned out to be (its kind and, for zips
 * and 3MFs, its entry names) decide what it can feed in the kit (3D chair, print geometry, guide,
 * hardware model) and in which order the import runs. No DOM, no network; `kit-probe.ts` does the
 * sniffing, `KitImportCard.svelte` runs the plan.
 */

export type TargetKind = 'model' | 'print' | 'guide' | 'hardware';
export type FileKind = 'zip' | '3mf' | 'step' | 'pdf' | 'glb' | 'unknown';

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pdfDesc = (pages?: number) => (pages ? `${pages}-page PDF` : 'PDF');

// ---- per-file rules ---------------------------------------------------------------

function threeMfFeeds(p: Probe): Feed[] {
	const entries = p.entries ?? [];
	const plates = plateCount(entries);
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
	const glbs = entries.filter(isGlbName).length;
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
	if (glbs)
		feeds.push({ kind: 'hardware', enabled: true, label: 'Hardware model (GLB in this zip)' });
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
		case 'glb':
			feeds = [{ kind: 'hardware', enabled: true, label: 'Hardware model' }];
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
				? 'Nothing in this zip looks like STEP, 3MF, PDF or GLB files'
				: 'Not recognised (expected .zip, .step, .3mf, .pdf or .glb)';
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
	glb: 0,
	unknown: 9
};

/**
 * Build the import plan for a set of dropped files (in drop order). Duplicates (same name and
 * size dropped twice) are switched off; where only one file can win (guide, hardware GLB) the best
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
	for (const kind of ['guide', 'hardware'] as const) {
		const cands = items
			.flatMap((it) => it.feeds.filter((f) => f.kind === kind && f.enabled).map((f) => ({ it, f })))
			.sort((a, b) => PRIORITY[a.it.probe.kind] - PRIORITY[b.it.probe.kind]);
		for (const c of cands.slice(1)) {
			c.f.enabled = false;
			c.f.note = `Only one ${kind === 'guide' ? 'guide' : 'hardware model'} can be imported; using ${cands[0].it.name}`;
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

/** How many STEP files an item brings to the 3D chair. */
export function stepCount(it: PlanItem): number {
	if (it.probe.kind === 'step') return 1;
	return (it.probe.entries ?? []).filter(isStepName).length;
}

/** The steps to run for the enabled feeds: 3D chair, print geometry (biggest first), hardware, guide. */
export function makeSteps(plan: Plan): Step[] {
	const on = (kind: TargetKind) =>
		plan.items.filter((it) => it.feeds.some((f) => f.kind === kind && f.enabled));
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
	const hw = on('hardware')[0];
	if (hw)
		steps.push({
			id: 'hardware',
			kind: 'hardware',
			title: `Hardware model: ${hw.name}`,
			itemIds: [hw.id]
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
		/** Names of parts missing from the GLB. */
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
	hardware: boolean;
	/** True while the bundled MakeGood kit pack is being downloaded or installed (start-up, background). */
	installing?: boolean;
	/** What the install is doing ("Installing MakeGood files…"); only while `installing`. */
	installMessage?: string;
}

export type RowState = 'ok' | 'partial' | 'missing';
export interface ChecklistRow {
	id: TargetKind;
	title: string;
	state: RowState;
	/** Facts, one per line. */
	lines: string[];
	/** What to add when missing or partial. */
	hints: string[];
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
			hints: ['Add the STEP files (a zip of them, or loose .step files).']
		});
	else {
		const hints: string[] = [];
		if (m.missing.length)
			hints.push(
				`${names(m.missing)} ${m.missing.length === 1 ? 'has' : 'have'} no 3D geometry: add the STEP file for ${m.missing.length === 1 ? 'it' : 'them'}.`
			);
		if (m.unplaced.length)
			hints.push(
				`${names(m.unplaced)} ${m.unplaced.length === 1 ? 'is' : 'are'} not placed yet: nudge in Advanced: part placement.`
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
		hints:
			p.withGeometry === 0
				? ['Add the 3MF profile (or a zip of profiles such as the harness pack).']
				: hints
	});
	const g = s.guide;
	rows.push({
		id: 'guide',
		title: 'Guide',
		state: g.uploaded === 0 ? 'missing' : g.mapped < g.pages ? 'partial' : 'ok',
		lines:
			g.uploaded === 0
				? ['No guide pages yet']
				: [
						`${g.uploaded} PDF pages imported`,
						`${g.mapped} of ${g.pages} guide pages mapped to an image`
					],
		hints:
			g.uploaded === 0
				? ['Add the guide PDF, or the 3MF that contains it.']
				: g.mapped < g.pages
					? ['Set the page offset below and save the mapping.']
					: []
	});
	rows.push({
		id: 'hardware',
		title: 'Hardware model',
		state: s.hardware ? 'ok' : 'missing',
		lines: [s.hardware ? 'Hardware GLB added' : 'Optional, not added'],
		hints: s.hardware ? [] : ['Add the hardware .glb to show casters, bolts and bearings.']
	});
	return rows;
}
