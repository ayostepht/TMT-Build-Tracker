<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { id, draft = false }: { id: string; draft?: boolean } = $props();

	type Tab = { label: string; name?: string; href: string; exact?: boolean; icon: string };
	// Icon paths (24x24, stroked) for the phone's bottom bar.
	const ICONS: Record<string, string> = {
		overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
		design: 'M12 3C12 3 5 11 5 15a7 7 0 0 0 14 0C19 11 12 3 12 3z',
		print: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
		files: 'M6 3h8l4 4v14H6zM14 3v4h4',
		finish: 'M4 12.5l5 5L20 6.5',
		settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6'
	};
	const settings = $derived<Tab>({
		label: 'Settings',
		name: 'Settings',
		icon: 'settings',
		href: resolve('/(app)/builds/[id]/settings', { id })
	});
	// A Studio draft has no tracking tabs: design, files (plates, export) and settings only.
	const tabs = $derived<Tab[]>(
		draft
			? [
					{ label: 'Design', icon: 'design', href: resolve('/(app)/builds/[id]/design', { id }) },
					{ label: 'Files', icon: 'files', href: resolve('/(app)/builds/[id]/files', { id }) },
					settings
				]
			: [
					{
						label: 'Overview',
						icon: 'overview',
						href: resolve('/(app)/builds/[id]', { id }),
						exact: true
					},
					{ label: 'Design', icon: 'design', href: resolve('/(app)/builds/[id]/design', { id }) },
					{ label: 'Print', icon: 'print', href: resolve('/(app)/builds/[id]/print', { id }) },
					{ label: 'Files', icon: 'files', href: resolve('/(app)/builds/[id]/files', { id }) },
					{ label: 'Finish', icon: 'finish', href: resolve('/(app)/builds/[id]/finish', { id }) },
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

<!--
	One nav, two looks. Desktop: the sticky tab strip under the header. Phone (<= 760px): a bottom
	tab bar. The <nav> itself becomes `display: contents` there (zero-size, so code that measures
	`nav.tabs` for a top offset gets 0) and the inner row is fixed to the bottom of the screen.
-->
<nav
	class="tabs"
	class:fade-start={fadeStart}
	class:fade-end={fadeEnd}
	data-bottom
	aria-label="Build sections"
	bind:this={nav}
	onscroll={measure}
>
	<div class="tb-in" style="--n:{tabs.length}">
		{#each tabs as t (t.href)}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={t.href} aria-current={here(t) ? 'page' : undefined} aria-label={t.name}>
				<svg class="tb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[t.icon]} /></svg>
				<!-- eslint-disable-next-line svelte/no-useless-mustaches -- the trailing space must survive -->
				{#if t.icon === 'settings'}<span class="tb-gear" aria-hidden="true">{'⚙ '}</span
					>{/if}{t.label}
			</a>
		{/each}
	</div>
</nav>

<style>
	.tb-in {
		display: contents;
	}
	.tb-ic {
		display: none;
	}
	@media (max-width: 760px) {
		nav.tabs {
			display: contents;
		}
		.tb-in {
			display: grid;
			grid-template-columns: repeat(var(--n), minmax(0, 1fr));
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			/* Below dialogs, sheets and the guide viewer (z-index 50+), above page content. */
			z-index: 20;
			background: var(--card);
			border-top: 1px solid var(--line);
			padding-bottom: env(safe-area-inset-bottom, 0px);
		}
		.tb-in a {
			flex-direction: column;
			justify-content: center;
			gap: 3px;
			min-height: 56px;
			padding: 6px 2px;
			font: 600 13px/1.1 var(--f-display);
			letter-spacing: 0.01em;
			border-bottom: 0;
			border-top: 3px solid transparent;
			-webkit-tap-highlight-color: transparent;
		}
		.tb-in a[aria-current='page'] {
			border-top-color: var(--accent);
		}
		.tb-ic {
			display: block;
			width: 22px;
			height: 22px;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.8;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.tb-gear {
			display: none;
		}
	}
</style>
