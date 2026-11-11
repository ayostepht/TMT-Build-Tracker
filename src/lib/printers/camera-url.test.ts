import { describe, expect, it } from 'vitest';
import {
	cameraSupported,
	checkCameraUrl,
	defaultCameraUrl,
	normalizeHost,
	resolveCameraUrl
} from './camera-url';

describe('camera URL defaults', () => {
	it('Elegoo SDCP defaults to the MJPEG port on the printer host', () => {
		expect(defaultCameraUrl('elegoo-sdcp', '192.168.1.50')).toBe('http://192.168.1.50:3031/video');
		expect(defaultCameraUrl('elegoo-sdcp', 'printer.lan')).toBe('http://printer.lan:3031/video');
		expect(defaultCameraUrl('elegoo-sdcp', 'fe80::1')).toBe('http://[fe80::1]:3031/video');
	});
	it('other kinds have no fixed default; Bambu is unsupported', () => {
		expect(defaultCameraUrl('moonraker', 'h')).toBeNull();
		expect(defaultCameraUrl('octoprint', 'h')).toBeNull();
		expect(cameraSupported('bambu-lan')).toBe(false);
		expect(cameraSupported('elegoo-sdcp')).toBe(true);
	});
});

describe('same-host guard', () => {
	const ok = (u: string, h: string) => checkCameraUrl(u, h).ok;
	it('accepts http(s) on the printer host, any port, any case', () => {
		expect(ok('http://192.168.1.50:3031/video', '192.168.1.50')).toBe(true);
		expect(ok('https://192.168.1.50/cam', '192.168.1.50')).toBe(true);
		expect(ok('http://Printer.LAN:8080/s', 'printer.lan')).toBe(true);
		expect(ok('http://[fe80::1]:81/s', 'fe80::1')).toBe(true);
		expect(ok('http://printer.lan./s', 'printer.lan')).toBe(true);
	});
	it('refuses other hosts, schemes, credentials and junk', () => {
		expect(ok('http://192.168.1.51:3031/video', '192.168.1.50')).toBe(false);
		expect(ok('http://169.254.169.254/latest', '192.168.1.50')).toBe(false);
		expect(ok('http://localhost/x', '192.168.1.50')).toBe(false);
		expect(ok('ftp://192.168.1.50/x', '192.168.1.50')).toBe(false);
		expect(ok('file:///etc/passwd', '192.168.1.50')).toBe(false);
		expect(ok('http://user:pw@192.168.1.50/x', '192.168.1.50')).toBe(false);
		expect(ok('http://192.168.1.50.evil.test/x', '192.168.1.50')).toBe(false);
		expect(ok('http://evil.test/@192.168.1.50', '192.168.1.50')).toBe(false);
		expect(ok('not a url', '192.168.1.50')).toBe(false);
		expect(ok('//192.168.1.50/x', '192.168.1.50')).toBe(false);
	});
	it('normalizes hosts', () => {
		expect(normalizeHost(' [::1] ')).toBe('::1');
		expect(normalizeHost('Host.')).toBe('host');
	});
	it('resolves relative URLs from a printer API against its host and still guards them', () => {
		expect(
			resolveCameraUrl('/webcam/?action=stream', 'http://10.0.0.5/', '10.0.0.5')?.toString()
		).toBe('http://10.0.0.5/webcam/?action=stream');
		expect(
			resolveCameraUrl('http://10.0.0.5:8080/s', 'http://10.0.0.5/', '10.0.0.5')
		).not.toBeNull();
		expect(resolveCameraUrl('http://evil.test/s', 'http://10.0.0.5/', '10.0.0.5')).toBeNull();
	});
});
