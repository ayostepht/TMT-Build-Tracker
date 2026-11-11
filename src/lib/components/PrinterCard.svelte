<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		fmtRemaining,
		PRINTER_KIND_INFO,
		type PrinterPublic,
		type PrinterStatus
	} from '#lib/printers/status.ts';

	/**
	 * Live card for one printer: state, progress, file, time left, temps, CANVAS / AMS slots.
	 * `status` overrides the printer's own (used for the connection-test snapshot).
	 */
	let {
		printer,
		status = undefined,
		compact = false,
		actions
	}: {
		printer: Pick<PrinterPublic, 'name' | 'kind' | 'enabled' | 'lastSeenAt' | 'status'> & {
			blocked?: string | null;
		};
		status?: PrinterStatus | null;
		compact?: boolean;
		actions?: Snippet;
	} = $props();

	const s = $derived(status === undefined ? printer.status : status);
	const state = $derived(
		!printer.enabled || printer.blocked ? 'disabled' : (s?.state ?? 'connecting')
	);
	const LABEL: Record<string, string> = {
		idle: 'Idle',
		printing: 'Printing',
		paused: 'Paused',
		done: 'Finished',
		failed: 'Failed',
		offline: 'Offline',
		error: 'Error',
		disabled: 'Monitoring stopped',
		connecting: 'Connecting…'
	};
	const TONE: Record<string, string> = {
		printing: 'ds-badge--run',
		paused: 'ds-badge--warn',
		done: 'ds-badge--ok',
		idle: 'ds-badge--ok',
		failed: 'ds-badge--bad',
		error: 'ds-badge--bad',
		offline: 'ds-badge--bad',
		disabled: 'ds-badge--warn'
	};
	const t = (v: number | undefined) => (v === undefined ? null : `${Math.round(v)}°`);
</script>

<article
	class="pc"
	data-state={state}
	data-testid="printer-card"
	aria-label="{printer.name} status"
>
	<header>
		<div>
			<h3>{printer.name}</h3>
			<span class="kind">{PRINTER_KIND_INFO[printer.kind].label}</span>
		</div>
		<span class="ds-badge ds-badge--sm {TONE[state] ?? ''}" data-testid="printer-state"
			>{LABEL[state]}</span
		>
	</header>

	{#if printer.blocked}
		<p class="msg" data-testid="printer-blocked">{printer.blocked}</p>
	{:else if s && (s.state === 'printing' || s.state === 'paused' || s.state === 'done')}
		<div class="prog" data-testid="printer-progress">
			<div
				class="pc-bar"
				role="progressbar"
				aria-valuenow={s.progress ?? 0}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-label="Print progress"
			>
				<span style="width:{s.progress ?? 0}%;background:var(--accent)"></span>
			</div>
			<b class="num">{s.progress != null ? Math.round(s.progress) : '–'}%</b>
		</div>
		{#if s.fileName}<div class="file" title={s.fileName} data-testid="printer-file">
				{s.fileName}
			</div>{/if}
		<div class="facts">
			{#if s.layer !== undefined && s.totalLayers}<span>Layer {s.layer} / {s.totalLayers}</span
				>{/if}
			{#if s.remainingSec !== undefined && s.state !== 'done'}<span data-testid="printer-left"
					>{fmtRemaining(s.remainingSec)} left</span
				>{/if}
			{#if s.elapsedSec !== undefined}<span>{fmtRemaining(s.elapsedSec)} elapsed</span>{/if}
		</div>
	{:else if s && (s.state === 'offline' || s.state === 'error') && s.message}
		<p class="msg">{s.message}</p>
	{:else if !s && printer.enabled}
		<p class="msg">Waiting for the first status…</p>
	{/if}

	{#if !compact && !printer.blocked && s && s.state !== 'offline'}
		<div class="temps">
			{#if t(s.nozzleC)}<span title="Nozzle">Nozzle {t(s.nozzleC)}</span>{/if}
			{#if t(s.bedC)}<span title="Bed">Bed {t(s.bedC)}</span>{/if}
			{#if t(s.chamberC)}<span title="Chamber">Chamber {t(s.chamberC)}</span>{/if}
		</div>
		{#if s.filaments?.length}
			<div class="slots" aria-label="Filament slots">
				{#each s.filaments as f (f.slot)}
					<span class="slot"
						><i style="background:{f.color ?? 'var(--line)'}"></i>{f.slot}{f.type
							? ` ${f.type}`
							: ''}</span
					>
				{/each}
			</div>
		{/if}
	{/if}
	{#if !s && printer.lastSeenAt && !compact}<p class="msg">
			Last seen {new Date(printer.lastSeenAt).toLocaleString()}
		</p>{/if}
	{#if actions}<footer>{@render actions()}</footer>{/if}
</article>

<style>
	.pc {
		background: var(--card);
		border: 1px solid var(--line);
		border-left: 4px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--sp-7) var(--sp-8);
		display: grid;
		gap: var(--sp-5);
		min-width: 0;
	}
	.pc[data-state='printing'] {
		border-left-color: var(--accent);
	}
	.pc[data-state='paused'] {
		border-left-color: var(--warn);
	}
	.pc[data-state='done'] {
		border-left-color: var(--ok);
	}
	.pc[data-state='failed'],
	.pc[data-state='error'] {
		border-left-color: var(--bad);
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: var(--sp-5);
		align-items: flex-start;
	}
	h3 {
		margin: 0;
		font-size: var(--fs-lg);
		overflow-wrap: anywhere;
	}
	.kind {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.prog {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
	}
	.pc-bar {
		flex: 1;
		height: 10px;
		border-radius: var(--r-md);
		background: var(--line);
		overflow: hidden;
		display: flex;
	}
	.pc-bar span {
		display: block;
		height: 100%;
		transition: width 0.3s;
	}
	@media (prefers-reduced-motion: reduce) {
		.pc-bar span {
			transition: none;
		}
	}
	.file {
		font-family: var(--f-mono);
		font-size: var(--fs-xs);
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.facts,
	.temps,
	.slots {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2) var(--sp-7);
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.slot {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.slot i {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 1px solid var(--line);
		display: inline-block;
	}
	.msg {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	footer {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
</style>
