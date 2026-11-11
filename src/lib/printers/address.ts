/**
 * Address classifier for the outbound-connection guard. Pure: no Node imports, no DNS.
 *
 * Self-hosted servers may talk to devices on the owner's own network only. Allowed: RFC 1918
 * (10/8, 172.16/12, 192.168/16), CGNAT 100.64/10 (Tailscale), loopback (127/8, ::1), IPv6
 * unique-local fc00::/7 and link-local fe80::/10. Everything else is refused, and 169.254/16
 * (cloud metadata), 0/8, multicast and broadcast are refused with their own wording.
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is unwrapped and judged as the IPv4 address.
 */

export type AddressVerdict =
	| { ok: true; ip: string; family: 4 | 6 }
	| { ok: false; ip: string; reason: 'metadata' | 'reserved' | 'public' };

/** Parse a dotted-quad IPv4 (decimal octets only: odd spellings are not literals). */
export function parseIPv4(s: string): number[] | null {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
	if (!m) return null;
	const out = m.slice(1).map(Number);
	// Leading zeros are octal in inet_aton: do not treat "010.0.0.1" as a plain literal.
	if (m.slice(1).some((p) => p.length > 1 && p.startsWith('0'))) return null;
	return out.every((n) => n <= 255) ? out : null;
}

/** Parse an IPv6 literal (no brackets, optional zone id) into 16 bytes. */
export function parseIPv6(input: string): number[] | null {
	let s = input;
	const z = s.indexOf('%');
	if (z >= 0) s = s.slice(0, z);
	if (!s.includes(':') || !/^[0-9a-fA-F:.]+$/.test(s)) return null;
	// An embedded IPv4 tail takes the place of the last two groups.
	const lastColon = s.lastIndexOf(':');
	if (s.includes('.')) {
		const v4 = parseIPv4(s.slice(lastColon + 1));
		if (!v4) return null;
		const hi = ((v4[0] << 8) | v4[1]).toString(16);
		const lo = ((v4[2] << 8) | v4[3]).toString(16);
		s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
	}
	const halves = s.split('::');
	if (halves.length > 2) return null;
	const groups = (h: string) => (h === '' ? [] : h.split(':'));
	const head = groups(halves[0]);
	const tail = halves.length === 2 ? groups(halves[1]) : [];
	if (halves.length === 1 && head.length !== 8) return null;
	if (halves.length === 2 && head.length + tail.length > 7) return null;
	const fill = halves.length === 2 ? new Array(8 - head.length - tail.length).fill('0') : [];
	const all = [...head, ...fill, ...tail];
	const bytes: number[] = [];
	for (const g of all) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
		const n = parseInt(g, 16);
		bytes.push(n >> 8, n & 255);
	}
	return bytes.length === 16 ? bytes : null;
}

/** True when `s` is an IPv4 or IPv6 literal (as parsed above). */
export function isIpLiteral(s: string): boolean {
	return parseIPv4(s) !== null || parseIPv6(s) !== null;
}

/** Lower-case, no brackets, no trailing dot: the form hosts are compared and resolved in. */
export function cleanHost(h: string): string {
	let v = h.trim().toLowerCase();
	if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
	while (v.endsWith('.')) v = v.slice(0, -1);
	return v;
}

function judgeV4(b: number[], shown: string): AddressVerdict {
	const [a, c] = b;
	const ok = { ok: true as const, ip: shown, family: 4 as const };
	if (a === 169 && c === 254) return { ok: false, ip: shown, reason: 'metadata' };
	// Alibaba Cloud's metadata service sits inside the shared 100.64/10 range allowed below.
	if (a === 100 && c === 100 && b[2] === 100 && b[3] === 200)
		return { ok: false, ip: shown, reason: 'metadata' };
	if (a === 0) return { ok: false, ip: shown, reason: 'reserved' };
	if (a >= 224) return { ok: false, ip: shown, reason: 'reserved' }; // multicast, 240/4, broadcast
	if (a === 10) return ok;
	if (a === 127) return ok;
	if (a === 172 && c >= 16 && c <= 31) return ok;
	if (a === 192 && c === 168) return ok;
	if (a === 100 && c >= 64 && c <= 127) return ok;
	return { ok: false, ip: shown, reason: 'public' };
}

/**
 * Judge one IP literal. Loopback (127/8, ::1) is deliberately ALLOWED, along with the other
 * private ranges: this is a self-hosted tool whose owner decides what it may reach, and the
 * e2e mocks plus same-host Spoolman/OctoPrint setups rely on loopback. The trade-off is that
 * anyone who may add a printer can make the server probe services on its own host; the
 * metadata addresses inside the allowed ranges are refused explicitly. Anything that is not a valid literal is refused. */
export function classifyAddress(raw: string): AddressVerdict {
	const ip = cleanHost(raw);
	const v4 = parseIPv4(ip);
	if (v4) return judgeV4(v4, ip);
	const v6 = parseIPv6(ip);
	if (!v6) return { ok: false, ip, reason: 'reserved' };
	// ::ffff:a.b.c.d (IPv4-mapped): judge the embedded IPv4 address.
	const mapped = v6.slice(0, 10).every((x) => x === 0) && v6[10] === 0xff && v6[11] === 0xff;
	if (mapped) {
		const r = judgeV4(v6.slice(12), ip);
		return r.ok ? { ok: true, ip, family: 6 } : r;
	}
	const allZeroButLast = v6.slice(0, 15).every((x) => x === 0);
	if (allZeroButLast && v6[15] === 1) return { ok: true, ip, family: 6 }; // ::1
	if (allZeroButLast && v6[15] === 0) return { ok: false, ip, reason: 'reserved' }; // ::
	if (v6[0] === 0xff) return { ok: false, ip, reason: 'reserved' }; // multicast
	// AWS IPv6 metadata (fd00:ec2::254) lives inside the unique-local range allowed below.
	if (
		v6[0] === 0xfd &&
		v6[1] === 0 &&
		v6[2] === 0x0e &&
		v6[3] === 0xc2 &&
		v6[14] === 0x02 &&
		v6[15] === 0x54 &&
		v6.slice(4, 14).every((x) => x === 0)
	)
		return { ok: false, ip, reason: 'metadata' };
	if ((v6[0] & 0xfe) === 0xfc) return { ok: true, ip, family: 6 }; // fc00::/7
	if (v6[0] === 0xfe && (v6[1] & 0xc0) === 0x80) return { ok: true, ip, family: 6 }; // fe80::/10
	return { ok: false, ip, reason: 'public' };
}

/** What to tell the user about a refused address (never the remote's own text). */
export function refusedMessage(v: Extract<AddressVerdict, { ok: false }>, host?: string): string {
	const who = host && cleanHost(host) !== v.ip ? `${host} (${v.ip})` : v.ip;
	if (v.reason === 'metadata')
		return `${who} is a cloud metadata or link-local address, which is never allowed.`;
	if (v.reason === 'reserved') return `${who} is not a usable printer address.`;
	return `${who} is not on your local network. Printers, cameras and Spoolman must be reachable on a private address (like 192.168.x.x or 10.x.x.x).`;
}
