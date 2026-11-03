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

	const showSwitcher = $derived(data.teams.length > 1 || data.invitationCount > 0);

	async function switchTeam(e: Event & { currentTarget: HTMLSelectElement }) {
		const value = e.currentTarget.value;
		if (value === '__create' || value === '__invites') {
			e.currentTarget.value = data.activeTeamId ?? '';
			await goto(resolve('/(app)/onboarding'));
			return;
		}
		const team = data.teams.find((t) => t.id === value);
		if (!team) return;
		await authClient.organization.setActive({ organizationId: value });
		await invalidateAll();
		// Go straight to the workspace page rather than via "/", which redirects by session state.
		await goto(resolve('/(app)/teams/[slug]', { slug: team.slug }));
	}
</script>

<div class="wrap">
	<header class="topbar">
		<div class="left">
			<a class="brand" href={resolve('/(app)')}>TMT Build Tracker</a>
			{#if showSwitcher}
				<label class="chapter">
					<span class="sr-only">Workspace</span>
					<select value={data.activeTeamId ?? ''} onchange={switchTeam} aria-label="Workspace">
						{#each data.teams as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
						<option value="__create">Create a chapter…</option>
						{#if data.invitationCount > 0}
							<option value="__invites">Invitations ({data.invitationCount})</option>
						{/if}
					</select>
				</label>
			{/if}
		</div>
		<div class="who">
			{#if !showSwitcher}
				<a class="muted" href={resolve('/(app)/onboarding')}>Create a chapter</a>
			{/if}
			{#if data.user}<span>{data.user.name}</span>{/if}
			<button class="btn sm" type="button" onclick={signOut}>Sign out</button>
		</div>
	</header>
	{@render children()}
</div>
