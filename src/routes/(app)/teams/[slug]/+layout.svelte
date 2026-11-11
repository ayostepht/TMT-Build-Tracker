<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const slug = $derived(data.team.slug);
	const tabs = $derived([
		{ label: 'Builds', href: resolve('/(app)/teams/[slug]', { slug }) },
		...(data.team.personal
			? []
			: [{ label: 'Members', href: resolve('/(app)/teams/[slug]/members', { slug }) }]),
		{ label: 'Printers', href: resolve('/(app)/teams/[slug]/printers', { slug }) },
		{ label: 'Integrations', href: resolve('/(app)/teams/[slug]/integrations', { slug }) }
	]);
</script>

<section class="stack">
	<div class="kicker">{data.team.personal ? 'Just you' : `Chapter (${data.role})`}</div>
	<h1>{data.team.name}</h1>
	<nav class="tabs" aria-label="Chapter sections">
		{#each tabs as t (t.href)}
			<a href={t.href} aria-current={page.url.pathname === t.href ? 'page' : undefined}>{t.label}</a
			>
		{/each}
	</nav>
	{@render children()}
</section>
