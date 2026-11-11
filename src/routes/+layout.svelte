<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { initPwa } from '#lib/client/pwa.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Update prompt for the service worker (no-op where there is none, e.g. plain-http LAN).
	onMount(initPwa);
</script>

<svelte:head>
	<title>TMT Build Tracker</title>
</svelte:head>

{@render children()}
