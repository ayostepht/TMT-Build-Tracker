<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { id }: { id: string } = $props();

	const tabs = $derived([
		{ label: 'Overview', href: resolve('/(app)/builds/[id]', { id }) },
		{ label: 'Parts', href: resolve('/(app)/builds/[id]/parts', { id }) },
		{ label: 'Plates', href: resolve('/(app)/builds/[id]/plates', { id }) },
		{ label: 'Design', href: resolve('/(app)/builds/[id]/design', { id }) },
		{ label: 'Assembly', href: resolve('/(app)/builds/[id]/assembly', { id }) },
		{ label: 'Handoff', href: resolve('/(app)/builds/[id]/handoff', { id }) },
		{ label: 'Settings', href: resolve('/(app)/builds/[id]/settings', { id }) }
	]);
</script>

<nav class="tabs" aria-label="Build sections">
	{#each tabs as t (t.href)}
		<a href={t.href} aria-current={page.url.pathname === t.href ? 'page' : undefined}>{t.label}</a>
	{/each}
</nav>
