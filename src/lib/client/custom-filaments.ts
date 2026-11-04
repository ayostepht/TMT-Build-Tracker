// Browser side of a workspace's custom filaments.
import type { CustomFilament, CustomFilamentInput } from '#lib/domain/custom-filaments.ts';

export class DuplicateError extends Error {
	constructor(
		message: string,
		public existingId: string
	) {
		super(message);
	}
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
	const res = await fetch(url, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	let data: { error?: string; existingId?: string } & Record<string, unknown> = {};
	try {
		data = await res.json();
	} catch {
		/* non-JSON error body */
	}
	if (res.status === 409 && data.existingId)
		throw new DuplicateError(data.error ?? 'Already exists', data.existingId);
	if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
	return data as T;
}

export const listCustomFilaments = (organizationId: string) =>
	call<{ filaments: CustomFilament[] }>(
		'GET',
		`/api/filaments/custom?organizationId=${encodeURIComponent(organizationId)}`
	).then((r) => r.filaments);

export const createCustomFilament = (organizationId: string, input: CustomFilamentInput) =>
	call<{ filament: CustomFilament }>('POST', '/api/filaments/custom', {
		organizationId,
		...input
	}).then((r) => r.filament);

export const updateCustomFilament = (id: string, input: CustomFilamentInput) =>
	call<{ filament: CustomFilament }>(
		'PATCH',
		`/api/filaments/custom/${encodeURIComponent(id)}`,
		input
	).then((r) => r.filament);

export const deleteCustomFilament = (id: string) =>
	call<object>('DELETE', `/api/filaments/custom/${encodeURIComponent(id)}`);
