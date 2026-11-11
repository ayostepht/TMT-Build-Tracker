import { test as base, type Browser, type BrowserContext } from '@playwright/test';

export { expect } from '@playwright/test';

let n = 0;
/**
 * Better Auth rate-limits sign-up / sign-in per client IP (3 per 10 s). The test server
 * is configured as if behind one trusted proxy (playwright.config.ts), which makes the
 * server take the client address from X-Forwarded-For, so give each context its own,
 * like separate clients behind a proxy would have.
 */
export function clientIp(): string {
	n += 1;
	return `10.${(Date.now() >> 8) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export async function newClientContext(browser: Browser): Promise<BrowserContext> {
	return browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': clientIp() } });
}

export const test = base.extend({
	// Applies to the browser context (page) and to the `request` fixture alike: the server
	// runs behind a "trusted proxy" (ADDRESS_HEADER=x-forwarded-for), so every request to
	// /api/auth/* must carry exactly one X-Forwarded-For or it is rejected with 400.
	// eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured first argument
	extraHTTPHeaders: async ({}, use) => {
		await use({ 'x-forwarded-for': clientIp() });
	}
});
