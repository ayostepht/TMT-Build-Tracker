<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { initPwa } from '#lib/client/pwa.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	/** Skip link: move focus to the page's <main> (a hash jump alone does not move focus). */
	function skip(e: MouseEvent) {
		const main = document.getElementById('main');
		if (!main) return;
		e.preventDefault();
		main.focus();
		main.scrollIntoView({ block: 'start' });
	}

	// Update prompt for the service worker (no-op where there is none, e.g. plain-http LAN).
	onMount(initPwa);
</script>

<svelte:head>
	<title>TMT Build Tracker</title>
</svelte:head>

<a class="skip-link" href="#main" onclick={skip}>Skip to content</a>

{@render children()}

<style>
	.skip-link {
		position: fixed;
		top: 8px;
		left: 8px;
		z-index: 4000;
		padding: 10px 16px;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		border-radius: 8px;
		background: var(--accent);
		color: #fff;
		font: 600 15px/1 var(--f-body);
		text-decoration: none;
		transform: translateY(-200%);
	}
	.skip-link:focus {
		transform: none;
	}
	/* <main> is only focusable so the skip link can land there; it is not a control. */
	:global(main:focus) {
		outline: none;
	}
</style>
