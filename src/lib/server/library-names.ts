import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db';
import { templateParts } from './db/schema';
import type { LibraryPieceView } from './custom-library';

/** A saved part with the kit part names it replaces, for the saved-parts page and the setup wizard. */
export type LibraryPieceListed = LibraryPieceView & { replacesNames: string[] };

/** Add the display names of the kit parts each saved part replaces (the slug when the kit is gone). */
export function withReplacedNames(db: Db, pieces: LibraryPieceView[]): LibraryPieceListed[] {
	const names = new Map<string, string>();
	for (const templateId of new Set(
		pieces.map((p) => p.templateId).filter((t): t is string => !!t)
	)) {
		const slugs = [
			...new Set(pieces.filter((p) => p.templateId === templateId).flatMap((p) => p.replaces))
		];
		if (!slugs.length) continue;
		for (const r of db
			.select({ slug: templateParts.slug, name: templateParts.name })
			.from(templateParts)
			.where(and(eq(templateParts.templateId, templateId), inArray(templateParts.slug, slugs)))
			.all())
			names.set(`${templateId}:${r.slug}`, r.name);
	}
	return pieces.map((p) => ({
		...p,
		replacesNames: p.replaces.map((s) => names.get(`${p.templateId}:${s}`) ?? s)
	}));
}
