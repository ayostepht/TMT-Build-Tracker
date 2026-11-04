import { resolve } from '$app/paths';

/** Printers page of the workspace (organization) that owns a build, from the layout's team list. */
export function printersHrefFor(
	teams: { id: string; slug: string }[] | undefined,
	organizationId: string
): string | null {
	const t = teams?.find((x) => x.id === organizationId);
	return t ? resolve('/(app)/teams/[slug]/printers', { slug: t.slug }) : null;
}
