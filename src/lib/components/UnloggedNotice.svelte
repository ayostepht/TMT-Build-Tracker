<script lang="ts">
	import { resolve } from '$app/paths';
	import { unloggedEndedJobs, unloggedNotice, type PrinterJobView } from '#lib/printers/status.ts';

	/**
	 * "Plate 9 has an unlogged failed print from 12:22 AM. Log it first so its time and filament
	 * count." A finished print of the same plate/parts that nobody logged yet: said, never blocking.
	 * Derived from the printer store's jobs, so it goes away as soon as that print is logged or
	 * dismissed. Renders nothing otherwise. Used before linking (`ExpectedConfirm`) and after
	 * (`PrinterJobs`, the Printers page).
	 */
	let {
		jobs,
		buildId,
		plateNumber,
		partSlugs,
		exceptJobId,
		testid,
		linked = false
	}: {
		jobs: PrinterJobView[];
		buildId: string;
		plateNumber: number;
		partSlugs?: string[] | null;
		/** The job being linked or already linked: it is not its own earlier print. */
		exceptJobId?: string;
		/** Test id of the notice; the pill-link gets `<testid>-open`. */
		testid: string;
		/** The job is already linked: the sentence says "Log it" instead of "Log it first". */
		linked?: boolean;
	} = $props();

	const unlogged = $derived(
		unloggedEndedJobs(jobs, buildId, plateNumber, partSlugs, exceptJobId)[0]
	);
	const note = $derived.by(() => {
		if (!unlogged) return '';
		const at = unlogged.finishedAt ?? unlogged.startedAt;
		const time = at
			? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
			: '';
		return unloggedNotice(unlogged, time);
	});
	/** Take the user to that job's "Confirm print log" when it is on this page, else to the build. */
	function showLog(e: MouseEvent) {
		const box = unlogged && document.getElementById(`confirm-log-${unlogged.id}`);
		if (!box) return;
		e.preventDefault();
		box.scrollIntoView({ block: 'center' });
		box.focus({ preventScroll: true });
	}
</script>

{#if unlogged}
	<p class="unlogged" data-testid={testid}>
		{note}
		{linked
			? 'Log it so its time and filament count.'
			: 'Log it first so its time and filament count.'}
		<a
			class="pill-link"
			href={resolve('/(app)/builds/[id]', { id: buildId })}
			data-testid="{testid}-open"
			onclick={showLog}>Open print log</a
		>
	</p>
{/if}

<style>
	.unlogged {
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--line);
		border-left: 4px solid var(--warn);
		border-radius: var(--r-md);
		background: var(--card);
		font-size: var(--fs-sm);
		overflow-wrap: anywhere;
	}
</style>
