import { and, eq } from 'drizzle-orm';
import {
	effectivePartRoles,
	materialAllowed,
	newRoleKey,
	ROLE_KEY_RE,
	roleBlockedReason,
	sameFilament
} from '#lib/domain/design.ts';
import type { BuildView, FilamentRole } from '#lib/domain/types.ts';
import { ApiError } from '../access';
import { mutateBuild } from '../builds/actions';
import { remapRoleKey } from '../builds/role-keys';
import type { Db } from '../db';
import { buildFilaments, builds, colorDesigns } from '../db/schema';
import { canSeeDesign } from './access';
import { isObj, type Obj } from '#lib/domain/guards.ts';

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
 * Edit a build's color design (editors and owners; one `design.update` activity row and one SSE event per call).
 * Parts of the body run in this order inside one transaction:
 *
 * - `addRole: { key?, name, material, hex }`: add a slot.
 * - `palette: { label, slots: { [roleKey]: { name, material, hex } }, reset?: true }`: set those slots'
 *   filaments. With `reset`, every unlocked part goes back to its kit slot, and a locked part sitting on a
 *   slot whose filament changes moves to a slot holding its old filament (an existing non-kit slot with the
 *   same name/material/hex, else a new one, reported as `lockedAdded`). Without `reset` (Undo) only the
 *   filaments are written.
 * - `partRoles: { slug: roleKey }`: move parts.
 * - `lock: { slugs, locked }`: "Lock color" on or off (`design.lockedParts`).
 * - `removeRole: key` (+ `replaceWith: key`): remove a slot. A used slot needs `replaceWith`; all its parts
 *   (also those of unchosen options) move there, and grams keyed to it follow. Its spools and Spoolman link go.
 * - `removeRoles: [key]`: remove slots that are unused by now (Undo of an auto-added lock slot).
 */
