import { and, eq, ne, sql } from 'drizzle-orm';
import {
	MANUAL_HOST_PLACEHOLDER,
	PRINTER_KIND_INFO,
	PRINTER_KINDS,
	type PrinterKind,
	type PrinterPublic,
	type PrinterStatus
} from '#lib/printers/status.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { cleanHost } from '#lib/printers/address.ts';
import { cameraSupported, checkCameraUrl } from '#lib/printers/camera-url.ts';
import {
	parseShareLink,
	shareLinkFor,
	supportsShareLink,
	SHARE_LINK_HOST_PLACEHOLDER,
	SHARE_LINK_KEY,
	isOctoEverywhereAddress
} from '#lib/printers/share-link.ts';
import { ApiError } from '../access';
import type { Db } from '../db';
import {
	isPublicMode,
	linkPrintersPerWorkspace,
	linkPrintersTotal,
	manualPrintersPerWorkspace
} from '../config';
import { QuotaError } from '../quota';
import { printers } from '../db/schema';
import { decryptSecrets, encryptSecrets, type Secrets } from './secrets';
import { hostBlockReason, PUBLIC_MODE_MESSAGE } from './outbound';
import type { PrinterConfig } from './types';

type Row = typeof printers.$inferSelect;
type Obj = Record<string, unknown>;

const bad = (m: string): never => {
	throw new ApiError(400, m);
};

/** Names of fields that are not secret: shown back to the user. */
const publicKeys = (kind: PrinterKind) =>
	PRINTER_KIND_INFO[kind].secrets.filter((s) => !s.secret).map((s) => s.key);

export function toPublic(r: Row, editor = false): PrinterPublic {
	const kind = r.kind as PrinterKind;
	const secrets = decryptSecrets(r.secretEnc);
	const pub = publicKeys(kind);
	const connection: PrinterPublic['connection'] =
		kind === 'manual' ? 'manual' : shareLinkFor(kind, secrets) ? 'link' : 'lan';
	return {
		id: r.id,
		organizationId: r.organizationId,
		name: r.name,
		kind,
		host: r.host,
		port: r.port,
		catalogId: r.catalogId,
		enabled: r.enabled,
		cameraEnabled: r.cameraEnabled,
		cameraUrl: editor ? r.cameraUrl : null,
		lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
		status: (r.lastStatus as PrinterStatus | null) ?? null,
		secretsSet: Object.keys(secrets).filter((k) => secrets[k]),
		identifiers: Object.fromEntries(pub.filter((k) => secrets[k]).map((k) => [k, secrets[k]])),
		connection,
		// Manual printers are never dialled; a link printer is allowed on the hosted site; anything
		// else is judged by its address (and is refused outright on the hosted site).
		blocked: connection === 'lan' ? hostBlockReason(r.host) : null
	};
}

export function toConfig(r: Row): PrinterConfig {
	return {
		id: r.id,
		kind: r.kind as PrinterKind,
		host: r.host,
		port: r.port,
		secrets: decryptSecrets(r.secretEnc)
	};
}

export function listPrinters(db: Db, orgId: string): Row[] {
	return db
		.select()
		.from(printers)
		.where(eq(printers.organizationId, orgId))
		.orderBy(printers.name)
		.all();
}

export function getPrinter(db: Db, id: string): Row | undefined {
	return db.select().from(printers).where(eq(printers.id, id)).get();
}

/** Valid host: a hostname or IPv4/IPv6 literal, no scheme, path or credentials. */
export function parseHost(v: unknown): string {
	if (typeof v !== 'string') return bad('host is required');
	const h = v.trim();
	if (isOctoEverywhereAddress(h))
		return bad('That is an OctoEverywhere link: put it in the "OctoEverywhere shared link" field');
	if (!h || h.length > 253 || !/^[A-Za-z0-9.:_-]+$/.test(h))
		return bad('Enter just the printer address, like 192.168.0.50');
	// An IP literal on a public or reserved range can never be used: say so now, not at connect.
	const why = hostBlockReason(h);
	if (why && !isPublicMode()) return bad(why);
	return h;
}

/** SSRF guard at save time: the camera must be on the printer's own host (any port). */
function checkCamera(url: string | null | undefined, host: string, kind: PrinterKind): void {
	if (!url) return;
	if (!cameraSupported(kind)) bad('This printer type has no camera support');
	const c = checkCameraUrl(url, host);
	if (!c.ok) bad(c.error);
}

interface ParsedInput {
	name?: string;
	kind?: PrinterKind;
	host?: string;
	port?: number | null;
	catalogId?: string | null;
	enabled?: boolean;
	cameraUrl?: string | null;
	cameraEnabled?: boolean;
	secrets?: Secrets; // only the fields supplied
}

