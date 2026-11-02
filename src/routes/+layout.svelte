<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>TMT Build Tracker</title>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
