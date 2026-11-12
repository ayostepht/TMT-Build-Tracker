<script lang="ts">
	import { resolve } from '$app/paths';
	import { MAKEGOOD_GUIDE_URL, MAKEGOOD_MODEL_URL } from '#lib/makegood.ts';

	const SECTIONS = [
		{ id: 'getting-started', label: 'Getting started' },
		{ id: 'printing-day', label: 'Printing day' },
		{ id: 'glossary', label: 'Glossary' },
		{ id: 'faq', label: 'FAQ' }
	];
</script>

<svelte:head><title>Help · TMT Build Tracker</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<article class="help-page">
	<header class="help-intro">
		<div class="kicker">Help</div>
		<h1>How the Build Tracker works</h1>
		<p class="muted">
			Plan, print, assemble and hand off a MakeGood 3D TMT chair with your chapter. For the printing
			steps, the chair guide from MakeGood is still the reference.
		</p>
		<nav class="help-jump" aria-label="On this page" data-testid="help-nav">
			{#each SECTIONS as s (s.id)}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="pill-link" href="#{s.id}">{s.label}</a>
			{/each}
		</nav>
	</header>

	<section class="ds-card help-section" id="getting-started" aria-labelledby="h-start">
		<h2 id="h-start">Getting started</h2>
		<ol class="help-steps">
			<li>
				<b>Pick where the build lives.</b> You always have <b>My builds</b>, a personal workspace
				for you alone. To build with others, press <b>Create a chapter</b> in the top bar or accept an
				invitation. A chapter shares its builds, members and printers.
			</li>
			<li>
				<b>Start a new build.</b> Choose <b>New build</b> in the Builds menu, give it a name
				(recipient and hospital are optional) and press <b>Create build</b>.
			</li>
			<li>
				<b>Walk through the setup wizard.</b> Five steps: <b>Template</b> (the kit files),
				<b>Options</b>, <b>Colors</b>, <b>Files</b> (choose your printer; the export needs its bed
				size and filament slots) and <b>Export</b>. You can come back later with
				<b>Open the setup steps</b>
				in the Settings tab.
			</li>
			<li>
				<b>Fine-tune the design.</b> The <b>Design</b> tab has four tabs: <b>Options</b>,
				<b>Colors</b>,
				<b>Palettes</b> and <b>Parts</b>, with a 3D view of the chair.
			</li>
			<li>
				<b>Prepare the files.</b> The <b>Files</b> tab has the printer and bed, the plates, your sliced
				file and the 3MF export.
			</li>
			<li>
				<b>Print and track.</b> The <b>Print</b> tab is where you start plates, log results and
				follow progress. See <a href="#printing-day">Printing day</a> below.
			</li>
			<li>
				<b>Assemble and hand off.</b> The <b>Finish</b> tab has the assembly checklist (with
				MakeGood's guide page numbers), progress photos and the handoff. <b>Mark as handed off</b>
				moves the build to Done, and the <b>Build summary</b> is a printable page.
			</li>
		</ol>
		<p class="muted">
			The tabs of a build are Overview · Design · Print · Files · Finish · Settings. Want to try
			colors first? <b>Studio</b> in the top bar makes drafts you can recolor and export without a build.
		</p>
	</section>

	<section class="ds-card help-section" id="printing-day" aria-labelledby="h-day">
		<h2 id="h-day">Printing day</h2>
		<ol class="help-steps">
			<li>
				<b>Pick the next plate.</b> Open the build's <b>Print</b> tab (or the chapter page, which
				shows
				<b>Now printing</b> and <b>Next up</b>). A plate is one print job on your bed.
			</li>
			<li>
				<b>Start.</b> Tap the plate's status badge (it says <b>To print</b> at first) and choose
				<b>Printing</b>. If a printer is connected, you are asked <b>Where is it printing?</b>: pick
				the printer and the app follows its job, or pick <b>Not on a connected printer</b>. This
				only marks the plate's parts <b>Printing</b> and starts the clock. Start the print at the printer
				itself: the Build Tracker never sends a print to it.
			</li>
			<li>
				<b>Log the result.</b> When the plate comes off, tap its badge and choose <b>Printed</b>.
				Pick
				<b>Success</b>, <b>Failed</b> or <b>Partial</b>, check the finish time, total print time and
				filament used (grams), add notes if you like, and save. The log feeds the history and your
				pace estimate.
			</li>
			<li>
				<b>Failed or partial prints.</b> A <b>Success</b> marks the plate's parts <b>Printed</b>
				(when a plate needs several runs, once all of them are in). A <b>Failed</b> print flags
				unprinted parts <b>Reprint</b>. A <b>Partial</b> print is saved in the history but does not
				mark anything printed or flag it for reprint. The parts keep the status they had (still
				<b>Printing</b> if they were on the printer), so set each part's status by hand. Failed prints
				can leave the grams empty (counted as 0 g).
			</li>
			<li>
				<b>Undo.</b> Logging a print, starting a plate, taking a plate off the printer (choose
				<b>To print</b> on a printing plate; no log is made) and part status changes show a toast
				with <b>Undo</b>. A saved log can be edited or deleted later; part statuses are recomputed
				from the history, unless you tick
				<b>Keep part statuses as they are</b> when deleting.
			</li>
		</ol>
		<h3>Reading the Now printing card</h3>
		<ul class="help-list">
			<li>
				It shows the plate, the parts on it, their color roles, the expected grams and the time. A
				<b>Run 1 of 2</b> badge means the plate has to be printed more than once.
			</li>
			<li>
				The elapsed time counts from the <b>Started</b> time, which you can correct. The expected finish
				is the start time plus the plate's time (your own entry, your slicer's time or the kit's estimate).
				Once you have about 12 hours of successful, timed plate prints in the log, it is adjusted to your
				pace, except for the kit's own profile time. When a printer is following the job, the pace adjustment
				is skipped, and the printer's own time left is shown in its live panel under the card.
			</li>
			<li>
				On the chapter page, <b>Details</b> on a Now printing card opens that build's Print tab.
			</li>
		</ul>
		<h3>Printer badges</h3>
		<p>On the Printers page and on the Now printing card:</p>
		<ul class="help-list">
			<li>
				<b>Idle</b>, <b>Printing</b>, <b>Paused</b> and <b>Finished</b> or <b>Failed</b>: what the
				printer reports.
			</li>
			<li>
				<b>Offline</b> or <b>Error</b>: the app cannot reach the printer or it reports a fault; the
				progress shown may be out of date.
			</li>
			<li>
				<b>Connecting…</b>: waiting for the first answer. <b>Monitoring stopped</b>: this printer is
				switched off in the app.
			</li>
		</ul>
		<p class="muted">Printers are watched, never controlled. See the FAQ.</p>
	</section>

	<section class="ds-card help-section" id="glossary" aria-labelledby="h-gloss">
		<h2 id="h-gloss">Glossary</h2>
		<dl class="help-dl">
			<dt>Template</dt>
			<dd>A printable kit with generic filament roles. It holds no one's colors or progress.</dd>
			<dt>Color design</dt>
			<dd>A mapping of roles to filaments, and of parts to roles. Designs can be shared.</dd>
			<dt>Build</dt>
			<dd>
				One chair a chapter (or you) is making: it snapshots a design and holds all the progress.
			</dd>
			<dt>Chapter</dt>
			<dd>
				A team: members, builds and printers. Your own <b>My builds</b> workspace is a chapter of one.
			</dd>
			<dt>Plate</dt>
			<dd>The parts that print together in one job on your bed.</dd>
			<dt>Run</dt>
			<dd>
				One physical print of a plate, as logged in the history. Some plates need more than one run.
			</dd>
			<dt>Roles: primary, accent, soft, tire</dt>
			<dd>
				The color slots of the kit. A design says which filament fills each: <b>primary</b> and
				<b>accent</b> are the main colors, <b>soft</b> is for the soft parts, <b>tire</b> for the tires.
			</dd>
			<dt>Kit pack</dt>
			<dd>
				The model and print files of the kit, installed on first start. See the FAQ on where the
				files come from.
			</dd>
			<dt>Draft and Studio</dt>
			<dd>
				A draft is a scratch copy of the kit made in <b>Studio</b>: recolor, change options, lay out
				plates and export. Nothing is tracked. When you like it, make it a build.
			</dd>
			<dt>Viewer, editor, owner</dt>
			<dd>
				Roles in a chapter. A <b>viewer</b> can look. An <b>editor</b> can also create and update
				builds and log prints. An <b>owner</b> also manages members, invitations and the chapter.
			</dd>
		</dl>
	</section>

	<section class="ds-card help-section" id="faq" aria-labelledby="h-faq">
		<h2 id="h-faq">FAQ</h2>
		<div class="help-faq">
			<details>
				<summary>Does the app control my printer?</summary>
				<p>
					No. Printers are read-only. The app reads status and progress. The one thing it can send
					is the command that turns the printer's camera on, and only on Elegoo printers. It never
					moves, heats, pauses, stops or starts anything, so you always start a print on the
					printer.
				</p>
			</details>
			<details>
				<summary>Where do the model files come from?</summary>
				<p>
					From MakeGood, who released the design under CC0. The converted model and print files come
					as a kit pack that is installed on the first start of the app. They are not in the source
					code. A site admin can import other kit files in the kit admin. See
					<a href={resolve('/(app)/about')}>About</a> for the credit.
				</p>
			</details>
			<details>
				<summary>Why are parts never rotated onto another face?</summary>
				<p>
					Every part keeps the face-down orientation from its source file. The plate layout may turn
					a part flat on the bed, but never changes which face is down and never stands a part on an
					edge or tilts it. A part that does not fit flat is reported as oversize, with advice.
				</p>
			</details>
			<details>
				<summary>Can I use it without a chapter?</summary>
				<p>
					Yes. <b>My builds</b> is yours from the day you sign up. You can move a build into a chapter
					later. A personal workspace cannot take invitations: create a chapter to build with others.
				</p>
			</details>
			<details>
				<summary>How do invitations work without email?</summary>
				<p>
					The app does not send email. A chapter owner opens the chapter's <b>Members</b>, enters
					the person's email and a role (editor or viewer) and presses <b>Create invite link</b>.
					Copy the link with <b>Copy link</b> and send it yourself. The person opens it, signs in or
					creates an account and presses <b>Accept</b>.
				</p>
			</details>
			<details>
				<summary>How do I install it on a phone?</summary>
				<p>
					Open the app in your phone's browser, then use the browser's menu: <b
						>Add to Home Screen</b
					>
					(Safari on iPhone: the Share button) or <b>Install app</b> (Chrome on Android). It then opens
					full screen like an app. Your administrator's address needs to be https for some phones to offer
					this.
				</p>
			</details>
			<details>
				<summary>Where is the assembly guide?</summary>
				<p>
					The Finish tab's checklist names the pages of MakeGood's maker guide. The guide is not
					part of the app: open it from
					<a href={MAKEGOOD_GUIDE_URL} target="_blank" rel="noopener noreferrer"
						>MakeGood's build guide</a
					>
					(a PDF on Google Drive) or find the design on the
					<a href={MAKEGOOD_MODEL_URL} target="_blank" rel="noopener noreferrer"
						>MakeGood model page</a
					>.
				</p>
			</details>
		</div>
	</section>

	<p class="muted help-foot">
		Something missing? See <a href={resolve('/(app)/about')}>About</a> for the version and where to
		send feedback. How your data is handled and the rules of use:
		<a href={resolve('/privacy')} data-testid="privacy-link">Privacy</a> and
		<a href={resolve('/terms')} data-testid="terms-link">Terms</a>.
	</p>
</article>

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.help-page {
		display: grid;
		gap: var(--sp-9);
		max-width: 52rem;
		min-width: 0;
		margin-inline: auto;
		width: 100%;
	}
	.help-intro {
		display: grid;
		gap: var(--sp-4);
	}
	.help-jump {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
		margin-top: var(--sp-3);
	}
	.help-section {
		/* breathing room when an in-page link scrolls here (the top bar scrolls away) */
		scroll-margin-top: 16px;
		overflow-wrap: anywhere;
	}
	.help-section h2,
	.help-section h3 {
		margin: 0;
	}
	.help-steps,
	.help-list {
		margin: 0;
		padding-left: 1.4em;
		display: grid;
		gap: var(--sp-4);
	}
	.help-dl {
		margin: 0;
		display: grid;
		gap: var(--sp-3);
	}
	.help-dl dt {
		font-weight: 600;
		margin-top: var(--sp-3);
	}
	.help-dl dd {
		margin: 0;
	}
	.help-faq {
		display: grid;
		gap: var(--sp-3);
	}
	.help-faq details {
		border: 1px solid var(--line);
		border-radius: var(--r-md, 8px);
		padding: var(--sp-4) var(--sp-6);
	}
	.help-faq summary {
		cursor: pointer;
		font-weight: 600;
		min-height: 24px;
	}
	.help-faq p {
		margin: var(--sp-3) 0 0;
	}
	.help-foot {
		text-align: center;
	}
</style>
