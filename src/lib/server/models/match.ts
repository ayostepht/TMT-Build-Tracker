/**
 * Matching of a template's parts to the entries of an uploaded STEP zip.
 * Pure (no fs, no occt): used by the converter worker and by tests.
 */

export interface MatchPart {
	slug: string;
	sourceFile: string;
	components: { name?: string; file?: string }[];
}

export interface MatchedFile {
	/** Zip entry path. */
	entry: string;
	/** Slugs that include this file's geometry (a file may feed several slugs, e.g. rim variants). */
	slugs: string[];
}

export interface PartMatch {
	slug: string;
	/** Zip entries merged into this part, in the order the part asks for them. */
	entries: string[];
	/** Wanted file names that no (non-obsolete) zip entry matches. */
	missing: string[];
}

export interface MatchPlan {
	files: MatchedFile[];
	parts: PartMatch[];
	/** Entries not used by any part, by reason. */
	assemblies: string[];
	obsolete: string[];
	unknown: string[];
}

/** Lower-cased base name without a `.step` / `.stp` extension and with collapsed spaces. */
export function normalizeStepName(name: string): string {
	const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
	return base
		.replace(/\.(step|stp)$/i, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function isObsolete(entry: string): boolean {
	return entry
		.replace(/\\/g, '/')
		.split('/')
		.slice(0, -1)
		.some((seg) => /^obsolete$/i.test(seg.trim()));
}

function isJunk(entry: string): boolean {
	const p = entry.replace(/\\/g, '/');
	if (p.endsWith('/')) return true;
	if (p.startsWith('__MACOSX/')) return true;
	const base = p.split('/').pop() ?? '';
	return base.startsWith('.') || base === 'Thumbs.db';
}

/** File names a part asks for: its components' files when it has any, otherwise `sourceFile`. */
export function wantedFiles(part: MatchPart): string[] {
	const comp = part.components.map((c) => c.file?.trim()).filter((f): f is string => !!f);
	const out = comp.length ? comp : part.sourceFile.trim() ? [part.sourceFile.trim()] : [];
	// A part with component files may also name a real file in sourceFile (not a "Multiple files" note).
	if (comp.length && part.sourceFile.trim() && /\.(step|stp)$/i.test(part.sourceFile.trim()))
		out.push(part.sourceFile.trim());
	return [...new Set(out)];
}

export function matchParts(parts: MatchPart[], zipEntries: string[]): MatchPlan {
	const entries = zipEntries.filter((e) => !isJunk(e));
	// Prefer shallow, non-obsolete entries when two share a name.
	const byName = new Map<string, string>();
	for (const e of [...entries].sort(
		(a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)
	)) {
		if (isObsolete(e)) continue;
		const key = normalizeStepName(e);
		if (!byName.has(key)) byName.set(key, e);
	}

	const used = new Set<string>();
	const fileSlugs = new Map<string, string[]>();
	const partMatches: PartMatch[] = [];
	for (const part of parts) {
		const found: string[] = [];
		const missing: string[] = [];
		for (const want of wantedFiles(part)) {
			const entry = byName.get(normalizeStepName(want));
			if (!entry) {
				missing.push(want);
				continue;
			}
			if (!found.includes(entry)) found.push(entry);
			used.add(entry);
			const list = fileSlugs.get(entry) ?? [];
			if (!list.includes(part.slug)) list.push(part.slug);
			fileSlugs.set(entry, list);
		}
		partMatches.push({ slug: part.slug, entries: found, missing });
	}

	const assemblies: string[] = [];
	const obsolete: string[] = [];
	const unknown: string[] = [];
	for (const e of entries) {
		if (used.has(e)) continue;
		if (isObsolete(e)) obsolete.push(e);
		else if (/assembly/i.test(e.split('/').pop() ?? '')) assemblies.push(e);
		else unknown.push(e);
	}
	return {
		files: [...fileSlugs].map(([entry, slugs]) => ({ entry, slugs })),
		parts: partMatches,
		assemblies,
		obsolete,
		unknown
	};
}