export function parsePrinterInput(
	body: unknown,
	partial: boolean,
	/** The stored kind when the body (an edit) does not carry one. */
	kindHint?: PrinterKind
): ParsedInput {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('Invalid body');
	const o = body as Obj;
	const out: ParsedInput = {};
	if (o.name !== undefined || !partial) {
		if (typeof o.name !== 'string' || !o.name.trim()) bad('Give the printer a name');
		out.name = (o.name as string).trim().slice(0, 80);
	}
	if (o.kind !== undefined || !partial) {
		if (!(PRINTER_KINDS as readonly unknown[]).includes(o.kind)) bad('Unknown printer type');
		out.kind = o.kind as PrinterKind;
	}
	const kindNow = out.kind ?? kindHint;
	const typedLink =
		typeof (o.secrets as Obj | undefined)?.[SHARE_LINK_KEY] === 'string' &&
		!!((o.secrets as Obj)[SHARE_LINK_KEY] as string).trim();
	if (kindNow === 'manual') {
		// Not connected: no address (a typed one is ignored), no port, no secrets.
		if (o.host !== undefined || !partial) out.host = MANUAL_HOST_PLACEHOLDER;
	} else if (o.host !== undefined || !partial) {
		// A printer reached through an OctoEverywhere link needs no address.
		const blank = typeof o.host !== 'string' || !o.host.trim();
		out.host = blank && typedLink ? SHARE_LINK_HOST_PLACEHOLDER : parseHost(o.host);
	}
	if (o.port !== undefined) {
		if (o.port === null || o.port === '' || kindNow === 'manual') out.port = null;
		else if (
			typeof o.port !== 'number' ||
			!Number.isInteger(o.port) ||
			o.port < 1 ||
			o.port > 65535
		)
			bad('port must be 1-65535');
		else out.port = o.port;
	}
	if (o.catalogId !== undefined) {
		if (o.catalogId === null || o.catalogId === '') out.catalogId = null;
		else if (typeof o.catalogId !== 'string' || !catalogPrinter(o.catalogId))
			bad('Unknown catalog printer');
		else out.catalogId = o.catalogId;
	}
	if (o.enabled !== undefined) {
		if (typeof o.enabled !== 'boolean') bad('enabled must be true or false');
		out.enabled = o.enabled as boolean;
	}
	if (o.cameraUrl !== undefined) {
		if (o.cameraUrl === null || (typeof o.cameraUrl === 'string' && !o.cameraUrl.trim()))
			out.cameraUrl = null;
		else if (typeof o.cameraUrl !== 'string' || o.cameraUrl.length > 500)
			bad('Camera address is too long');
		else out.cameraUrl = o.cameraUrl.trim();
	}
	if (o.cameraEnabled !== undefined) {
		if (typeof o.cameraEnabled !== 'boolean') bad('cameraEnabled must be true or false');
		out.cameraEnabled = o.cameraEnabled as boolean;
	}
	if (o.secrets !== undefined && kindNow === 'manual') {
		out.secrets = {}; // nothing to keep: no address, link or keys
	} else if (o.secrets !== undefined) {
		if (typeof o.secrets !== 'object' || o.secrets === null || Array.isArray(o.secrets))
			bad('secrets must be an object');
		const s: Secrets = {};
		for (const [k, v] of Object.entries(o.secrets as Obj)) {
			if (typeof v !== 'string' || v.length > 300) bad(`${k} must be text`);
			s[k] = (v as string).trim();
			if (k === SHARE_LINK_KEY && s[k] && kindNow && !supportsShareLink(kindNow))
				bad(
					kindNow === 'bambu-lan'
						? 'Bambu Lab printers cannot be reached through an OctoEverywhere link (LAN mode is a direct MQTT connection). Use LAN mode on your own network.'
						: 'This printer type has no OctoEverywhere link.'
				);
			if (k === SHARE_LINK_KEY && s[k]) {
				// Validated and normalised; the error never echoes the (secret) link.
				const c = parseShareLink(s[k]);
				if (!c.ok) bad(c.error);
				else s[k] = c.origin;
			}
		}
		out.secrets = s;
	}
	return out;
}

/** Merge supplied secret fields over the stored ones; an empty string clears a field, an absent key keeps it. */
function mergeSecrets(kind: PrinterKind, current: Secrets, supplied: Secrets | undefined): Secrets {
	const allowed = new Set(PRINTER_KIND_INFO[kind].secrets.map((s) => s.key));
	const next: Secrets = Object.fromEntries(Object.entries(current).filter(([k]) => allowed.has(k)));
	for (const [k, v] of Object.entries(supplied ?? {})) {
		if (!allowed.has(k)) continue;
		if (v) next[k] = v;
		else delete next[k];
	}
	return next;
}

