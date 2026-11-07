<script lang="ts">
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { PrinterStore } from '#lib/client/printer-store.svelte.ts';
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
		(page.data as { view?: { build: { id: string; name: string; kind?: string } } }).view?.build ??
			null
	);
	const isDraft = $derived(current?.kind === 'draft');
	// A draft has no Overview: its crumb leads back to the Studio.
	const overviewHref = $derived(
		current
			? isDraft
				? resolve('/(app)/studio')
				: resolve('/(app)/builds/[id]', { id: current.id })
			: null
	);
	const onOverview = $derived(!isDraft && !!overviewHref && page.url.pathname === overviewHref);
	const onSetup = $derived(page.route.id === '/(app)/builds/[id]/setup');
	// Pages that are not part of a build carry `?from=<id>` so they can lead back to it.
	const fromQuery = $derived(current ? `?from=${current.id}` : '');

	// The workspace the nav acts on: the build being looked at, else the active workspace.
	const buildOrg = $derived(
		(page.data as { view?: { build: { organizationId: string } } }).view?.build.organizationId
	);
	const workspace = $derived(
		data.teams.find((t) => t.id === buildOrg) ??
			data.teams.find((t) => t.id === data.activeTeamId) ??
			data.teams[0] ??
			null
	);
	// Printers live in one workspace: when the current one has none but another does, the nav
	// (link and "n printing") follows the printers rather than showing an empty page.
	const printersWorkspace = $derived.by(() => {
		if (!workspace) return null;
		if (data.printerCounts[workspace.id]) return workspace;
		return data.teams.find((t) => data.printerCounts[t.id] > 0) ?? workspace;
	});
	const printersHref = $derived(
		printersWorkspace
			? resolve('/(app)/teams/[slug]/printers', { slug: printersWorkspace.slug })
			: null
	);
	const membersHref = $derived(
		workspace && !workspace.personal
			? resolve('/(app)/teams/[slug]/members', { slug: workspace.slug })
			: null
	);
	const integrationsHref = $derived(
		workspace ? resolve('/(app)/teams/[slug]/integrations', { slug: workspace.slug }) : null
	);

	// Live "n printing" next to Printers, from the workspace's printer stream.
	let store = $state<PrinterStore | null>(null);
	$effect(() => {
		const id = printersWorkspace?.id;
		if (!id) {
			store = null;
			return;
		}
		const s = new PrinterStore(id);
		store = s;
		return untrack(() => s.acquire());
	});
	const printingCount = $derived(
		store?.printers.filter((p) => p.enabled && p.status?.state === 'printing').length ?? 0
	);

	let open = $state<'builds' | 'account' | 'settings' | null>(null);
	afterNavigate(() => (open = null));
	function toggle(which: 'builds' | 'account' | 'settings') {
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
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="navlink"
					href={resolve('/(app)/studio') + fromQuery}
					data-testid="nav-studio"
					aria-current={page.url.pathname.startsWith('/studio') ||
					page.url.pathname.startsWith('/designs')
						? 'page'
						: undefined}>Studio</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{#if printersHref}
					<a
						class="navlink"
						href={printersHref}
						data-testid="nav-printers"
						aria-current={page.url.pathname === printersHref ? 'page' : undefined}
						>Printers{#if printingCount}<span class="live" data-testid="nav-printing"
								><span class="dot" aria-hidden="true"></span>{printingCount} printing</span
							>{/if}</a
					>
				{/if}
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
			{#if workspace}
				<div class="menu-wrap ws-settings">
					<button
						type="button"
						class="navlink"
						aria-haspopup="true"
						aria-expanded={open === 'settings'}
						data-testid="workspace-settings-menu"
						onclick={() => toggle('settings')}
						>Workspace settings <span aria-hidden="true">▾</span></button
					>
					{#if open === 'settings'}
						<div class="menu account" role="menu" data-testid="workspace-settings-panel">
							<div class="menu-h">{workspace.name}</div>
							{#if membersHref}
								<a role="menuitem" href={membersHref} data-testid="ws-members">Members</a>
							{/if}
							<a role="menuitem" href={integrationsHref} data-testid="ws-integrations"
								>Integrations</a
							>
						</div>
					{/if}
				</div>
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
						{#if workspace}
							{#if membersHref}<a role="menuitem" class="phone-only" href={membersHref}>Members</a
								>{/if}
							<a role="menuitem" class="phone-only" href={integrationsHref}>Integrations</a>
						{/if}
						<button type="button" role="menuitem" onclick={signOut}>Sign out</button>
					</div>
				{/if}
			</div>
		</div>
		{#if current && !onOverview && !onSetup}
			<a class="crumb" href={overviewHref} data-testid="back-to-build"
				><span aria-hidden="true">←</span> {isDraft ? 'Studio' : current.name}</a
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
	.live {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: 4px;
		font: 600 12px/1 var(--f-body);
		color: var(--muted);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ok);
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
	.menu a:not(.btn),
	.menu button:not(.btn) {
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
	.menu a:not(.btn):hover,
	.menu button:not(.btn):hover {
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
	.phone-only {
		display: none !important;
	}
	.who select {
		max-width: 150px;
	}
	@media (max-width: 760px) {
		.ws-settings {
			display: none;
		}
		.phone-only {
			display: grid !important;
		}
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
