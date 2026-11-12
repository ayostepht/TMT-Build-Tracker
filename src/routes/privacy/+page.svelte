<script lang="ts">
	import { resolve } from '$app/paths';
	import LegalPage from '#lib/components/LegalPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ISSUES_URL = 'https://github.com/ayostepht/TMT-Build-Tracker/issues';
</script>

<svelte:head><title>Privacy · TMT Build Tracker</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<LegalPage title="Privacy" updated="2026-11-11" signedIn={data.signedIn} other="terms">
	<div data-testid="privacy-mode" data-mode={data.publicMode ? 'public' : 'selfhost'} hidden></div>
	<p>
		This page says what TMT Build Tracker stores about you and where it goes. It describes what the
		software does.
		{#if data.publicMode}
			You are using the public instance, which the TMT Build Tracker project runs (the "operator").
		{:else}
			Whoever runs this server is the "operator", for example a chapter lead or the maker who set it
			up. The project that wrote the software does not run your server and cannot see what is on it.
		{/if}
		The operator can reach everything stored on the server and any backups of it.
	</p>
	<p>The app is for adult makers. It does not ask your age.</p>

	<h2>Your account</h2>
	<ul>
		<li>It stores your name and email address.</li>
		{#if data.publicMode}
			<li>
				You sign in with Google or GitHub. No password is stored. The app keeps a link to your
				sign-in account and the address of your profile picture there (stored, not shown). It keeps
				none of the provider's sign-in tokens.
			</li>
		{:else}
			<li>
				With a password, only a scrambled (hashed) copy is stored, never the password itself. If the
				operator set up single sign-on, the app instead keeps a link to your sign-in account and the
				address of your profile picture there (stored, not shown). It keeps none of the provider's
				sign-in tokens except its ID token (a signed statement containing your name, email address
				and provider account ID), used only to sign you out at the provider.
			</li>
		{/if}
		<li>
			Cookies are used only to keep you signed in. For each sign-in the server keeps a session
			record: when it started and expires and the browser identification (user agent) of the device.
			No IP address is stored. A session ends 7 days after you last used the app. Signing out or
			deleting your account removes it.
		</li>
	</ul>

	<h2>What you put in builds</h2>
	<ul>
		<li>
			Builds hold names, notes, status, print logs and settings. Who the chair is for and which
			hospital or clinic are optional free-text fields, and the handoff record has a recipient name,
			an organization and a contact field. <b>Please don't enter a child's personal details</b>:
			leave them blank or use a label such as "Chair 7".
		</li>
		<li>
			Photos are stored on the server. Location and camera details (EXIF, XMP, IPTC and comments)
			are removed from them when they are stored. Please don't photograph a child's face unless
			their guardian agrees.
		</li>
		<li>
			A slicer file (3MF) you upload is read and then deleted. What stays is a summary (including
			the file name) and the plate preview images.
		</li>
		<li>
			The activity history records what was done, when, and by whom. Each build keeps its newest
			5000 entries; older ones are removed as new ones arrive.
		</li>
	</ul>

	<h2>Who can see what</h2>
	<ul>
		<li>"My builds" is yours alone. It cannot be shared or take invitations.</li>
		<li>
			People in a chapter can see each other's name and email address, and the chapter's builds,
			photos and activity. Their role (owner, editor or viewer) decides who can change things.
		</li>
		<li>
			Invitations are links you copy and send yourself. The app sends no email. The invited person's
			email address is stored with the invitation. Cancelled, declined and expired invitations
			beyond the newest 50 in a chapter are deleted when a new one is created; accepted ones are
			kept, and deleting an account removes invitations sent by or addressed to it.
		</li>
	</ul>

	{#if data.publicMode}
		<h2>Printers</h2>
		<p>
			Printer and Spoolman connections are switched off on the public instance, so no printer
			details are stored here.
		</p>
	{:else}
		<h2>Printers and integrations</h2>
		<p>
			If you add a printer, the app stores its name and address. Access codes, API keys and serial
			numbers (and an OctoEverywhere share link) are stored encrypted and are never sent back to
			your browser. The server connects to the address you enter, and only reads status; the same
			goes for Spoolman.
		</p>
	{/if}

	<h2>What leaves the server</h2>
	<ul>
		<li>
			Nothing goes to analytics or advertising services: the app has none. Pages load their code,
			fonts and images only from the app's own address, and the page security policy enforces it.
		</li>
		<li>No email is sent.</li>
		{#if data.publicMode}
			<li>Google or GitHub learn that you signed in, because you use them to do it.</li>
		{:else}
			<li>
				If the operator set up single sign-on, that provider learns that you signed in. Printer and
				Spoolman connections go to the addresses you set up.
			</li>
		{/if}
		<li>
			The links to MakeGood, GitHub and the build guide are plain links; nothing is sent until you
			click one.
		</li>
	</ul>

	<h2>On your device</h2>
	<ul>
		<li>
			Local storage keeps small display choices on this device, such as collapsed panels, recently
			used colors, preferred filament brands and the export format.
		</li>
		<li>
			A service worker caches the app's own code, fonts, icons and 3D model files so the app opens
			quickly and shows an offline page. It does not cache your data. Signing out deletes the 3D
			model files it cached on this device. Your browser may also keep photos you opened in its
			normal cache.
		</li>
	</ul>

	<h2>Export and delete</h2>
	<p>
		{#if data.signedIn}
			On <a href={resolve('/(app)/account')}>your account page</a>
		{:else}
			On the account page, once you are signed in,
		{/if}
		you can download your data as one JSON file (your profile, chapters, saved designs and the builds
		in My builds; photos by file name only; chapter builds are not included) and delete your account.
		Deleting removes your sign-in and everything in My builds, including photos, drafts, saved designs
		and custom filaments, and your drafts in chapters. Builds you made in a chapter stay with the chapter,
		and their activity shows "Someone" instead of your name. A chapter where you are the only member is
		deleted with you. You cannot delete your account while you are the only owner of a chapter that has
		other members, or if you are the last site admin or the only account on the server.
	</p>
	<p>
		Backups are made and kept by the operator, not by the app, so a deleted account can still be in
		an older backup.
	</p>

	<h2>Questions</h2>
	<p>
		{#if data.publicMode}
			Open an issue on <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">GitHub</a>.
			Please leave out personal details.
		{:else}
			Ask the operator of this server. For questions about the software itself, open an issue on
			<a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">GitHub</a>, without personal
			details.
		{/if}
	</p>
</LegalPage>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