/** True when the address a caller asks for is not the one stored (host, or port as stored). */
function addressMoved(
	stored: { host: string; port: number | null },
	host: string,
	port: number | null
) {
	return cleanHost(host) !== cleanHost(stored.host) || (port ?? null) !== (stored.port ?? null);
}

/**
 * Stored secrets belong to the stored address only. When the address changes, the sensitive
 * ones (API key, access code) are not carried over: the caller must type them again, so
 * nobody with edit rights can point a saved printer at another host and have the server send
 * it the stored key. Non-secret identifiers (serial, mainboard id) are kept.
 */
export function secretsForMovedAddress(
	kind: PrinterKind,
	current: Secrets,
	supplied: Secrets | undefined
): Secrets {
	const sensitive = PRINTER_KIND_INFO[kind].secrets.filter((f) => f.secret);
	for (const f of sensitive) {
		if (current[f.key] && supplied?.[f.key] === undefined)
			throw new ApiError(
				400,
				`Re-enter the ${f.label.replace(/\s*\(optional\)/i, '').toLowerCase()} to use a different address. Saved secrets are only used at the address they were saved for.`
			);
	}
	return Object.fromEntries(
		Object.entries(current).filter(([k]) => !sensitive.some((f) => f.key === k))
	);
}

/**
 * The one rule for stored secrets: they belong to the DESTINATION they were saved for, which is
 * either an address (host + port) or an OctoEverywhere link (the link itself is the secret).
 *  - same destination: stored secrets are kept;
 *  - address to another address: `secretsForMovedAddress` (re-enter the key/access code);
 *  - address to link, link to another link: nothing is carried over, the typed link is the
 *    credential (a stale access code or mainboard id never rides along to the relay);
 *  - link to address: the link is dropped and the address needs its own secrets.
 * `supplied` is what the caller typed (links already normalised). Throws ApiError when a
 * required secret was not re-entered.
 */
export function secretsForDestination(
	kind: PrinterKind,
	stored: { host: string; port: number | null; secrets: Secrets },
	next: { host: string; port: number | null },
	supplied: Secrets | undefined
): Secrets {
	const linkOf = (s: Secrets | undefined) => shareLinkFor(kind, s);
	const curLink = linkOf(stored.secrets);
	const typed = supplied?.[SHARE_LINK_KEY];
	const nextLink =
		typed === undefined ? curLink : typed ? linkOf({ [SHARE_LINK_KEY]: typed }) : null;
	if (curLink || nextLink) {
		if (curLink && nextLink && curLink.host === nextLink.host) return stored.secrets;
		if (nextLink) return {}; // address to link, or another link
		const { [SHARE_LINK_KEY]: _link, ...rest } = stored.secrets; // link to address
		void _link;
		return secretsForMovedAddress(kind, rest, supplied);
	}
	return addressMoved(stored, next.host, next.port)
		? secretsForMovedAddress(kind, stored.secrets, supplied)
		: stored.secrets;
}

/** Hosted site: the refusal for everything that is not a link printer or a manual one. */
function refuseInPublicMode(): void {
	if (isPublicMode()) throw new ApiError(403, PUBLIC_MODE_MESSAGE);
}

/**
 * Hosted site: a workspace may hold only so many printers reached through an OctoEverywhere link
 * (`linkPrintersPerWorkspace`, default 3): each is a long-lived connection to a third party. Link
 * printers are exactly the rows whose host is the link placeholder. Call it synchronously right
 * before the write (the database is synchronous, so two requests cannot both pass).
 */
export function assertLinkRoom(db: Db, orgId: string, exceptId?: string): void {
	const count = (inOrg: boolean) =>
		db
			.select({ n: sql<number>`count(*)` })
			.from(printers)
			.where(
				and(
					inOrg ? eq(printers.organizationId, orgId) : undefined,
					eq(printers.host, SHARE_LINK_HOST_PLACEHOLDER),
					exceptId ? ne(printers.id, exceptId) : undefined
				)
			)
			.get()?.n ?? 0;
	const limit = linkPrintersPerWorkspace();
	if (limit !== null) {
		const n = count(true);
		if (n >= limit)
			throw new QuotaError(
				limit === 0
					? 'Printers cannot be connected through an OctoEverywhere link on this server. Ask the admin.'
					: `This workspace already has ${n} ${n === 1 ? 'printer' : 'printers'} connected through OctoEverywhere links, the limit on this server. Remove one or ask the admin.`
			);
	}
	const total = linkPrintersTotal();
	if (total !== null && count(false) >= total)
		throw new QuotaError(
			'This server has reached its limit of printers connected through OctoEverywhere links. Ask the admin.'
		);
}

