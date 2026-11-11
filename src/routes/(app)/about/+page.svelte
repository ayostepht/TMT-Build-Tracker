<script lang="ts">
	import { resolve } from '$app/paths';
	import { MAKEGOOD_GUIDE_URL, MAKEGOOD_MODEL_URL } from '#lib/makegood.ts';
	import { APP_VERSION as version } from '#lib/version.ts';

	const REPO_URL = 'https://github.com/ayostepht/TMT-Build-Tracker';
	const ISSUES_URL = `${REPO_URL}/issues`;
</script>

<svelte:head><title>About · TMT Build Tracker</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<article class="about-page">
	<header class="about-intro">
		<div class="kicker">About</div>
		<h1>TMT Build Tracker</h1>
		<p class="muted">
			Version <span data-testid="app-version">{version}</span>. A self-hosted, open-source app for
			makers who 3D-print MakeGood's toddler mobility trainer: plan, print, assemble and hand off
			each chair with your chapter.
		</p>
	</header>

	<section class="ds-card" aria-labelledby="a-credit">
		<h2 id="a-credit">Credit to MakeGood</h2>
		<p>
			The chair is the <b>MakeGood 3D TMT</b> (toddler mobility trainer), designed by MakeGood and released
			under CC0. The model and print files in this app are theirs; this app only helps you organize the
			build. Thank you, MakeGood.
		</p>
		<div class="about-actions">
			<a class="btn" href={MAKEGOOD_MODEL_URL} target="_blank" rel="noopener noreferrer"
				>MakeGood on MakerWorld</a
			>
			<a class="btn" href={MAKEGOOD_GUIDE_URL} target="_blank" rel="noopener noreferrer"
				>MakeGood's maker guide</a
			>
		</div>
		<p class="muted">
			The maker guide is a PDF on Google Drive. It is not part of this app: the Finish tab only
			names its page numbers and links to it.
		</p>
	</section>

	<section class="ds-card" aria-labelledby="a-license">
		<h2 id="a-license">License and third-party data</h2>
		<p>
			The Build Tracker is open source under the MIT license. The filament list is derived from
			SpoolmanDB (MIT) plus factual color data from vendor product pages. Other open-source
			libraries ship with the app under their own licenses. The notices are in
			<a href="{REPO_URL}/blob/main/THIRD_PARTY.md" target="_blank" rel="noopener noreferrer"
				>THIRD_PARTY.md</a
			>
			and the license text is in
			<a href="{REPO_URL}/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">LICENSE</a>.
		</p>
	</section>

	<section class="ds-card" aria-labelledby="a-feedback">
		<h2 id="a-feedback">Feedback</h2>
		<p>Found a bug or have an idea? Tell us on GitHub. Please leave out personal details.</p>
		<div class="about-actions">
			<a
				class="btn primary"
				href={ISSUES_URL}
				target="_blank"
				rel="noopener noreferrer"
				data-testid="feedback-link">Send feedback</a
			>
			<a class="btn" href={resolve('/(app)/help')}>Help</a>
		</div>
	</section>

	<p class="muted">
		How your data is handled and the rules of use:
		<a href={resolve('/privacy')} data-testid="privacy-link">Privacy</a> and
		<a href={resolve('/terms')} data-testid="terms-link">Terms</a>.
	</p>
</article>

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.about-page {
		display: grid;
		gap: var(--sp-9);
		max-width: 44rem;
		min-width: 0;
		margin-inline: auto;
		width: 100%;
	}
	.about-intro {
		display: grid;
		gap: var(--sp-4);
	}
	.about-page h2 {
		margin: 0;
	}
	.about-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}
</style>
