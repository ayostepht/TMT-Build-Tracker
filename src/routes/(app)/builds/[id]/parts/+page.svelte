<script lang="ts">
	import { filamentLabel, groupParts } from '#lib/domain/index.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import PartRow from '#lib/components/PartRow.svelte';
	import Swatch from '#lib/components/Swatch.svelte';

	const ctx = getBuildCtx();
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
	{#each groups as g (g.key)}
		<section class="group" style="margin-bottom:14px">
			<div class="group-head">
				<h2>{g.title}</h2>
				<span class="meta num">{g.meta}</span>
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