/** Hosted site: a workspace may hold only so many not-connected printers (`manualPrintersPerWorkspace`, default 10). */
export function assertManualRoom(db: Db, orgId: string, exceptId?: string): void {
	const limit = manualPrintersPerWorkspace();
	if (limit === null) return;
	const n =
		db
			.select({ n: sql<number>`count(*)` })
			.from(printers)
			.where(
				and(
					eq(printers.organizationId, orgId),
					eq(printers.kind, 'manual'),
					exceptId ? ne(printers.id, exceptId) : undefined
				)
			)
			.get()?.n ?? 0;
	if (n < limit) return;
	throw new QuotaError(
		limit === 0
			? 'Printers that are not connected cannot be added on this server. Ask the admin.'
			: `This workspace already has ${n} ${n === 1 ? 'printer' : 'printers'} that are not connected, the limit on this server. Remove one or ask the admin.`
	);
}

/** Hosted site: only link printers and manual printers may exist; everything else needs a LAN address. */
function assertHostedKind(kind: PrinterKind, linked: boolean): void {
	if (isPublicMode() && kind !== 'manual' && !linked) refuseInPublicMode();
}

export function createPrinter(db: Db, orgId: string, userId: string, body: unknown): Row {
	const p = parsePrinterInput(body, false);
	const kind = p.kind!;
	const secrets = mergeSecrets(kind, {}, p.secrets);
	const linked = !!secrets[SHARE_LINK_KEY];
	assertHostedKind(kind, linked);
	if (kind !== 'manual' && !linked && p.host === SHARE_LINK_HOST_PLACEHOLDER)
		bad('Enter the printer address');
	if (!linked && kind !== 'manual' && p.host === MANUAL_HOST_PLACEHOLDER)
		bad('Enter the printer address');
	if (linked) {
		p.cameraUrl = null; // the link decides where the camera is
		p.host = SHARE_LINK_HOST_PLACEHOLDER; // and where the printer is; a typed address is ignored
	}
	if (kind === 'manual') {
		p.cameraUrl = null;
		p.cameraEnabled = false;
	}
	checkCamera(p.cameraUrl, p.host!, kind);
	return db.transaction((tx) => {
		// Duplicate-link check (same link already used in another workspace on a hosted site) would go here: skipped, it needs a keyed-hash column (schema change).
		if (linked) assertLinkRoom(tx, orgId);
		if (kind === 'manual') assertManualRoom(tx, orgId);
		return tx
			.insert(printers)
			.values({
				organizationId: orgId,
				name: p.name!,
				kind,
				host: p.host!,
				port: kind === 'manual' ? null : (p.port ?? null),
				catalogId: p.catalogId ?? null,
				enabled: p.enabled ?? true,
				cameraUrl: p.cameraUrl ?? null,
				cameraEnabled: p.cameraEnabled ?? true,
				secretEnc: Object.keys(secrets).length ? encryptSecrets(secrets) : null,
				createdBy: userId
			})
			.returning()
			.get();
	});
}

