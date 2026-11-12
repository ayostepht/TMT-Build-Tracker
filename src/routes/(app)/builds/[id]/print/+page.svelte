<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { groupParts } from '#lib/domain/index.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import PartRow from '#lib/components/PartRow.svelte';
	import PlateTime from '#lib/components/PlateTime.svelte';
	import PlateControl from '#lib/components/PlateControl.svelte';
	import PrintToolbar from '#lib/components/PrintToolbar.svelte';
	import PlateHistory from '#lib/components/PlateHistory.svelte';

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
	// null = the reader never chose: Printed parts are hidden once the build is under way (some part
	// Printed), shown while nothing is printed yet. A choice is remembered per build on this device.
	let hideChoice = $state<boolean | null>(null);
	let by = $state<By>('plate');
	const underWay = $derived(
		ctx.view.parts.some((p) => ctx.view.state[p.slug]?.status === 'Printed')
	);
	const hidePrinted = $derived(hideChoice ?? underWay);

	// Remember the toolbar per build (localStorage can be blocked; render fine without it).
	try {
		const u = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		if (typeof u.role === 'string') role = u.role;
		if (typeof u.hide === 'boolean') hideChoice = u.hide;
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
		const v = JSON.stringify({ role, hide: hideChoice ?? undefined, group: by });
		try {
			localStorage.setItem(KEY, v);
		} catch {
			/* ignore */
		}
	});

	const activeRole = $derived(
		curRole === 'all' || ctx.view.filaments.some((f) => f.key === curRole) ? curRole : 'all'
	);
	// Parts that became Printed during this visit (here, or live from another member) stay visible
	// with a "Printed just now" marker until a reload or until the Hide printed toggle is touched.
	const justPrinted = new SvelteSet<string>();
	const prevStatus: Record<string, string | undefined> = Object.fromEntries(
		ctx.view.parts.map((p) => [p.slug, ctx.view.state[p.slug]?.status])
	);
	$effect(() => {
		for (const p of ctx.view.parts) {
			const s = ctx.view.state[p.slug]?.status;
			if (s === prevStatus[p.slug]) continue;
			prevStatus[p.slug] = s;
			if (s === 'Printed') justPrinted.add(p.slug);
			else justPrinted.delete(p.slug);
		}
	});
	const groups = $derived(
		groupParts(ctx.view, curBy, { role: activeRole, hidePrinted: curHide, keep: justPrinted })
	);
	// Plate history: collapsed by default, one toggle per plate group (not part of the toolbar).
	let histOpen = $state<Record<string, boolean>>({});
	const histCount = (key: string) =>
		ctx.view.runs.filter((r) => String(r.plateNumber) === key).length;
	const pickRole = (k: string) => {
		role = k;
		ovRole = null;
	};
</script>

{#snippet startFor(key: string)}
	{@const pl = ctx.view.plates.find((p) => String(p.number) === key)}
	{#if pl}<PlateTime plate={pl} /><PlateControl plate={pl} />{/if}
	{#if histCount(key)}
		<button
			class="btn sm ghost"
			type="button"
			aria-expanded={!!histOpen[key]}
			aria-controls="plate-history-{key}"
			data-testid="plate-history-toggle"
			onclick={() => (histOpen[key] = !histOpen[key])}>History ({histCount(key)})</button
		>
	{/if}
{/snippet}

<svelte:head><title>Print · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

<PrintToolbar
	role={activeRole}
	hide={curHide}
	by={curBy}
	onrole={pickRole}
	onhide={(v) => {
		hideChoice = v;
		ovHide = null;
		justPrinted.clear();
	}}
	onby={(v) => {
		by = v;
		ovBy = null;
	}}
/>

<div>
	{#each groups as g (g.key)}
		<section
			class="group"
			class:flash={flash !== null && flash === `plate-${g.key}`}
			id={curBy === 'plate' && /^\d+$/.test(g.key) ? `plate-${g.key}` : undefined}
			style="margin-bottom:var(--sp-7)"
		>
			<div class="group-head">
				<h2>{g.title}</h2>
				<span class="meta num">{g.meta}</span>
				{#if curBy === 'plate'}
					{@render startFor(g.key)}
				{/if}
			</div>
			{#if curBy === 'plate' && /^\d+$/.test(g.key) && histOpen[g.key] && histCount(g.key)}
				<PlateHistory plateNumber={Number(g.key)} />
			{/if}
			<div class="rows">
				{#each g.parts as p (p.slug)}
					<PartRow
						part={p}
						focus={flash === `part-${p.slug}`}
						justNow={curHide && justPrinted.has(p.slug)}
						plateHeader={curBy === 'plate'}
					/>
				{/each}
			</div>
		</section>
	{:else}
		<div class="empty">Nothing left to show here. Everything in this filter is printed.</div>
	{/each}
</div>
