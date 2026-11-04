import { createSocket } from 'node:dgram';

export interface DiscoveredPrinter {
	host: string;
	name: string;
	machineName: string;
	brand: string;
	mainboardId: string;
	firmware: string;
}

function parse(buf: Buffer, host: string): DiscoveredPrinter | null {
	try {
		const j = JSON.parse(buf.toString('utf8')) as { Data?: Record<string, unknown> };
		const d = j.Data;
		if (!d || typeof d !== 'object') return null;
		const s = (v: unknown) => (typeof v === 'string' ? v : '');
		return {
			host: s(d.MainboardIP) || host,
			name: s(d.Name),
			machineName: s(d.MachineName),
			brand: s(d.BrandName),
			mainboardId: s(d.MainboardID),
			firmware: s(d.FirmwareVersion)
		};
	} catch {
		return null;
	}
}

/**
 * SDCP discovery: send "M99999" to UDP port 3000 (broadcast, or a single host) and collect
 * the JSON answers. Broadcast only works on the same layer-2 network (host networking or
 * a macvlan/br0 container). Packets are repeated because UDP drops.
 */
export function discoverSdcp(
	opts: { target?: string; timeoutMs?: number; port?: number } = {}
): Promise<DiscoveredPrinter[]> {
	const target = opts.target ?? '255.255.255.255';
	const port = opts.port ?? 3000;
	const timeout = opts.timeoutMs ?? 3000;
	return new Promise((resolve) => {
		const found = new Map<string, DiscoveredPrinter>();
		const sock = createSocket('udp4');
		const done = () => {
			clearInterval(rep);
			clearTimeout(t);
			try {
				sock.close();
			} catch {
				/* closed */
			}
			resolve([...found.values()]);
		};
		sock.on('error', done);
		sock.on('message', (buf, rinfo) => {
			const p = parse(buf, rinfo.address);
			if (p) found.set(p.mainboardId || p.host, p);
		});
		const send = () => {
			try {
				sock.send('M99999', port, target);
			} catch {
				/* ignore */
			}
		};
		sock.bind(0, () => {
			try {
				if (target === '255.255.255.255') sock.setBroadcast(true);
			} catch {
				/* ignore */
			}
			send();
		});
		const rep = setInterval(send, 800);
		const t = setTimeout(done, timeout);
	});
}

/** Ask one host for its MainboardID (unicast discovery). Null when it does not answer. */
export async function probeMainboardId(host: string, timeoutMs = 1500): Promise<string | null> {
	const r = await discoverSdcp({ target: host, timeoutMs });
	return r.find((x) => x.mainboardId)?.mainboardId ?? null;
}
