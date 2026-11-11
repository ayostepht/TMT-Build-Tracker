import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { APP_VERSION } from './version.ts';

describe('APP_VERSION', () => {
	it('matches package.json and is semver', () => {
		expect(APP_VERSION).toBe(pkg.version);
		expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
	});
});
