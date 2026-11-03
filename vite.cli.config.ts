// Bundles the import CLI core (src/lib/server/builds/import-cli.ts) into
// build/cli/import-cli.js so the production image, which has no devDependencies
// and no TypeScript sources, can run scripts/import-prototype.mjs.
// Runs after `vite build` (see the "build" script). Only runtime dependencies
// (better-sqlite3) stay external; devDependencies such as drizzle-orm are pruned
// from the image, so they must be bundled.
import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		ssr: 'src/lib/server/builds/import-cli.ts',
		outDir: 'build/cli',
		emptyOutDir: true,
		target: 'node22',
		rollupOptions: { output: { entryFileNames: 'import-cli.js', format: 'esm' } }
	},
	ssr: { noExternal: true, external: ['better-sqlite3'] }
});
