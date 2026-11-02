<script lang="ts">
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import { filamentLabel } from '#lib/domain/labels.ts';
	import Swatch from '#lib/components/Swatch.svelte';

	const ctx = getBuildCtx();
	const partsFor = (role: string) =>
		ctx.view.parts.filter((p) => p.role === role).map((p) => p.name);
</script>

<section class="placeholder">
	<h2>Design</h2>
	<p class="muted">
		The live 3D color prototyper and shareable designs arrive in a later version. For now, here are
		this build's filament roles. Change filament names and colors in Settings.
	</p>
</section>

<section style="display:grid;gap:10px">
	<h2>Filament roles</h2>
	<ul style="list-style:none;margin:0;padding:0;display:grid;gap:10px">
		{#each ctx.view.filaments as f (f.key)}
			<li class="tile" style="grid-template-columns:auto 1fr;align-items:start">
				<Swatch hex={f.hex} tpu={f.tpu} />
				<div>
					<div class="tile-name">{filamentLabel(f)}</div>
					<div class="meta">{partsFor(f.key).join(', ') || 'No parts use this role'}</div>
				</div>
			</li>
		{/each}
	</ul>
</section>
