// Bundles the CLI cores into build/cli/ so the production image, which has no
// devDependencies and no TypeScript sources, can run the scripts:
//   src/lib/server/builds/import-cli.ts        -> build/cli/import-cli.js    (scripts/import-prototype.mjs)
//   src/lib/server/print-geometry/import-cli.ts -> build/cli/geometry-cli.js (scripts/import-print-geometry.mjs)
//   src/lib/server/kitpack/cli.ts               -> build/cli/kitpack-cli.js  (scripts/build-kit-pack.mjs)
// Runs after `vite build` (see the "build" script). Only better-sqlite3 (native) stays external;
// everything else, including devDependencies such as
// drizzle-orm (pruned from the image), is bundled.
import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		ssr: true,
		outDir: 'build/cli',
		emptyOutDir: true,
		target: 'node22',
		rollupOptions: {
			input: {
				'import-cli': 'src/lib/server/builds/import-cli.ts',
				'geometry-cli': 'src/lib/server/print-geometry/import-cli.ts',
				'kitpack-cli': 'src/lib/server/kitpack/cli.ts'
			},
			output: { entryFileNames: '[name].js', format: 'esm' }
		}
	},
	ssr: { noExternal: true, external: ['better-sqlite3'] }
});
