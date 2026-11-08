import { and, eq } from 'drizzle-orm';
import {
	PRINTER_KIND_INFO,
	PRINTER_KINDS,
	type PrinterKind,
	type PrinterPublic,
	type PrinterStatus
} from '#lib/printers/status.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { cameraSupported, checkCameraUrl } from '#lib/printers/camera-url.ts';
import { ApiError } from '../access';
import type { Db } from '../db';
import { printers } from '../db/schema';
import { decryptSecrets, encryptSecrets, type Secrets } from './secrets';
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
		identifiers: Object.fromEntries(pub.filter((k) => secrets[k]).map((k) => [k, secrets[k]]))
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
	if (!h || h.length > 253 || !/^[A-Za-z0-9.:_-]+$/.test(h))
		return bad('Enter just the printer address, like 192.168.0.50');
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

export function parsePrinterInput(body: unknown, partial: boolean): ParsedInput {
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
	if (o.host !== undefined || !partial) out.host = parseHost(o.host);
	if (o.port !== undefined) {
		if (o.port === null || o.port === '') out.port = null;
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
	if (o.secrets !== undefined) {
		if (typeof o.secrets !== 'object' || o.secrets === null || Array.isArray(o.secrets))
			bad('secrets must be an object');
		const s: Secrets = {};
		for (const [k, v] of Object.entries(o.secrets as Obj)) {
			if (typeof v !== 'string' || v.length > 300) bad(`${k} must be text`);
			s[k] = (v as string).trim();
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

export function createPrinter(db: Db, orgId: string, userId: string, body: unknown): Row {
	const p = parsePrinterInput(body, false);
	checkCamera(p.cameraUrl, p.host!, p.kind!);
	const secrets = mergeSecrets(p.kind!, {}, p.secrets);
	return db
		.insert(printers)
		.values({
			organizationId: orgId,
			name: p.name!,
			kind: p.kind!,
			host: p.host!,
			port: p.port ?? null,
			catalogId: p.catalogId ?? null,
			enabled: p.enabled ?? true,
			cameraUrl: p.cameraUrl ?? null,
			cameraEnabled: p.cameraEnabled ?? true,
			secretEnc: Object.keys(secrets).length ? encryptSecrets(secrets) : null,
			createdBy: userId
		})
		.returning()
		.get();
}

export function updatePrinter(db: Db, id: string, orgId: string, body: unknown): Row {
	const cur = db
		.select()
		.from(printers)
		.where(and(eq(printers.id, id), eq(printers.organizationId, orgId)))
		.get();
	if (!cur) throw new ApiError(404, 'Not found');
	const p = parsePrinterInput(body, true);
	const kind = p.kind ?? (cur.kind as PrinterKind);
	const kindChanged = kind !== cur.kind;
	const host = p.host ?? cur.host;
	const cameraUrl = !cameraSupported(kind)
		? null
		: p.cameraUrl !== undefined
			? p.cameraUrl
			: cur.cameraUrl;
	checkCamera(cameraUrl, host, kind);
	const secrets = mergeSecrets(kind, kindChanged ? {} : decryptSecrets(cur.secretEnc), p.secrets);
	const set: Partial<typeof printers.$inferInsert> = {
		secretEnc: Object.keys(secrets).length ? encryptSecrets(secrets) : null
	};
	if (p.name !== undefined) set.name = p.name;
	if (p.kind !== undefined) set.kind = p.kind;
	if (p.host !== undefined) set.host = p.host;
	if (p.port !== undefined) set.port = p.port;
	if (p.catalogId !== undefined) set.catalogId = p.catalogId;
	if (p.enabled !== undefined) set.enabled = p.enabled;
	if (p.cameraUrl !== undefined) set.cameraUrl = p.cameraUrl;
	if (p.cameraEnabled !== undefined) set.cameraEnabled = p.cameraEnabled;
	if (kind === 'bambu-lan') set.cameraUrl = null;
	return db.update(printers).set(set).where(eq(printers.id, id)).returning().get();
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
	const p = parsePrinterInput({ ...o, name: 'test', kind, host: o.host ?? stored?.host }, true);
	return {
		id: stored?.id ?? 'test',
		kind,
		host: p.host!,
		port: p.port !== undefined ? p.port : (stored?.port ?? null),
		secrets: mergeSecrets(
			kind,
			stored && stored.kind === kind ? decryptSecrets(stored.secretEnc) : {},
			p.secrets
		)
	};
}

/** Number of printers per workspace, for the given workspaces (the top nav's Printers link). */
export function printerCounts(db: Db, orgIds: string[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const id of orgIds) out[id] = listPrinters(db, id).length;
	return out;
}
