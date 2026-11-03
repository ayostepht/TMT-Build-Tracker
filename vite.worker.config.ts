// Bundles the STEP converter child process (src/lib/server/models/worker.ts) into
// build/worker/convert-worker.js. Runs after `vite build` (see the "build" script).
// Runtime dependencies (occt-import-js, @gltf-transform/*, meshoptimizer, fflate)
// stay external: they are installed in the production image.
import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		ssr: 'src/lib/server/models/worker.ts',
		outDir: 'build/worker',
		emptyOutDir: true,
		target: 'node22',
		rollupOptions: { output: { entryFileNames: 'convert-worker.js', format: 'esm' } }
	}
});
