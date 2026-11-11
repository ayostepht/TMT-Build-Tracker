// Preloaded with `node --import ./scripts/proxy-origin.mjs build` (see `npm start`
// and the Dockerfile). adapter-node v6 ignores ORIGIN and, without a protocol
// header, assumes https, so SvelteKit rejects form posts made over plain http as
// cross-site. This makes the request origin explicit and safe:
//
//  - PUBLIC_URL (or BETTER_AUTH_URL / ORIGIN) set: that origin is used for every
//    request, whatever headers the client sends.
//  - Unset: the scheme comes from X-Forwarded-Proto (set by reverse proxies such
//    as Nginx Proxy Manager) and defaults to http; the host from X-Forwarded-Host
//    or Host. A browser cannot forge these on a cross-site request, and the
//    Origin header must still match, so CSRF protection stays intact.
import http from 'node:http';
import { installResponseDefaults } from './response-defaults.mjs';

// Static files and error pages never reach hooks.server.ts: give them the security headers too.
installResponseDefaults(http.ServerResponse.prototype);

process.env.PROTOCOL_HEADER ??= 'x-forwarded-proto';
process.env.HOST_HEADER ??= 'x-forwarded-host';

function configuredOrigin() {
	const raw = (
		process.env.PUBLIC_URL ||
		process.env.BETTER_AUTH_URL ||
		process.env.ORIGIN ||
		''
	).trim();
	if (!raw) return null;
	const url = new URL(raw);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`PUBLIC_URL must start with http:// or https://: ${raw}`);
	}
	return url;
}

const fixed = configuredOrigin();
const first = (value) =>
	String(Array.isArray(value) ? value[0] : (value ?? ''))
		.split(',')[0]
		.trim();

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, ...rest) {
	if (event === 'request' && req?.headers) {
		const h = req.headers;
		if (fixed) {
			h['x-forwarded-proto'] = fixed.protocol.slice(0, -1);
			h['x-forwarded-host'] = fixed.host;
		} else {
			const proto = first(h['x-forwarded-proto']).toLowerCase();
			h['x-forwarded-proto'] = proto === 'https' ? 'https' : 'http';
			const host = first(h['x-forwarded-host']);
			if (host) h['x-forwarded-host'] = host;
			else delete h['x-forwarded-host'];
		}
	}
	return emit.call(this, event, req, ...rest);
};
