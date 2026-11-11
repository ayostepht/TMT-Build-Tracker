<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Plate } from '#lib/domain/types.ts';
	import { getBuildCtx } from '../build-context.svelte.ts';
	import PlateControl from '../PlateControl.svelte';
	import PlateTime from '../PlateTime.svelte';
	import RoleChip from '../RoleChip.svelte';

	/** One build's next plate to print, with the shared start control (Start printing is one tap). */
	let { plate }: { plate: Plate } = $props();
	const ctx = getBuildCtx();
	const roles = $derived(
		[
			...new Set(
				plate.parts
					.map((s) => ctx.view.parts.find((p) => p.slug === s)?.role)
					.filter((r): r is string => !!r)
			)
		].slice(0, 4)
	);
	const todo = $derived(
		plate.parts.filter((s) => ['To print', 'Reprint'].includes(ctx.view.state[s]?.status ?? ''))
			.length
	);
</script>

<article class="ds-card ds-card--compact" data-testid="next-up-card" data-plate={plate.number}>
	<div class="nu-head">
		<a
			class="pill-link nu-open"
			href={resolve('/(app)/builds/[id]', { id: ctx.id })}
			data-testid="landing-open-build"
			title={ctx.view.build.name}
			><span class="nu-open-name">{ctx.view.build.name}</span>
			<span class="btn-arrow" aria-hidden="true">→</span></a
		>
		<div class="nu-plate">Plate {plate.number}{plate.name ? ` · ${plate.name}` : ''}</div>
	</div>
	<div class="nu-meta">
		<span class="muted">{todo} part{todo === 1 ? '' : 's'} to print</span>
		{#each roles as r (r)}<RoleChip filament={ctx.filament(r)} role={r} />{/each}
		<PlateTime {plate} />
	</div>
	<div class="nu-actions"><PlateControl {plate} size="md" /></div>
</article>

<style>
	.nu-open {
		max-width: 100%;
		min-height: 44px;
		padding-inline: 16px;
		font-weight: 600;
		margin-bottom: 8px;
	}
	.nu-open-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nu-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		justify-items: start;
	}
	.nu-plate {
		font: 600 22px/1.15 var(--f-head);
		overflow-wrap: anywhere;
	}
	.nu-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
</style>
