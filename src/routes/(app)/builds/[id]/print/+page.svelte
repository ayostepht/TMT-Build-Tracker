<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { filamentLabel, groupParts } from '#lib/domain/index.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import PartRow from '#lib/components/PartRow.svelte';
	import Swatch from '#lib/components/Swatch.svelte';
	import PlateStart from '#lib/components/PlateStart.svelte';
	import PlateTime from '#lib/components/PlateTime.svelte';
	import LogPlateButton from '#lib/components/LogPlateButton.svelte';

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
	let by = $state<By>('plate');

	// Remember the toolbar per build (localStorage can be blocked; render fine without it).
	try {
		const u = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		if (typeof u.role === 'string') role = u.role;
		if (typeof u.hidePrinted === 'boolean') hidePrinted = u.hidePrinted;
		if (['role', 'section', 'plate'].includes(u.group)) by = u.group;
	} catch {
		/* ignore */
	}

	// A #plate-N / #part-slug link (Activity feed) shows its target for this visit only: the
	// overrides below win over the saved toolbar, are never written to localStorage, and are
	// dropped as soon as the user touches the matching control.
	let ovBy = $state<By | null>(null);
	let ovRole = $state<string | null>(null);
	let ovHide = $state<boolean | null>(null);
	let flash = $state<string | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	const curBy = $derived(ovBy ?? by);
	const curRole = $derived(ovRole ?? role);
	const curHide = $derived(ovHide ?? hidePrinted);

	async function followHash() {
		const m = /^#(plate|part)-(.+)$/.exec(location.hash);
		if (!m) return;
		let slug = m[2];
		try {
			slug = decodeURIComponent(slug);
		} catch {
			/* keep raw */
		}
		const id = `${m[1]}-${slug}`;
		if (m[1] === 'plate') {
			if (!/^\d+$/.test(slug) || !ctx.view.plates.some((p) => String(p.number) === slug)) return;
			ovBy = 'plate';
		} else if (!ctx.view.parts.some((p) => p.slug === slug)) return;
		ovRole = 'all';
		ovHide = false;
		flash = null;
		await tick();
		const el = document.getElementById(id);
		if (!el) return;
		const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
		el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
		flash = id;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flash = null), 2000);
	}
	afterNavigate(() => void followHash());
	onMount(() => {
		const on = () => void followHash();
		window.addEventListener('hashchange', on);
		return () => {
			window.removeEventListener('hashchange', on);
			clearTimeout(flashTimer);
		};
	});

	$effect(() => {
		const v = JSON.stringify({ role, hidePrinted, group: by });
		try {
			localStorage.setItem(KEY, v);
		} catch {
			/* ignore */
		}
	});

	const activeRole = $derived(
		curRole === 'all' || ctx.view.filaments.some((f) => f.key === curRole) ? curRole : 'all'
	);
	const groups = $derived(groupParts(ctx.view, curBy, { role: activeRole, hidePrinted: curHide }));
	const pickRole = (k: string) => {
		role = k;
		ovRole = null;
	};
</script>

{#snippet startFor(key: string)}
	{@const pl = ctx.view.plates.find((p) => String(p.number) === key)}
	{#if pl}<PlateTime plate={pl} /><PlateStart plate={pl} /><LogPlateButton plate={pl} />{/if}
{/snippet}

<svelte:head><title>Print · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

<div class="toolbar" role="toolbar" aria-label="Filter parts">
	<div class="chips">
		<button
			class="chip"
			type="button"
			aria-pressed={activeRole === 'all'}
			onclick={() => pickRole('all')}>All filament</button
		>
		{#each ctx.view.filaments as f (f.key)}
			<button
				class="chip"
				type="button"
				aria-pressed={activeRole === f.key}
				onclick={() => pickRole(f.key)}
			>
				<Swatch hex={f.hex} tpu={f.tpu} size="mini" />
				{filamentLabel(f)}
			</button>
		{/each}
	</div>
	<label class="tog"
		><input
			type="checkbox"
			bind:checked={
				() => curHide,
				(v) => {
					hidePrinted = v;
					ovHide = null;
				}
			}
		/> Hide printed</label
	>
	<label class="tog"
		>Group by
		<select
			bind:value={
				() => curBy,
				(v) => {
					by = v;
					ovBy = null;
				}
			}
		>
			<option value="role">Filament</option>
			<option value="section">Section</option>
			<option value="plate">Plate</option>
		</select>
	</label>
	<button class="btn sm" type="button" onclick={() => ctx.openGuide(null)}>Open build guide</button>
</div>

<main>
	{#each groups as g (g.key)}
		<section
			class="group"
			class:flash={flash !== null && flash === `plate-${g.key}`}
			id={curBy === 'plate' && /^\d+$/.test(g.key) ? `plate-${g.key}` : undefined}
			style="margin-bottom:14px"
		>
			<div class="group-head">
				<h2>{g.title}</h2>
				<span class="meta num">{g.meta}</span>
				{#if curBy === 'plate'}
					{@render startFor(g.key)}
				{/if}
			</div>
			<div class="rows">
				{#each g.parts as p (p.slug)}
					<PartRow part={p} focus={flash === `part-${p.slug}`} />
				{/each}
			</div>
		</section>
	{:else}
		<div class="empty">Nothing left to show here. Everything in this filter is printed.</div>
	{/each}
</main>
