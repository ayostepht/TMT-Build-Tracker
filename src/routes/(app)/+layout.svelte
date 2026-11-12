<script lang="ts">
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import { untrack } from 'svelte';
	import { PrinterStore } from '#lib/client/printer-store.svelte.ts';
	import { clearPrivateCaches } from '#lib/client/pwa.ts';
	import AppMark from '#lib/components/AppMark.svelte';
	import Toast from '#lib/components/Toast.svelte';
	import { authClient } from '#lib/auth-client.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	async function signOut() {
		await authClient.signOut();
		await clearPrivateCaches().catch(() => {});
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
	// Inside a build the Builds menu is the "you are here" item. The build tabs lead back to the
	// Overview, so the crumb is only for drafts (their tab bar has no Overview).
	const routeId = $derived(page.route.id ?? '');
	const buildsActive = $derived(
		!!current ||
			routeId.startsWith('/(app)/builds') ||
			routeId === '/(app)/teams/[slug]' ||
			routeId === '/(app)/builds'
	);
	const showCrumb = $derived(!!current && isDraft && !onOverview && !onSetup);
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
	/** Phones: the nav links and menus sit in a panel behind one button. */
	let navOpen = $state(false);
	afterNavigate(() => {
		open = null;
		navOpen = false;
	});

	// Thin progress bar while a navigation is in flight (shown after a short delay, so quick ones stay calm).
	let progress = $state(false);
	$effect(() => {
		if (!navigating.to) return;
		const t = setTimeout(() => (progress = true), 120);
		return () => {
			clearTimeout(t);
			progress = false;
		};
	});
	function toggle(which: 'builds' | 'account' | 'settings') {
		open = open === which ? null : which;
	}
	function onWindowClick(e: MouseEvent) {
		const el = e.target as Element | null;
		if (!el?.closest('.menu-wrap')) open = null;
		if (!el?.closest('.navpanel, .navtoggle')) navOpen = false;
	}

	// The top-bar menus are plain disclosures (a button with aria-expanded plus a list of links),
	// not ARIA menus: Tab walks the items, so no arrow-key handling is promised.
	let topbar = $state<HTMLElement>();
	/** Escape closes the open menu or phone panel and returns focus to the button that opened it. */
	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		const inBar = !!topbar?.contains(document.activeElement);
		if (open !== null) {
			const btn = topbar?.querySelector<HTMLElement>(`[data-menu="${open}"]`);
			open = null;
			if (inBar || document.activeElement === document.body) btn?.focus();
		} else if (navOpen) {
			navOpen = false;
			if (inBar || document.activeElement === document.body)
				topbar?.querySelector<HTMLElement>('.navtoggle')?.focus();
		}
	}
	/** Focus leaving a menu (or the phone panel) closes it. A null target (a click) is left to onWindowClick. */
	function onTopbarFocusOut(e: FocusEvent) {
		const to = e.relatedTarget as Element | null;
		if (!to) return;
		if (!to.closest('.menu-wrap')) open = null;
		else if (open && !to.closest(`.menu-wrap:has([data-menu="${open}"])`)) open = null;
		if (!to.closest('.navpanel, .navtoggle')) navOpen = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div class="navprogress" class:on={progress} aria-hidden="true"></div>

<div class="wrap shell" class:has-tabs={!!current && !onSetup}>
	<header class="topbar" bind:this={topbar} onfocusout={onTopbarFocusOut}>
		<a class="brand shell-brand" href={resolve('/(app)')}><AppMark />TMT Build Tracker</a>
		<div class="chapter-slot">
			{#if showSwitcher}
				<label class="chapter">
					<span class="sr-only">Chapter</span>
					<select value={data.activeTeamId ?? ''} onchange={switchTeam} aria-label="Chapter">
						{#each data.teams as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
						<option value="__create">Create a chapter…</option>
						{#if data.invitationCount > 0}
							<option value="__invites">Invitations ({data.invitationCount})</option>
						{/if}
					</select>
				</label>
			{:else}
				<a class="btn sm create-chapter" href={resolve('/(app)/onboarding')}>Create a chapter</a>
			{/if}
		</div>
		<button
			type="button"
			class="navtoggle"
			aria-expanded={navOpen}
			aria-controls="nav-panel"
			aria-label="Menu"
			data-testid="nav-toggle"
			onclick={() => (navOpen = !navOpen)}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><path d={navOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg
			>
			{#if data.invitationCount > 0 && !navOpen}<span class="badge-dot" aria-hidden="true"
				></span>{/if}
		</button>
		<div class="navpanel" id="nav-panel" class:open={navOpen}>
			<nav class="main" aria-label="Main">
				<div class="menu-wrap">
					<button
						type="button"
						class="navlink"
						class:on={buildsActive}
						aria-expanded={open === 'builds'}
						aria-controls="menu-builds"
						data-menu="builds"
						data-testid="builds-menu"
						onclick={() => toggle('builds')}>Builds <span aria-hidden="true">▾</span></button
					>
					{#if open === 'builds'}
						<div class="menu builds" id="menu-builds" data-testid="builds-menu-panel">
							{#if data.recentBuilds.length}
								<div class="menu-h">Recent builds</div>
								<ul>
									{#each data.recentBuilds as b (b.id)}
										<li>
											<a
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
												<span class="nav-mini" aria-hidden="true"
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
								<a href={resolve('/(app)/builds')} data-testid="all-builds">All builds</a>
								<a
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
					aria-current={page.url.pathname.startsWith('/studio') ? 'page' : undefined}>Studio</a
				>
				<a
					class="navlink"
					href={resolve('/(app)/designs') + fromQuery}
					data-testid="nav-designs"
					aria-current={page.url.pathname.startsWith('/designs') ? 'page' : undefined}>Designs</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{#if printersHref && !data.publicMode}
					<a
						class="navlink"
						href={printersHref}
						data-testid="nav-printers"
						aria-current={page.url.pathname === printersHref ? 'page' : undefined}
						>Printers{#if printingCount}<span class="live" data-testid="nav-printing"
								><span class="live-dot" aria-hidden="true"></span>{printingCount} printing</span
							>{/if}</a
					>
				{/if}
			</nav>
			{#if workspace && (membersHref || !data.publicMode)}
				<div class="menu-wrap ws-settings">
					<button
						type="button"
						class="navlink"
						aria-expanded={open === 'settings'}
						aria-controls="menu-settings"
						data-menu="settings"
						data-testid="workspace-settings-menu"
						onclick={() => toggle('settings')}
						>{workspace.personal ? 'My builds' : 'Chapter'} settings
						<span aria-hidden="true">▾</span></button
					>
					{#if open === 'settings'}
						<div class="menu account" id="menu-settings" data-testid="workspace-settings-panel">
							<div class="menu-h">{workspace.name}</div>
							{#if membersHref}
								<a href={membersHref} data-testid="ws-members">Members</a>
							{/if}
							{#if !data.publicMode}
								<a href={integrationsHref} data-testid="ws-integrations">Integrations</a>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
			<div class="menu-wrap acct-wrap">
				<button
					type="button"
					class="navlink acct"
					aria-expanded={open === 'account'}
					aria-controls="menu-account"
					data-menu="account"
					data-testid="account-menu"
					onclick={() => toggle('account')}
					><span class="who-name">{data.user?.name ?? 'Account'}</span>
					<span aria-hidden="true">▾</span></button
				>
				{#if open === 'account'}
					<div class="menu account" id="menu-account">
						{#if data.user}<div class="menu-h">{data.user.email}</div>{/if}
						{#if !showSwitcher}
							<a class="phone-only" href={resolve('/(app)/onboarding')}>Create a chapter</a>
						{/if}
						{#if data.siteAdmin}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a href={resolve('/(app)/admin/templates') + fromQuery}>Kit admin</a>
						{/if}
						<a href={resolve('/(app)/help')} data-testid="help-link">Help</a>
						<a href={resolve('/(app)/about')} data-testid="about-link">About</a>
						<a href={resolve('/(app)/account')} data-testid="account-link">Account</a>
						<button type="button" onclick={signOut}>Sign out</button>
					</div>
				{/if}
			</div>
		</div>
		{#if showCrumb}
			<a class="nav-crumb" href={overviewHref} data-testid="back-to-build"
				><span aria-hidden="true">←</span> {isDraft ? 'Studio' : current?.name}</a
			>
		{/if}
	</header>
	<main id="main" class="app-main" tabindex="-1">
		{@render children()}
	</main>
	<footer class="app-footer" data-testid="app-footer">
		<nav aria-label="Site">
			<a href={resolve('/(app)/help')} data-testid="footer-help">Help</a>
			<a href={resolve('/(app)/about')} data-testid="footer-about">About</a>
			<a href={resolve('/privacy')} data-testid="footer-privacy">Privacy</a>
			<a href={resolve('/terms')} data-testid="footer-terms">Terms</a>
		</nav>
	</footer>
</div>

<Toast />

<style>
	.app-main {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: inherit;
		min-width: 0;
	}
	/* Quiet site links under every signed-in page. On a build page the phone's fixed tab bar is
	   cleared by .shell.has-tabs padding-bottom (bar height + 20px), which the footer sits above. */
	.app-footer nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--sp-5);
		padding-top: var(--sp-4);
		border-top: 1px solid var(--line);
	}
	.app-footer a {
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		font-size: var(--fs-xs);
		color: var(--muted);
		text-decoration: none;
	}
	.app-footer a:hover {
		color: var(--ink);
		text-decoration: underline;
	}
	@media (pointer: coarse) {
		.app-footer a {
			min-height: 44px;
			padding-inline: 4px;
		}
	}
	.navprogress {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		z-index: 3000;
		overflow: hidden;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.navprogress.on {
		opacity: 1;
	}
	.navprogress::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 40%;
		background: var(--accent);
		animation: navslide 1s ease-in-out infinite;
	}
	@keyframes navslide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(250%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.navprogress::before {
			width: 100%;
			animation: none;
		}
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 6px 12px;
		flex-wrap: wrap;
	}
	/* Desktop: the panel dissolves so brand, nav, chapter and menus sit in one row. */
	.navpanel {
		display: contents;
	}
	.shell-brand {
		order: 0;
		margin-right: 6px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.main {
		order: 1;
	}
	.chapter-slot {
		order: 2;
		margin-left: auto;
		min-width: 0;
	}
	.ws-settings {
		order: 3;
	}
	.acct-wrap {
		order: 4;
	}
	.navtoggle {
		display: none;
	}
	.main {
		display: flex;
		align-items: center;
		gap: 6px 12px;
		min-width: 0;
	}
	.navlink {
		background: none;
		border: 0;
		padding: 8px 6px;
		min-height: 40px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font: 600 var(--fs-base)/1 var(--f-body);
		color: var(--ink);
		text-decoration: none;
		border-radius: var(--r-md);
		cursor: pointer;
	}
	.navlink:hover {
		background: var(--accent-soft);
	}
	.navlink.on,
	.navlink[aria-current='page'] {
		color: var(--accent);
		box-shadow: inset 0 -2px 0 var(--accent);
		border-radius: var(--r-md) var(--r-md) 0 0;
	}
	.live {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: 4px;
		font: 600 var(--fs-xs)/1 var(--f-body);
		color: var(--muted);
	}
	.live-dot {
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
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-2);
		padding: 6px;
		display: grid;
		gap: 2px;
	}
	.menu.account {
		left: auto;
		right: 0;
	}
	.menu-h {
		font: 600 var(--fs-xs)/1 var(--f-body);
		color: var(--muted);
		padding: 8px 8px 6px;
		overflow-wrap: anywhere;
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
		border-radius: var(--r-md);
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
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.nav-mini {
		display: block;
		width: 100%;
		height: 4px;
		border-radius: var(--r-sm);
		background: var(--line);
		overflow: hidden;
	}
	.nav-mini span {
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
	.nav-crumb {
		flex-basis: 100%;
		display: flex;
		padding: 8px 12px;
		border-radius: var(--r-lg);
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
		order: 9;
	}
	.phone-only {
		display: none !important;
	}
	.chapter select {
		max-width: 170px;
	}

	/* Phones: ONE row (brand, chapter, menu button); everything else sits in the menu panel. */
	@media (max-width: 760px) {
		.shell {
			padding-top: 8px;
			gap: 10px;
		}
		.shell.has-tabs {
			padding-bottom: calc(var(--bottom-bar-h) + 20px);
		}
		.topbar {
			position: relative;
			flex-wrap: wrap;
			gap: 0 8px;
			min-height: 48px;
		}
		.shell-brand {
			font-size: var(--fs-lg);
			margin-right: 0;
			flex: none;
		}
		.chapter-slot {
			flex: 1 1 0;
			min-width: 0;
			margin-left: 0;
			order: 1;
		}
		.chapter,
		.chapter select {
			display: block;
			width: 100%;
			max-width: none;
		}
		.create-chapter {
			display: none;
		}
		.navtoggle {
			order: 2;
			display: inline-grid;
			place-items: center;
			position: relative;
			flex: none;
			width: 44px;
			height: 44px;
			border: 1px solid var(--line);
			border-radius: var(--r-lg);
			background: var(--card);
			color: var(--ink);
			padding: 0;
		}
		.navtoggle svg {
			width: 22px;
			height: 22px;
			fill: none;
			stroke: currentColor;
			stroke-width: 2;
			stroke-linecap: round;
		}
		.badge-dot {
			position: absolute;
			top: 6px;
			right: 6px;
			width: 9px;
			height: 9px;
			border-radius: 50%;
			background: var(--accent);
		}
		.navpanel {
			display: none;
			position: absolute;
			top: calc(100% + 4px);
			left: 0;
			right: 0;
			z-index: 40;
			max-height: calc(100dvh - 72px - var(--bottom-bar-h));
			overflow-y: auto;
			background: var(--card);
			border: 1px solid var(--line);
			border-radius: var(--r-xl);
			box-shadow: var(--shadow-2);
			padding: 6px;
			gap: 2px;
		}
		.navpanel.open {
			display: grid;
		}
		.main {
			display: grid;
			gap: 2px;
		}
		.navpanel .navlink {
			width: 100%;
			min-height: 44px;
			padding: 8px 10px;
			justify-content: space-between;
		}
		.navlink.on,
		.navlink[aria-current='page'] {
			box-shadow: none;
			background: var(--accent-soft);
			border-radius: var(--r-md);
		}
		.menu-wrap {
			position: static;
		}
		.acct-wrap,
		.ws-settings {
			border-top: 1px solid var(--line);
			padding-top: 2px;
		}
		.menu,
		.menu.account {
			position: static;
			max-width: none;
			min-width: 0;
			box-shadow: none;
			border: 0;
			background: var(--paper);
			padding: 4px;
			margin: 2px 0 4px;
			border-radius: var(--r-lg);
		}
		.phone-only {
			display: grid !important;
		}
		.nav-crumb {
			order: 9;
		}
	}
</style>
