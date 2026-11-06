import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const DB_DIR = 'data/e2e';
// E2E_BASE_URL points the suite at an already running instance (for example the Docker image).
const EXTERNAL = process.env.E2E_BASE_URL;

// The app runs in production mode against a fresh SQLite file per run, over plain
// http on 127.0.0.1 with PUBLIC_URL unset, which is the "open it by LAN IP" case.
export default defineConfig({
	testDir: 'e2e',
	outputDir: 'test-results',
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	use: {
		baseURL: EXTERNAL ?? `http://127.0.0.1:${PORT}`,
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: EXTERNAL
		? undefined
		: {
				command: `rm -rf ${DB_DIR} && mkdir -p ${DB_DIR} && npm run build && npm start`,
				url: `http://127.0.0.1:${PORT}/api/health`,
				timeout: 240_000,
				reuseExistingServer: false,
				stdout: 'ignore',
				stderr: 'pipe',
				env: {
					NODE_ENV: 'production',
					HOST: '127.0.0.1',
					PORT: String(PORT),
					DATABASE_URL: `${DB_DIR}/tmt.db`,
					BETTER_AUTH_SECRET: 'e2e-secret-not-for-production-0123456789abcdef',
					BODY_SIZE_LIMIT: '1100M',
					PUBLIC_URL: '',
					BETTER_AUTH_URL: '',
					ORIGIN: '',
					// A fixed site admin so specs do not depend on who signs up first.
					ADMIN_EMAILS: 'e2e-admin@example.test',
					// The suite runs without the bundled MakeGood kit (specs cover the "missing" state).
					KITPACK_DIR: `${DB_DIR}/no-kitpacks`,
					KITPACK_DOWNLOAD: 'off'
				}
			}
});
