<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { id }: { id: string } = $props();

	const tabs = $derived([
		{ label: 'Overview', href: resolve('/(app)/builds/[id]', { id }), exact: true },
		{ label: 'Design', href: resolve('/(app)/builds/[id]/design', { id }) },
		{ label: 'Print', href: resolve('/(app)/builds/[id]/print', { id }) },
		{ label: 'Parts', href: resolve('/(app)/builds/[id]/parts', { id }) },
		{ label: 'Finish', href: resolve('/(app)/builds/[id]/finish', { id }) },
		{ label: '⚙ Settings', name: 'Settings', href: resolve('/(app)/builds/[id]/settings', { id }) }
	]);
	const here = (t: { href: string; exact?: boolean }) =>
		t.exact ? page.url.pathname === t.href : page.url.pathname.startsWith(t.href);

	let nav: HTMLElement | undefined = $state();
	let fadeStart = $state(false);
	let fadeEnd = $state(false);

	function measure() {
		if (!nav) return;
		fadeStart = nav.scrollLeft > 2;
		fadeEnd = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2;
	}

	// Keep the active tab in view (centered) whenever the route or the bar's width changes.
	$effect(() => {
		void page.url.pathname;
		if (!nav) return;
		const el = nav.querySelector<HTMLElement>('[aria-current="page"]');
		if (el && nav.scrollWidth > nav.clientWidth) {
			const target = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2;
			nav.scrollLeft = Math.max(0, target);
		}
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(nav);
		return () => ro.disconnect();
	});
</script>

<nav
	class="tabs"
	class:fade-start={fadeStart}
	class:fade-end={fadeEnd}
	aria-label="Build sections"
	bind:this={nav}
	onscroll={measure}
>
	{#each tabs as t (t.href)}
		<a href={t.href} aria-current={here(t) ? 'page' : undefined} aria-label={t.name}>{t.label}</a>
	{/each}
</nav>
