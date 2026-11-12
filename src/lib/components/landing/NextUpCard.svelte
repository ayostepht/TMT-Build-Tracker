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
			class="nu-open"
			href={resolve('/(app)/builds/[id]', { id: ctx.id })}
			data-testid="landing-open-build"
			title={ctx.view.build.name}>{ctx.view.build.name}</a
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
	/* Small heading-style link naming the build, not a button. */
	.nu-open {
		max-width: 100%;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 600 var(--fs-md) / 1.25 var(--f-head);
		color: var(--ink);
		text-decoration: underline;
		text-decoration-color: var(--line);
		text-underline-offset: 3px;
	}
	.nu-open:hover {
		color: var(--accent);
		text-decoration-color: var(--accent);
	}
	@media (pointer: coarse) {
		.nu-open {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
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
