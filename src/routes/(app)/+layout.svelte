<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	async function signOut() {
		await authClient.signOut();
		await invalidateAll();
		await goto(resolve('/login'));
	}

	async function switchTeam(e: Event & { currentTarget: HTMLSelectElement }) {
		await authClient.organization.setActive({ organizationId: e.currentTarget.value });
		await invalidateAll();
		await goto(resolve('/(app)'));
	}
</script>

<div class="wrap">
	<header class="topbar">
		<div class="left">
			<a class="brand" href={resolve('/(app)')}>TMT Build Tracker</a>
			{#if data.teams?.length}
				<label class="chapter">
					<span class="sr-only">Chapter</span>
					<select value={data.activeTeamId ?? ''} onchange={switchTeam} aria-label="Chapter">
						{#each data.teams as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
					</select>
				</label>
			{/if}
		</div>
		<div class="who">
			{#if data.user}<span>{data.user.name}</span>{/if}
			<button class="btn sm" type="button" onclick={signOut}>Sign out</button>
		</div>
	</header>
	{@render children()}
</div>
