<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { id, draft = false }: { id: string; draft?: boolean } = $props();

	const settings = $derived<{ label: string; name?: string; href: string; exact?: boolean }>({
		label: '⚙ Settings',
		name: 'Settings',
		href: resolve('/(app)/builds/[id]/settings', { id })
	});
	// A Studio draft has no tracking tabs: design, files (plates, export) and settings only.
	const tabs = $derived<{ label: string; name?: string; href: string; exact?: boolean }[]>(
		draft
			? [
					{ label: 'Design', href: resolve('/(app)/builds/[id]/design', { id }) },
					{ label: 'Files', href: resolve('/(app)/builds/[id]/files', { id }) },
					settings
				]
			: [
					{ label: 'Overview', href: resolve('/(app)/builds/[id]', { id }), exact: true },
					{ label: 'Design', href: resolve('/(app)/builds/[id]/design', { id }) },
					{ label: 'Print', href: resolve('/(app)/builds/[id]/print', { id }) },
					{ label: 'Files', href: resolve('/(app)/builds/[id]/files', { id }) },
					{ label: 'Finish', href: resolve('/(app)/builds/[id]/finish', { id }) },
					settings
				]
	);
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
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={t.href} aria-current={here(t) ? 'page' : undefined} aria-label={t.name}>{t.label}</a>
	{/each}
</nav>
