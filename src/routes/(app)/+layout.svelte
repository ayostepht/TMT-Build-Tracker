<script lang="ts">
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
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

	// The build being looked at (the build layout puts its view into page data).
	const current = $derived(
		(page.data as { view?: { build: { id: string; name: string } } }).view?.build ?? null
	);
	const overviewHref = $derived(current ? resolve('/(app)/builds/[id]', { id: current.id }) : null);
	const onOverview = $derived(!!overviewHref && page.url.pathname === overviewHref);
	const onSetup = $derived(page.route.id === '/(app)/builds/[id]/setup');
	// Pages that are not part of a build carry `?from=<id>` so they can lead back to it.
	const fromQuery = $derived(current ? `?from=${current.id}` : '');

	let open = $state<'builds' | 'account' | null>(null);
	afterNavigate(() => (open = null));
	function toggle(which: 'builds' | 'account') {
		open = open === which ? null : which;
	}
	function onWindowClick(e: MouseEvent) {
		if (!(e.target as Element | null)?.closest('.menu-wrap')) open = null;
	}
</script>

<svelte:window
	onclick={onWindowClick}
	onkeydown={(e) => {
		if (e.key === 'Escape') open = null;
	}}
/>

<div class="wrap">
	<header class="topbar">
		<div class="left">
			<a class="brand" href={resolve('/(app)')}>TMT Build Tracker</a>
			<nav class="main" aria-label="Main">
				<div class="menu-wrap">
					<button
						type="button"
						class="navlink"
						aria-haspopup="true"
						aria-expanded={open === 'builds'}
						data-testid="builds-menu"
						onclick={() => toggle('builds')}>Builds <span aria-hidden="true">▾</span></button
					>
					{#if open === 'builds'}
						<div class="menu builds" role="menu" data-testid="builds-menu-panel">
							{#if data.recentBuilds.length}
								<div class="menu-h">Recent builds</div>
								<ul>
									{#each data.recentBuilds as b (b.id)}
										<li>
											<a
												role="menuitem"
												href={b.setupStep !== null
													? resolve('/(app)/builds/[id]/setup', { id: b.id })
													: resolve('/(app)/builds/[id]', { id: b.id })}
												aria-current={current?.id === b.id ? 'true' : undefined}
											>
												<span class="bn">{b.name}</span>
												<span class="bm"
													>{b.workspace} ·
													{#if b.setupStep !== null}setup step {b.setupStep} of 5{:else}{b.progress}%
														printed{/if}</span
												>
												<span class="mini" aria-hidden="true"
													><span style="width:{b.setupStep !== null ? 0 : b.progress}%"
													></span></span
												>
											</a>
										</li>
									{/each}
								</ul>
							{:else}
								<div class="menu-h">No builds yet</div>
							{/if}
							<div class="menu-foot">
								<a role="menuitem" href={resolve('/(app)')} data-testid="all-builds">All builds</a>
								<a
									role="menuitem"
									class="btn primary sm"
									href={resolve('/(app)/builds/new')}
									data-testid="menu-new-build">New build</a
								>
							</div>
						</div>
					{/if}
				</div>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="navlink" href={resolve('/(app)/designs') + fromQuery}>Designs</a>
			</nav>
		</div>
		<div class="who">
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
			{:else}
				<a class="muted" href={resolve('/(app)/onboarding')}>Create a chapter</a>
			{/if}
			<div class="menu-wrap">
				<button
					type="button"
					class="navlink acct"
					aria-haspopup="true"
					aria-expanded={open === 'account'}
					data-testid="account-menu"
					onclick={() => toggle('account')}
					><span class="who-name">{data.user?.name ?? 'Account'}</span>
					<span aria-hidden="true">▾</span></button
				>
				{#if open === 'account'}
					<div class="menu account" role="menu">
						{#if data.user}<div class="menu-h">{data.user.email}</div>{/if}
						{#if data.siteAdmin}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a role="menuitem" href={resolve('/(app)/admin/templates') + fromQuery}>Kit admin</a>
						{/if}
						<button type="button" role="menuitem" onclick={signOut}>Sign out</button>
					</div>
				{/if}
			</div>
		</div>
		{#if current && !onOverview && !onSetup}
			<a class="crumb" href={overviewHref} data-testid="back-to-build"
				><span aria-hidden="true">←</span> {current.name}</a
			>
		{/if}
	</header>
	{@render children()}
</div>

<style>
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px 12px;
		flex-wrap: wrap;
	}
	.left,
	.who,
	.main {
		display: flex;
		align-items: center;
		gap: 6px 12px;
		min-width: 0;
	}
	.left {
		gap: 6px 18px;
		flex-wrap: wrap;
	}
	.who {
		font-size: 14px;
	}
	.navlink {
		background: none;
		border: 0;
		padding: 8px 6px;
		min-height: 40px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font: 600 15px/1 var(--f-body);
		color: var(--ink);
		text-decoration: none;
		border-radius: 6px;
		cursor: pointer;
	}
	.navlink:hover {
		background: var(--accent-soft);
	}
	.acct .who-name {
		max-width: 14ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.menu-wrap {
		position: relative;
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 40;
		min-width: 240px;
		max-width: min(340px, calc(100vw - 32px));
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
		padding: 6px;
		display: grid;
		gap: 2px;
	}
	.menu.account {
		left: auto;
		right: 0;
	}
	.menu-h {
		font: 600 12px/1 var(--f-body);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
		padding: 8px 8px 6px;
		overflow-wrap: anywhere;
		text-transform: none;
		letter-spacing: 0;
	}
	.menu ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.menu a,
	.menu button {
		display: grid;
		gap: 2px;
		padding: 9px 10px;
		min-height: 44px;
		align-content: center;
		border-radius: 6px;
		color: var(--ink);
		text-decoration: none;
		background: none;
		border: 0;
		text-align: left;
		font: inherit;
	}
	.menu a:hover,
	.menu button:hover {
		background: var(--accent-soft);
	}
	.menu a[aria-current='true'] {
		background: var(--accent-soft);
	}
	.bn {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bm {
		font-size: 12px;
		color: var(--muted);
	}
	.mini {
		display: block;
		height: 4px;
		border-radius: 2px;
		background: var(--line);
		overflow: hidden;
	}
	.mini span {
		display: block;
		height: 100%;
		background: var(--ok);
	}
	.menu-foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		border-top: 1px solid var(--line);
		margin-top: 4px;
		padding-top: 6px;
	}
	.menu-foot a {
		min-height: 36px;
	}
	.menu-foot .btn {
		display: inline-flex;
		align-items: center;
		color: #fff;
	}
	.crumb {
		flex-basis: 100%;
		display: none;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--accent-soft);
		color: var(--accent);
		gap: 6px;
		font-weight: 600;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-height: 40px;
		align-items: center;
	}
	@media (max-width: 760px) {
		.crumb {
			display: flex;
		}
		.brand {
			font-size: 20px;
		}
		.topbar {
			position: relative;
		}
		.menu-wrap {
			position: static;
		}
		.menu,
		.menu.account {
			left: 0;
			right: 0;
			max-width: none;
		}
	}
</style>