export function updatePrinter(db: Db, id: string, orgId: string, body: unknown): Row {
	// Hosted site: pausing and renaming always stay possible so an old row can be tidied.
	const o = (typeof body === 'object' && body !== null ? body : {}) as Obj;
	const harmless = Object.entries(o).every(
		([k, v]) => k === 'name' || (k === 'enabled' && v === false)
	);
	const cur = db
		.select()
		.from(printers)
		.where(and(eq(printers.id, id), eq(printers.organizationId, orgId)))
		.get();
	if (!cur) throw new ApiError(404, 'Not found');
	const p = parsePrinterInput(body, true, cur.kind as PrinterKind);
	const kind = p.kind ?? (cur.kind as PrinterKind);
	const kindChanged = kind !== cur.kind;
	const manual = kind === 'manual';
	// Leaving manual: its placeholder is not an address, so one must be typed (or a link).
	const curHost = cur.host === MANUAL_HOST_PLACEHOLDER && !manual ? '' : cur.host;
	const host = manual ? MANUAL_HOST_PLACEHOLDER : (p.host ?? curHost);
	const port = manual ? null : p.port !== undefined ? p.port : cur.port;
	const secrets = mergeSecrets(
		kind,
		kindChanged
			? {}
			: secretsForDestination(
					kind,
					{ host: cur.host, port: cur.port, secrets: decryptSecrets(cur.secretEnc) },
					{ host, port },
					p.secrets
				),
		p.secrets
	);
	const linked = !!secrets[SHARE_LINK_KEY];
	if (isPublicMode() && !harmless) assertHostedKind(kind, linked);
	if (!manual && !linked && (host === SHARE_LINK_HOST_PLACEHOLDER || !host))
		bad('Enter the printer address');
	const cameraUrl =
		!cameraSupported(kind) || linked
			? null
			: p.cameraUrl !== undefined
				? p.cameraUrl
				: cur.cameraUrl;
	checkCamera(cameraUrl, host, kind);
	const set: Partial<typeof printers.$inferInsert> = {
		secretEnc: Object.keys(secrets).length ? encryptSecrets(secrets) : null
	};
	if (p.name !== undefined) set.name = p.name;
	if (p.kind !== undefined) set.kind = p.kind;
	if (p.host !== undefined || manual || kindChanged) set.host = host;
	if (linked) set.host = SHARE_LINK_HOST_PLACEHOLDER; // the link is the destination
	if (p.port !== undefined || manual) set.port = port;
	if (p.catalogId !== undefined) set.catalogId = p.catalogId;
	if (p.enabled !== undefined) set.enabled = p.enabled;
	if (p.cameraUrl !== undefined) set.cameraUrl = p.cameraUrl;
	if (p.cameraEnabled !== undefined) set.cameraEnabled = p.cameraEnabled;
	if (kind === 'bambu-lan' || linked || manual) set.cameraUrl = null;
	if (manual) set.cameraEnabled = false;
	return db.transaction((tx) => {
		// A printer that becomes (or stays) a link printer counts against the hosted cap, except
		// when this edit only tidies it (pause, rename) or it was one already.
		if (linked && !harmless && cur.host !== SHARE_LINK_HOST_PLACEHOLDER)
			assertLinkRoom(tx, orgId, id);
		if (manual && cur.kind !== 'manual') assertManualRoom(tx, orgId, id);
		return tx.update(printers).set(set).where(eq(printers.id, id)).returning().get();
	});
}

export function deletePrinter(db: Db, id: string, orgId: string): void {
	const r = db
		.delete(printers)
		.where(and(eq(printers.id, id), eq(printers.organizationId, orgId)))
		.returning({ id: printers.id })
		.get();
	if (!r) throw new ApiError(404, 'Not found');
}

/** Config for a connection test from the form: stored secrets of `id` (if given) overlaid with typed ones. */
export function configFromInput(db: Db, orgId: string, body: unknown): PrinterConfig {
	const o = (typeof body === 'object' && body !== null ? body : {}) as Obj;
	let stored: Row | undefined;
	if (typeof o.id === 'string') {
		stored = db
			.select()
			.from(printers)
			.where(and(eq(printers.id, o.id), eq(printers.organizationId, orgId)))
			.get();
		if (!stored) throw new ApiError(404, 'Not found');
	}
	const kind = ((o.kind as string) ?? stored?.kind) as PrinterKind;
	if (!(PRINTER_KINDS as readonly unknown[]).includes(kind)) bad('Unknown printer type');
	const typedHost = typeof o.host === 'string' && o.host.trim() ? o.host : undefined;
	const p = parsePrinterInput(
		{ ...o, name: 'test', kind, host: typedHost ?? stored?.host ?? o.host ?? '' },
		true,
		kind
	);
	if (kind === 'manual')
		return {
			id: stored?.id ?? 'test',
			kind,
			host: MANUAL_HOST_PLACEHOLDER,
			port: null,
			secrets: {}
		};
	const port = p.port !== undefined ? p.port : (stored?.port ?? null);
	const keep =
		stored && stored.kind === kind
			? secretsForDestination(
					kind,
					{ host: stored.host, port: stored.port, secrets: decryptSecrets(stored.secretEnc) },
					{ host: p.host!, port },
					p.secrets
				)
			: {};
	const secrets = mergeSecrets(kind, keep, p.secrets);
	const linked = !!secrets[SHARE_LINK_KEY];
	if (!linked && (p.host === SHARE_LINK_HOST_PLACEHOLDER || p.host === MANUAL_HOST_PLACEHOLDER))
		bad('Enter the printer address');
	assertHostedKind(kind, linked);
	return {
		id: stored?.id ?? 'test',
		kind,
		host: linked ? SHARE_LINK_HOST_PLACEHOLDER : p.host!,
		port,
		secrets
	};
}

/** Number of printers per workspace, for the given workspaces (the top nav's Printers link). */
export function printerCounts(db: Db, orgIds: string[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const id of orgIds) out[id] = listPrinters(db, id).length;
	return out;
}
