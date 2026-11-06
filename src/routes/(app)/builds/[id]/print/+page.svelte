<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { filamentLabel, groupParts } from '#lib/domain/index.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import PartRow from '#lib/components/PartRow.svelte';
	import Swatch from '#lib/components/Swatch.svelte';
	import PlateStart from '#lib/components/PlateStart.svelte';
	import ReadyToPrint from '#lib/components/ReadyToPrint.svelte';

	const ctx = getBuildCtx();

	// `/print` used to be the plates view. Old bookmarks and links with its anchors go to `/files`.
	onMount(() => {
		const h = location.hash;
		if (h === '#plates' || h === '#export' || h === '#settings') {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			void goto(resolve('/(app)/builds/[id]/files', { id: ctx.id }) + h, { replaceState: true });
		}
	});
	type By = 'role' | 'section' | 'plate';
	const KEY = `tmt-ui:${ctx.id}`;

	let role = $state('all');
	let hidePrinted = $state(false);
	let by = $state<By>('role');

	// Remember the toolbar per build (localStorage can be blocked; render fine without it).
	try {
		const u = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		if (typeof u.role === 'string') role = u.role;
		if (typeof u.hidePrinted === 'boolean') hidePrinted = u.hidePrinted;
		if (['role', 'section', 'plate'].includes(u.by)) by = u.by;
	} catch {
		/* ignore */
	}
	$effect(() => {
		const v = JSON.stringify({ role, hidePrinted, by });
		try {
			localStorage.setItem(KEY, v);
		} catch {
			/* ignore */
		}
	});

	const activeRole = $derived(
		role === 'all' || ctx.view.filaments.some((f) => f.key === role) ? role : 'all'
	);
	const groups = $derived(groupParts(ctx.view, by, { role: activeRole, hidePrinted }));
</script>

{#snippet startFor(key: string)}
	{@const pl = ctx.view.plates.find((p) => String(p.number) === key)}
	{#if pl}<PlateStart plate={pl} />{/if}
{/snippet}

<svelte:head><title>Print · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

<div class="toolbar" role="toolbar" aria-label="Filter parts">
	<div class="chips">
		<button
			class="chip"
			type="button"
			aria-pressed={activeRole === 'all'}
			onclick={() => (role = 'all')}>All filament</button
		>
		{#each ctx.view.filaments as f (f.key)}
			<button
				class="chip"
				type="button"
				aria-pressed={activeRole === f.key}
				onclick={() => (role = f.key)}
			>
				<Swatch hex={f.hex} tpu={f.tpu} size="mini" />
				{filamentLabel(f)}
			</button>
		{/each}
	</div>
	<label class="tog"><input type="checkbox" bind:checked={hidePrinted} /> Hide printed</label>
	<label class="tog"
		>Group by
		<select bind:value={by}>
			<option value="role">Filament</option>
			<option value="section">Section</option>
			<option value="plate">Plate</option>
		</select>
	</label>
	<button class="gbtn" type="button" onclick={() => ctx.openGuide(null)}>Open build guide</button>
</div>

<main>
	<ReadyToPrint />
	{#each groups as g (g.key)}
		<section class="group" style="margin-bottom:14px">
			<div class="group-head">
				<h2>{g.title}</h2>
				<span class="meta num">{g.meta}</span>
				{#if by === 'plate'}
					{@render startFor(g.key)}
				{/if}
			</div>
			<div class="rows">
				{#each g.parts as p (p.slug)}
					<PartRow part={p} />
				{/each}
			</div>
		</section>
	{:else}
		<div class="empty">Nothing left to show here. Everything in this filter is printed.</div>
	{/each}
</main>
