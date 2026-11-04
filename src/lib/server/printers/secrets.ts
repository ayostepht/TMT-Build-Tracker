import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { authSecret } from '../config';

/**
 * Printer secrets (access codes, API keys) are stored as AES-256-GCM
 * `v1.<iv>.<tag>.<ciphertext>` (base64url). The key is derived with HKDF from
 * BETTER_AUTH_SECRET, so rotating that secret makes stored values unreadable
 * (the user re-enters them). Values never leave the server.
 */
const INFO = 'tmt-build-tracker/printer-secrets/v1';

function key(secret = authSecret()): Buffer {
	return Buffer.from(hkdfSync('sha256', secret, 'tmt-printers', INFO, 32));
}

export type Secrets = Record<string, string>;

export function encryptSecrets(secrets: Secrets, secret?: string): string {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', key(secret), iv);
	const enc = Buffer.concat([c.update(JSON.stringify(secrets), 'utf8'), c.final()]);
	const tag = c.getAuthTag();
	return ['v1', iv, tag, enc]
		.map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
		.join('.');
}

/** Empty object when the value is missing or cannot be decrypted (wrong key, tampering). */
export function decryptSecrets(blob: string | null | undefined, secret?: string): Secrets {
	if (!blob) return {};
	try {
		const [v, iv, tag, enc] = blob.split('.');
		if (v !== 'v1') return {};
		const d = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64url'));
		d.setAuthTag(Buffer.from(tag, 'base64url'));
		const out = Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString(
			'utf8'
		);
		const o = JSON.parse(out) as unknown;
		if (typeof o !== 'object' || o === null) return {};
		return Object.fromEntries(
			Object.entries(o as Record<string, unknown>).filter(([, x]) => typeof x === 'string')
		) as Secrets;
	} catch {
		return {};
	}
}
