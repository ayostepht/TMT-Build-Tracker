<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	async function signOut() {
		await authClient.signOut();
		await invalidateAll();
		await goto(resolve('/login'));
	}
</script>

<div class="wrap">
	<header class="topbar">
		<span class="brand">TMT Build Tracker</span>
		<div class="who">
			<span>Signed in as <b>{data.user.name}</b> ({data.user.email})</span>
			<button class="btn" onclick={signOut}>Sign out</button>
		</div>
	</header>

	<section>
		<div class="kicker">Templates</div>
		<ul class="tpl-list">
			{#each data.templates as t (t.id)}
				<li class="tpl">
					<h3>{t.name}</h3>
					<div class="muted">{t.version}</div>
					<div class="counts">
						<span class="set">{t.parts} parts</span>
						<span class="set">{t.plates} plates</span>
					</div>
					<p class="muted">{t.description}</p>
				</li>
			{:else}
				<li class="muted">No templates seeded.</li>
			{/each}
		</ul>
	</section>
</div>
