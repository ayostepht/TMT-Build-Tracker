import { and, eq } from 'drizzle-orm';
import {
	effectivePartRoles,
	materialAllowed,
	newRoleKey,
	ROLE_KEY_RE,
	roleBlockedReason
} from '#lib/domain/design.ts';
import type { BuildView, FilamentRole } from '#lib/domain/types.ts';
import { ApiError } from '../access';
import { mutateBuild } from '../builds/actions';
import type { Db } from '../db';
import { buildFilaments, builds, colorDesigns, templateFilamentRoles } from '../db/schema';
import { canSeeDesign } from './access';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
function bad(msg: string): never {
	throw new ApiError(400, msg);
}

export interface DesignRole {
	key: string;
	name: string;
	material: string;
	hex: string;
}

const rolesOf = (filaments: FilamentRole[]): DesignRole[] =>
	filaments.map((f) => ({ key: f.key, name: f.name, material: f.material, hex: f.hex }));

function str(v: unknown, field: string, max = 100): string {
	if (typeof v !== 'string' || !v.trim() || v.length > max)
		bad(`${field} must be a non-empty string`);
	return v.trim();
}
function hexOf(v: unknown): string {
	if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) bad('hex must be like #1a2b3c');
	return v.toLowerCase();
}

/**
 * Edit a build's color design: move parts between filament slots (`partRoles`),
 * add a slot (`addRole`) or remove an unused one (`removeRole`). Editors and
 * owners only; one `design.update` activity row and one SSE event per call.
 */
export function updateBuildDesign(db: Db, buildId: string, userId: string, body: unknown): void {
	if (!isObj(body)) bad('Invalid body');
	if (body.partRoles === undefined && body.addRole === undefined && body.removeRole === undefined)
		bad('Nothing to update');
	mutateBuild(db, buildId, userId, (tx, view) => {
		const filaments: FilamentRole[] = [...view.filaments];
		const payload: Obj = {};

		if (body.addRole !== undefined) {
			if (!isObj(body.addRole)) bad('addRole must be an object');
			const a = body.addRole;
			const name = str(a.name, 'name');
			const material = str(a.material, 'material');
			const hex = hexOf(a.hex);
			let key: string;
			if (a.key === undefined || a.key === null || a.key === '') {
				key = newRoleKey(
					filaments.map((f) => f.key),
					name
				);
			} else {
				if (typeof a.key !== 'string' || !ROLE_KEY_RE.test(a.key)) bad('Invalid color key');
				if (filaments.some((f) => f.key === a.key))
					throw new ApiError(409, 'That color key exists');
				key = a.key;
			}
			tx.insert(buildFilaments)
				.values({ buildId, roleKey: key, name, material, hex, spools: 0 })
				.run();
			filaments.push({
				key,
				name,
				material,
				hex,
				tpu: false,
				spools: 0,
				recommendedSpools: 1,
				spoolmanSpoolId: null
			});
			payload.added = { key, name, material, hex };
		}

		const roles = effectivePartRoles(view);
		if (body.partRoles !== undefined) {
			if (!isObj(body.partRoles)) bad('partRoles must be an object');
			const entries = Object.entries(body.partRoles);
			if (entries.length > 500) bad('Too many parts');
			const moves: Obj[] = [];
			for (const [slug, role] of entries) {
				const part = view.allParts.find((p) => p.slug === slug);
				if (!part) bad(`Unknown part "${slug}"`);
				if (typeof role !== 'string') bad('Role keys must be strings');
				const f = filaments.find((x) => x.key === role);
				if (!f) bad(`Unknown color "${role}"`);
				const why = roleBlockedReason(part, f);
				if (why) bad(`${why}, so it cannot use ${f.name} (${f.material})`);
				if (roles[slug] === role) continue;
				roles[slug] = role;
				moves.push({ slug, name: part.name, role, roleName: f.name });
			}
			if (moves.length) payload.moves = moves;
		}

		if (body.removeRole !== undefined) {
			const key = str(body.removeRole, 'removeRole');
			const f = filaments.find((x) => x.key === key);
			if (!f) throw new ApiError(404, 'Unknown color');
			if (
				tx
					.select({ k: templateFilamentRoles.key })
					.from(templateFilamentRoles)
					.where(
						and(
							eq(templateFilamentRoles.templateId, view.build.templateId),
							eq(templateFilamentRoles.key, key)
						)
					)
					.get()
			)
				bad("The kit's own colors cannot be removed");
			if (Object.values(roles).includes(key))
				throw new ApiError(409, 'Move its parts to another color first');
			tx.delete(buildFilaments)
				.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, key)))
				.run();
			filaments.splice(filaments.indexOf(f), 1);
			payload.removed = { key, name: f.name };
		}

		if (!Object.keys(payload).length) bad('Nothing to update');
		const row = tx
			.select({ design: builds.design })
			.from(builds)
			.where(eq(builds.id, buildId))
			.get();
		tx.update(builds)
			.set({ design: { ...(row?.design ?? {}), roles: rolesOf(filaments), partRoles: roles } })
			.where(eq(builds.id, buildId))
			.run();
		return { kind: 'design.update', payload };
	});
}

/**
 * Replace a build's colors with a saved design: slot names, materials and hexes
 * (spools on hand are kept for slots the build already has) and every part's
 * slot. Editors and owners of the build; the design must be visible to them and
 * be for the same template.
 */
export function applyDesignToBuild(
	db: Db,
	designId: string,
	buildId: string,
	userId: string
): void {
	const d = db.select().from(colorDesigns).where(eq(colorDesigns.id, designId)).get();
	if (!d || !canSeeDesign(db, d, userId)) throw new ApiError(404, 'Not found');
	mutateBuild(db, buildId, userId, (tx, view) => {
		if (view.build.templateId !== d.templateId)
			bad('That design is for a different kit than this build');
		replaceColors(tx, view, d);
		return { kind: 'design.apply', payload: { designId: d.id, designName: d.name } };
	});
}

function replaceColors(tx: Db, view: BuildView, d: typeof colorDesigns.$inferSelect): void {
	const have = new Map(view.filaments.map((f) => [f.key, f]));
	for (const r of d.roles) {
		if (have.has(r.key)) {
			tx.update(buildFilaments)
				.set({ name: r.name, material: r.material, hex: r.hex.toLowerCase() })
				.where(and(eq(buildFilaments.buildId, view.build.id), eq(buildFilaments.roleKey, r.key)))
				.run();
		} else {
			tx.insert(buildFilaments)
				.values({
					buildId: view.build.id,
					roleKey: r.key,
					name: r.name,
					material: r.material,
					hex: r.hex.toLowerCase(),
					spools: 0
				})
				.run();
		}
	}
	const keys = new Set([...have.keys(), ...d.roles.map((r) => r.key)]);
	const partRoles: Record<string, string> = {};
	for (const p of view.allParts) {
		const r = d.partRoles[p.slug];
		partRoles[p.slug] =
			r &&
			keys.has(r) &&
			materialAllowed(
				p.allowedMaterials,
				(d.roles.find((x) => x.key === r) ?? have.get(r))?.material ?? ''
			)
				? r
				: p.role;
	}
	const roles = [
		...d.roles,
		...view.filaments.filter((f) => !d.roles.some((r) => r.key === f.key))
	].map((r) => ({ key: r.key, name: r.name, material: r.material, hex: r.hex.toLowerCase() }));
	tx.update(builds)
		.set({ design: { id: d.id, slug: d.slug, name: d.name, roles, partRoles } })
		.where(eq(builds.id, view.build.id))
		.run();
}
