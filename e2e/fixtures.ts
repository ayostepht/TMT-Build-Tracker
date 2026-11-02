import { test as base, type Browser, type BrowserContext } from '@playwright/test';

export { expect } from '@playwright/test';

let n = 0;
/**
 * Better Auth rate-limits sign-up / sign-in per client IP (3 per 10 s). Every browser
 * here connects from 127.0.0.1, so give each context its own X-Forwarded-For, like
 * separate clients behind a proxy would have.
 */
export function clientIp(): string {
	n += 1;
	return `10.${(Date.now() >> 8) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export async function newClientContext(browser: Browser): Promise<BrowserContext> {
	return browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': clientIp() } });
}

export const test = base.extend({
	page: async ({ page }, use) => {
		await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': clientIp() });
		await use(page);
	}
});