export function updateBuildDesign(db: Db, buildId: string, userId: string, body: unknown): void {
	if (!isObj(body)) bad('Invalid body');
	const keys = ['partRoles', 'addRole', 'removeRole', 'removeRoles', 'palette', 'lock'] as const;
	if (keys.every((k) => body[k] === undefined)) bad('Nothing to update');
	if (body.replaceWith !== undefined && body.removeRole === undefined)
		bad('replaceWith needs removeRole');
	mutateBuild(db, buildId, userId, (tx, view) => {
		const filaments: FilamentRole[] = [...view.filaments];
		const payload: Obj = {};
		const roles = effectivePartRoles(view);
		const partOf = (slug: string) => view.allParts.find((p) => p.slug === slug);
		const locked = new Set(view.allParts.filter((p) => p.locked).map((p) => p.slug));
		const moves: Obj[] = [];
		const move = (slug: string, role: string, record = true) => {
			const part = partOf(slug)!;
			const f = filaments.find((x) => x.key === role)!;
			roles[slug] = role;
			const prior = moves.find((m) => m.slug === slug);
			if (prior) Object.assign(prior, { role, roleName: f.name });
			else if (record) moves.push({ slug, name: part.name, role, roleName: f.name });
		};

		const insertSlot = (key: string, name: string, material: string, hex: string) => {
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
				spoolmanSpoolId: null,
				kit: false
			});
		};

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
			insertSlot(key, name, material, hex);
			payload.added = { key, name, material, hex };
		}

		const applyPalette = (raw: unknown) => {
			if (!isObj(raw)) bad('palette must be an object');
			if (!isObj(raw.slots)) bad('palette.slots must be an object');
			const entries = Object.entries(raw.slots);
			if (!entries.length || entries.length > 20) bad('palette.slots needs 1 to 20 colors');
			const label = raw.label === undefined ? 'new' : str(raw.label, 'label', 200);
			const reset = raw.reset === true;
			const before = new Map(filaments.map((f) => [f.key, { ...f }]));
			const changed = new Set<string>();
			for (const [key, v] of entries) {
				const f = filaments.find((x) => x.key === key);
				if (!f) bad(`Unknown color "${key}"`);
				if (!isObj(v)) bad('Each palette slot must be an object');
				const name = str(v.name, 'name');
				const material = str(v.material, 'material');
				const hex = hexOf(v.hex);
				if (!sameFilament(f, { name, material, hex })) changed.add(key);
				tx.update(buildFilaments)
					.set({ name, material, hex })
					.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, key)))
					.run();
				Object.assign(f, { name, material, hex });
			}
			const pal: Obj = { label };
			payload.palette = pal;
			if (!reset) return;

			// Locked parts on a slot whose filament changed keep their exact color on another slot.
			const byOld = new Map<string, string[]>();
			for (const p of view.allParts)
				if (locked.has(p.slug) && changed.has(roles[p.slug]))
					byOld.set(roles[p.slug], [...(byOld.get(roles[p.slug]) ?? []), p.slug]);
			const lockedAdded: Obj[] = [];
			for (const [oldKey, slugs] of byOld) {
				const old = before.get(oldKey)!;
				let target = filaments.find((f) => !f.kit && !changed.has(f.key) && sameFilament(f, old));
				if (!target) {
					const key = newRoleKey(
						filaments.map((f) => f.key),
						old.name
					);
					insertSlot(key, old.name, old.material, old.hex);
					target = filaments[filaments.length - 1];
					lockedAdded.push({
						key,
						name: old.name,
						material: old.material,
						parts: slugs.map((s) => partOf(s)!.name)
					});
				}
				for (const s of slugs) move(s, target.key);
			}
			if (lockedAdded.length) payload.lockedAdded = lockedAdded;

			// Everything else goes back to the kit slot (unless that slot's new material cannot take the part).
			let resetCount = 0;
			for (const p of view.allParts) {
				if (locked.has(p.slug) || roles[p.slug] === p.defaultRole) continue;
				const f = filaments.find((x) => x.key === p.defaultRole);
				if (!f || roleBlockedReason(p, f)) continue;
				move(p.slug, p.defaultRole);
				resetCount++;
			}
			pal.reset = resetCount;
			pal.kept = locked.size;
		};
		if (body.palette !== undefined) applyPalette(body.palette);

		if (body.partRoles !== undefined) {
			if (!isObj(body.partRoles)) bad('partRoles must be an object');
			const entries = Object.entries(body.partRoles);
			if (entries.length > 500) bad('Too many parts');
			for (const [slug, role] of entries) {
				const part = partOf(slug);
				if (!part) bad(`Unknown part "${slug}"`);
				if (typeof role !== 'string') bad('Role keys must be strings');
				const f = filaments.find((x) => x.key === role);
				if (!f) bad(`Unknown color "${role}"`);
				const why = roleBlockedReason(part, f);
				if (why) bad(`${why}, so it cannot use ${f.name} (${f.material})`);
				if (roles[slug] === role) continue;
				move(slug, role);
			}
		}

		if (body.lock !== undefined) {
			if (!isObj(body.lock)) bad('lock must be an object');
			const { slugs, locked: on } = body.lock;
			if (!Array.isArray(slugs) || !slugs.length || slugs.length > 500)
				bad('lock.slugs is required');
			if (typeof on !== 'boolean') bad('lock.locked must be true or false');
			const changedNames: string[] = [];
			for (const slug of slugs) {
				const part = typeof slug === 'string' ? partOf(slug) : undefined;
				if (!part) bad(`Unknown part "${String(slug)}"`);
				if (locked.has(part.slug) === on) continue;
				if (on) locked.add(part.slug);
				else locked.delete(part.slug);
				changedNames.push(part.name);
			}
			if (changedNames.length) payload[on ? 'locked' : 'unlocked'] = changedNames;
		}

		const removeSlot = (key: string, replaceWith?: string): Obj => {
			const f = filaments.find((x) => x.key === key);
			if (!f) throw new ApiError(404, 'Unknown color');
			if (f.kit) bad("The kit's own colors cannot be removed");
			const affected = view.allParts.filter((p) => roles[p.slug] === key);
			if (affected.length) {
				if (!replaceWith)
					throw new ApiError(409, 'Choose the color that replaces it for its parts first');
				if (replaceWith === key) bad('A color cannot replace itself');
				const to = filaments.find((x) => x.key === replaceWith);
				if (!to) bad(`Unknown color "${replaceWith}"`);
				const blocked = affected.filter((p) => roleBlockedReason(p, to));
				if (blocked.length)
					bad(
						`${to.name} (${to.material}) cannot take ${blocked.map((p) => p.name).join(', ')}: ${roleBlockedReason(blocked[0], to)}`
					);
				// The removal sentence already says where they went, so these moves are not listed separately.
				for (const p of affected) move(p.slug, to.key, false);
			} else if (replaceWith !== undefined && !filaments.some((x) => x.key === replaceWith))
				bad(`Unknown color "${replaceWith}"`);
			if (replaceWith) remapRoleKey(tx, buildId, key, replaceWith);
			tx.delete(buildFilaments)
				.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, key)))
				.run();
			filaments.splice(filaments.indexOf(f), 1);
			return {
				key,
				name: f.name,
				material: f.material,
				hex: f.hex,
				spools: f.spools,
				...(f.spoolmanSpoolId !== null ? { spoolmanSpoolId: f.spoolmanSpoolId } : {}),
				parts: affected.length
			};
		};

		if (body.removeRole !== undefined) {
			const key = str(body.removeRole, 'removeRole');
			const rep = body.replaceWith === undefined ? undefined : str(body.replaceWith, 'replaceWith');
			const removed = removeSlot(key, rep);
			payload.removed = removed;
			const to = rep ? filaments.find((f) => f.key === rep) : undefined;
			if (to && removed.parts)
				payload.replacedBy = { key: to.key, name: to.name, material: to.material };
		}
		if (body.removeRoles !== undefined) {
			if (!Array.isArray(body.removeRoles) || body.removeRoles.length > 20)
				bad('removeRoles must be a list of color keys');
			for (const k of body.removeRoles) {
				const key = str(k, 'removeRoles');
				if (view.allParts.some((p) => roles[p.slug] === key))
					throw new ApiError(409, 'Move its parts to another color first');
				removeSlot(key);
			}
		}

		if (moves.length) payload.moves = moves;
		if (!Object.keys(payload).length) {
			if (body.lock !== undefined) return { kind: 'design.update', skip: true };
			bad('Nothing to update');
		}
		const row = tx
			.select({ design: builds.design })
			.from(builds)
			.where(eq(builds.id, buildId))
			.get();
		const { lockedParts: _drop, ...rest } = (row?.design ?? {}) as Obj;
		void _drop;
		// Slugs that no longer exist in the template are dropped; the rest keep their template order.
		const lockedParts = view.allParts.map((p) => p.slug).filter((s) => locked.has(s));
		tx.update(builds)
			.set({
				design: {
					...rest,
					roles: rolesOf(filaments),
					partRoles: roles,
					...(lockedParts.length ? { lockedParts } : {})
				}
			})
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
