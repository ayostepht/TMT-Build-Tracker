import { describe, expect, it } from 'vitest';
import { checkCameraUrl } from './camera-url.ts';
import {
	isOctoEverywhereAddress,
	parseShareLink,
	shareLinkCameraUrl,
	shareLinkOf,
	shareLinkSocketUrl
} from './share-link.ts';

// A made-up token: never a real link.
const HOST = 'shared-testtoken12345678.octoeverywhere.com';
const LINK = `https://${HOST}`;

describe('parseShareLink', () => {
	it('accepts the shared-link shape and normalises it', () => {
		for (const raw of [LINK, `${LINK}/`, `  ${LINK.toUpperCase().replace('HTTPS', 'https')}/ `]) {
			const c = parseShareLink(raw);
			expect(c).toEqual({ ok: true, origin: LINK, host: HOST });
		}
	});
	it('refuses anything else: other hosts, http, ports, credentials, paths, queries', () => {
		for (const raw of [
			'',
			'not a url',
			`http://${HOST}`,
			`https://${HOST}:8443`,
			`https://user:pw@${HOST}`,
			`${LINK}/webcam`,
			`${LINK}/?x=1`,
			`${LINK}/#x`,
			'https://octoeverywhere.com',
			'https://shared-abc.octoeverywhere.com', // token too short
			`https://${HOST}.evil.example`,
			`https://evil.example/${HOST}`,
			'https://shared-testtoken12345678.octoeverywhere.com.evil.example',
			'https://192.168.0.50',
			'wss://' + HOST
		])
			expect(parseShareLink(raw).ok, raw).toBe(false);
	});
	it('derives the socket and camera URLs from the origin', () => {
		expect(shareLinkSocketUrl(LINK)).toBe(`wss://${HOST}/websocket`);
		expect(shareLinkCameraUrl(LINK)).toBe(`${LINK}/video`);
		expect(shareLinkOf({ shareLink: LINK })).toEqual({ origin: LINK, host: HOST });
		expect(shareLinkOf({ shareLink: 'https://evil.example' })).toBeNull();
		expect(shareLinkOf({})).toBeNull();
	});
	it('keeps the camera SSRF guard pinned to the link host', () => {
		expect(checkCameraUrl(`${LINK}/video`, HOST).ok).toBe(true);
		expect(checkCameraUrl('https://shared-other12345678.octoeverywhere.com/video', HOST).ok).toBe(
			false
		);
		expect(checkCameraUrl('http://127.0.0.1/video', HOST).ok).toBe(false);
	});

	it('spots a share link pasted as an address', () => {
		for (const v of [HOST, LINK, `${LINK}/x`, 'a.octoeverywhere.com', 'octoeverywhere.com'])
			expect(isOctoEverywhereAddress(v), v).toBe(true);
		for (const v of [
			'192.168.0.5',
			'octoeverywhere',
			'printer.local',
			'octoeverywhere.com.evil.example'
		])
			expect(isOctoEverywhereAddress(v), v).toBe(false);
	});
});
