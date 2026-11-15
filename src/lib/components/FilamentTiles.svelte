<script lang="ts">
	import {
		fmt,
		fmtH,
		fmtSpools,
		filamentStats,
		timeStats,
		timeLeftText,
		stockKg
	} from '#lib/domain/index.ts';
	import { addSpool, removeSpoolAdd } from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import { resolve } from '$app/paths';
	import Swatch from './Swatch.svelte';
	import SpoolRemaining from './SpoolRemaining.svelte';

	const ctx = getBuildCtx();
	const stats = $derived(filamentStats(ctx.view));
	const time = $derived(timeStats(ctx.view));
	const timeDone = $derived(time.totalSec ? (1 - time.leftSec / time.totalSec) * 100 : 0);
	const tl = $derived(timeLeftText(time));
	const r1 = (h: number) => Math.round(h * 10) / 10;
	// Adding stock is for tracked builds only: a Studio draft has no stock.
	const canAdd = $derived(ctx.canEdit && ctx.view.build.kind !== 'draft');

	// Wide screens show every row's numbers in a grid; phones open a row to see its stock.
	let wide = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(min-width: 900px)');
		wide = mq.matches;
		const on = () => (wide = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
	const printUrl = $derived(resolve('/(app)/builds/[id]/print', { id: ctx.id }));
	const settingsUrl = $derived(resolve('/(app)/builds/[id]/settings', { id: ctx.id }));
	const nameOf = (slug: string) => ctx.view.allParts.find((p) => p.slug === slug)?.name ?? slug;
	let openRole = $state<string | null>(null);
	/** Roles whose spool history is open, the role whose add form is open, the add awaiting remove confirmation. */
	let histOpen = $state<Record<string, boolean>>({});
	let formRole = $state<string | null>(null);
	let confirmId = $state<string | null>(null);
	let kg = $state('1');
	let note = $state('');
	let formError = $state('');
	let busy = $state(false);

	function openForm(role: string) {
		formRole = role;
		kg = '1';
		note = '';
		formError = '';
	}
	async function saveAdd(role: string) {
		const v = Math.round((Number(kg) || 0) * 100) / 100;
		if (!(v >= 0.01 && v <= 99)) {
			formError = 'Enter a weight from 0.01 to 99 kg.';
			return;
		}
		busy = true;
		const ok = await ctx.act(() =>
			addSpool(ctx.id, role, { kg: v, note: note.trim() || undefined })
		);
		busy = false;
		if (ok) {
			formRole = null;
			histOpen[role] = true;
		}
	}
	async function removeAdd(role: string, id: string) {
		confirmId = null;
		await ctx.act(() => removeSpoolAdd(ctx.id, role, id));
	}
	const dateOf = (ms: number) =>
		new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
</script>

<section
	class="ft-card ds-card ds-card--compact"
	aria-label="Filament"
	data-testid="filament-tiles"
>
	<div class="ft-cols" aria-hidden="true">
		<span>Filament</span><span>Used</span><span>To print</span><span>Spare</span><span></span><span
			>Spools</span
		>
	</div>
	<ul class="ft-list">
		{#each stats as s (s.role)}
			{@const f = ctx.filament(s.role)}
			{@const spare = s.haveGrams - s.used - s.need}
			{@const scale = Math.max(s.haveGrams, s.used + s.need, 1)}
			{@const isOpen = openRole === s.role}
			{@const more = Math.ceil(-spare / 1000)}
			{@const adds = f?.spoolAdds ?? []}
			{@const hist = !!histOpen[s.role]}
			<li class="ft-row" data-testid="filament-tile" data-role={s.role} class:open={isOpen}>
				{#snippet nameCell()}
					{#if f}<Swatch hex={f.hex} tpu={f.tpu} />{:else}<span></span>{/if}
					<span class="ft-name">{filLabel(f, s.role)}</span>
				{/snippet}
				{#snippet usedCell()}
					<span class="ft-used" data-testid="filament-used"
						>{fmt(s.used)} g{#if s.lostG >= 0.5}<span class="ft-lost" data-testid="filament-lost"
								>{fmt(s.lostG)} g lost</span
							>{/if}</span
					>
				{/snippet}
				{#snippet badge()}
					<span
						class="ds-badge ft-verdict"
						data-testid="filament-spare"
						class:ds-badge--ok={spare >= 0}
						class:ds-badge--bad={spare < 0}
						>{#if spare >= 0}{s.unknownParts.length ? '≤ ' : ''}{fmt(spare)} g spare{:else}short {s
								.unknownParts.length
								? '≥ '
								: ''}{fmt(-spare)} g{/if}</span
					>
				{/snippet}
				{#snippet gap()}
					{#if s.unknownParts.length}
						<span class="ft-gap" data-testid="unknown-weights">
							{s.unknownParts.length}
							{s.unknownParts.length === 1 ? 'part' : 'parts'} without weight, not counted:
							{#each s.unknownParts as slug, i (slug)}{i ? ', ' : ' '}<a
									href="{printUrl}#part-{slug}">{nameOf(slug)}</a
								>{/each}. Add a weight on the Print tab.
						</span>
					{/if}
				{/snippet}
				{#snippet bar()}
					<span
						class="ft-bar"
						role="img"
						aria-label="{fmt(s.keptG)} g kept, {fmt(s.lostG)} g lost, {fmt(
							s.need
						)} g to print, of {fmt(s.haveGrams)} g on hand"
						title="Kept, lost, then still to print, against the filament on hand"
					>
						<span class="kept" style="width:{(s.keptG / scale) * 100}%"></span>
						<span
							class="lostbar"
							style="left:{(s.keptG / scale) * 100}%;width:{(s.lostG / scale) * 100}%"
						></span>
						<span
							class="need"
							style="left:{(s.used / scale) * 100}%;width:{(s.need / scale) * 100}%"
						></span>
						{#if s.haveGrams < scale}<span class="have" style="left:{(s.haveGrams / scale) * 100}%"
							></span>{/if}
					</span>
				{/snippet}
				{#snippet stock()}
					<span class="ft-stock">
						<button
							type="button"
							class="ft-total"
							data-testid="spool-total"
							aria-expanded={hist}
							aria-controls="ft-hist-{s.role}"
							onclick={() => (histOpen[s.role] = !hist)}
						>
							<span class="ft-total-n">{fmtSpools(stockKg(f ?? { spools: 0 }))} kg</span>
							<span class="sr-only"> of spools, show history</span>
							<span class="ft-caret" aria-hidden="true">{hist ? '▴' : '▾'}</span>
						</button>
						{#if canAdd}
							<button
								type="button"
								class="btn sm ft-plus"
								data-testid="spool-add"
								aria-expanded={formRole === s.role}
								aria-label="Add a spool of {filLabel(f, s.role)}"
								onclick={() => (formRole === s.role ? (formRole = null) : openForm(s.role))}
								>+</button
							>
						{/if}
					</span>
				{/snippet}
				{#snippet panel()}
					{#if formRole === s.role && canAdd}
						<form
							class="ft-form"
							data-testid="spool-form"
							onsubmit={(e) => {
								e.preventDefault();
								saveAdd(s.role);
							}}
						>
							<label class="ft-f"
								>Weight (kg)
								<input
									type="number"
									min="0.01"
									max="99"
									step="0.01"
									inputmode="decimal"
									data-testid="spool-kg"
									bind:value={kg}
								/></label
							>
							<label class="ft-f ft-f-note"
								>Note (optional)
								<input
									type="text"
									maxlength="200"
									placeholder="e.g. bought another roll"
									data-testid="spool-note"
									bind:value={note}
								/></label
							>
							<span class="ft-form-btns">
								<button
									type="submit"
									class="btn primary sm"
									data-testid="spool-save"
									disabled={busy}>Save</button
								>
								<button
									type="button"
									class="btn ghost sm"
									data-testid="spool-cancel"
									onclick={() => (formRole = null)}>Cancel</button
								>
							</span>
							{#if formError}<span class="ft-err" role="alert">{formError}</span>{/if}
						</form>
					{/if}
					{#if hist}
						<ul class="ft-hist" id="ft-hist-{s.role}" data-testid="spool-history">
							<li data-testid="spool-start">
								<span class="ft-h-main">Starting spools <b>{fmtSpools(f?.spools ?? 0)} kg</b></span>
								{#if ctx.canEdit}<a class="ft-h-link" href={settingsUrl}>Change in Settings</a>{/if}
							</li>
							{#each adds as a (a.id)}
								<li data-testid="spool-add-row">
									<span class="ft-h-main"
										>Added <b>{fmtSpools(a.kg)} kg</b>
										<span class="ft-h-meta"
											>{dateOf(a.at)}{a.userName ? ` · ${a.userName}` : ''}{a.note
												? ` · ${a.note}`
												: ''}</span
										></span
									>
									{#if canAdd}
										{#if confirmId === a.id}
											<span class="ft-h-confirm" role="group" aria-label="Remove this spool?">
												<span>Remove?</span>
												<button
													type="button"
													class="btn danger sm"
													data-testid="spool-remove-yes"
													onclick={() => removeAdd(s.role, a.id)}>Yes</button
												>
												<button
													type="button"
													class="btn ghost sm"
													data-testid="spool-remove-no"
													onclick={() => (confirmId = null)}>No</button
												>
											</span>
										{:else}
											<button
												type="button"
												class="btn ghost sm"
												data-testid="spool-remove"
												aria-label="Remove the {fmtSpools(a.kg)} kg spool added {dateOf(a.at)}"
												onclick={() => (confirmId = a.id)}>Remove</button
											>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/snippet}
				{#if wide}
					<div class="ft-wide">
						<div class="ft-who">{@render nameCell()}</div>
						<span class="ft-num"><span class="sr-only">Used </span>{@render usedCell()}</span>
						<span class="ft-num"
							><span class="sr-only">To print </span>{s.unknownParts.length ? '≥ ' : ''}{fmt(
								s.need
							)} g</span
						>
						<span class="ft-spare"><span class="sr-only">Spare </span>{@render badge()}</span>
						{@render bar()}
						{@render stock()}
					</div>
					<div class="ft-sub">
						{@render gap()}
						<SpoolRemaining role={s.role} />
						{#if spare < 0}<span class="ft-more">Get {more} more spool{more > 1 ? 's' : ''}.</span
							>{/if}
					</div>
					{#if formRole === s.role || hist}<div class="ft-panel">{@render panel()}</div>{/if}
				{:else}
					<button
						type="button"
						class="ft-head"
						aria-expanded={isOpen}
						aria-controls="ft-edit-{s.role}"
						onclick={() => (openRole = isOpen ? null : s.role)}
					>
						<span class="ft-l1">
							<span class="ft-who">{@render nameCell()}</span>
							{@render badge()}
						</span>
						<span class="ft-l2">
							{@render bar()}
							<span class="ft-mono"
								>{fmt(s.used)} g used{s.lostG >= 0.5 ? ` (${fmt(s.lostG)} g lost)` : ''} · {s
									.unknownParts.length
									? '≥ '
									: ''}{fmt(s.need)} g to print · {fmtSpools(stockKg(f ?? { spools: 0 }))} kg of spools</span
							>
						</span>
						<span class="sr-only">Tap to show spools.</span>
					</button>
					{#if isOpen}
						<div class="ft-edit" id="ft-edit-{s.role}">
							{@render gap()}
							{@render stock()}
							{#if spare < 0}<span class="ft-more">Get {more} more spool{more > 1 ? 's' : ''}.</span
								>{/if}
							<SpoolRemaining role={s.role} />
							<div class="ft-panel ft-panel-m">{@render panel()}</div>
						</div>
					{/if}
				{/if}
			</li>
		{/each}

		<li class="ft-row ft-time" data-testid="filament-tile">
			<div class="ft-timehead">
				<span class="ft-who"
					><span class="clock" aria-hidden="true"></span><span class="ft-name">Print time</span
					></span
				>
				<span class="ft-timeleft"
					><b>{tl.text}</b> left{time.adjustedLeftSec && time.known
						? ' at your pace'
						: ''}{tl.kind === 'estimate'
						? ' (est.)'
						: time.learned
							? ' (from your slice)'
							: ''}</span
				>
			</div>
			<div class="ft-l2">
				<span class="ft-bar" title="Share of estimated print time done">
					<span class="kept" style="width:{timeDone}%;background:var(--ok)"></span>
				</span>
				<span class="ft-mono"
					><span data-testid="time-logged"
						>{r1(time.loggedHours)} h logged ({r1(time.keptHours)} good · {r1(time.lostHours)} failed)</span
					>
					· {#if time.known}~{fmtH(time.totalSec)}{time.estimated ? ' (est.)' : ''} total, about {Math.round(
							time.totalSec / 86400
						)} days nonstop{:else}— total{/if}</span
				>
			</div>
			<div class="ft-note">
				{time.paceRatio
					? `Calibrated: ${time.pace?.text ?? ''}`
					: !time.known
						? 'No time estimate yet. Upload a sliced file to get one.'
						: time.estimated
							? (time.rough ? 'Rough estimate' : 'Estimate') +
								" from MakeGood's X/P/A plate times. Log hours to calibrate."
							: 'Estimates from the template profile. Log hours to calibrate.'}
			</div>
		</li>
	</ul>
</section>

<style>
	.ft-card {
		padding: 0;
		overflow: hidden;
	}
	.ft-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ft-row {
		border-top: 1px solid var(--line);
		min-width: 0;
	}
	.ft-list > .ft-row:first-child {
		border-top: 0;
	}
	.ft-cols {
		display: none;
	}
	.ft-head {
		display: grid;
		gap: 6px;
		width: 100%;
		min-height: 56px;
		padding: 10px var(--sp-5);
		background: none;
		border: 0;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.ft-head:hover {
		background: var(--accent-soft);
	}
	.ft-l1 {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-width: 0;
	}
	.ft-who {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-width: 0;
		flex: 1;
	}
	.ft-name {
		font: 600 var(--fs-base) / 1.15 var(--f-display);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.ft-l2 {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.ft-time .ft-l2 {
		padding: 0 var(--sp-5);
	}
	.ft-mono {
		font: 400 var(--fs-xs) / 1.3 var(--f-mono);
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.ft-bar {
		display: block;
		height: 8px;
		border-radius: var(--r-sm);
		background: var(--line);
		position: relative;
		overflow: hidden;
	}
	.ft-bar .kept {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--muted);
	}
	/* Lost filament is hatched so it never relies on colour alone. */
	.ft-bar .lostbar {
		position: absolute;
		top: 0;
		bottom: 0;
		background: repeating-linear-gradient(
			135deg,
			var(--bad) 0 2px,
			color-mix(in srgb, var(--bad) 25%, transparent) 2px 4px
		);
	}
	.ft-bar .have {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--ink);
	}
	.ft-bar .need {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--accent);
		opacity: 0.45;
	}
	.ft-verdict {
		white-space: nowrap;
		flex: none;
	}
	.ft-edit {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3) var(--sp-5);
		padding: 2px var(--sp-5) 12px;
	}
	.ft-gap {
		font-size: var(--fs-xs);
		line-height: 1.35;
		color: var(--muted);
	}
	.ft-gap a {
		color: var(--ink);
		text-decoration: underline;
	}
	.ft-edit .ft-gap {
		flex-basis: 100%;
	}
	.ft-more {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.ft-time {
		display: grid;
		gap: 6px;
		padding: 10px 0;
	}
	.ft-timehead {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		padding: 0 var(--sp-5);
		min-width: 0;
		flex-wrap: wrap;
	}
	.ft-timeleft {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.ft-timeleft b {
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.ft-note {
		padding: 0 var(--sp-5);
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.ft-sub {
		display: none;
	}
	.ft-used {
		display: grid;
		gap: 1px;
	}
	.ft-lost {
		font-size: var(--fs-xs);
		color: var(--bad);
	}
	.ft-stock {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.ft-total {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 var(--sp-3);
		background: none;
		border: 0;
		border-radius: var(--r-sm);
		font: 500 var(--fs-sm) / 1.2 var(--f-mono);
		color: inherit;
		cursor: pointer;
	}
	.ft-total:hover {
		background: var(--accent-soft);
	}
	.ft-plus {
		min-width: 44px;
		min-height: 44px;
		font-size: var(--fs-lg, 1.25rem);
		line-height: 1;
	}
	.ft-panel {
		padding: 0 var(--sp-6) 12px;
		display: grid;
		gap: var(--sp-4);
	}
	.ft-panel-m {
		flex-basis: 100%;
		padding: 0;
	}
	.ft-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--sp-4);
	}
	.ft-f {
		display: grid;
		gap: 4px;
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.ft-f input {
		min-height: 44px;
		width: 9ch;
	}
	.ft-f-note {
		flex: 1 1 200px;
	}
	.ft-f-note input {
		width: 100%;
	}
	.ft-form-btns {
		display: inline-flex;
		gap: var(--sp-3);
	}
	.ft-form-btns .btn,
	.ft-hist .btn {
		min-height: 44px;
	}
	.ft-err {
		flex-basis: 100%;
		color: var(--bad);
		font-size: var(--fs-sm);
	}
	.ft-hist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
		font-size: var(--fs-sm);
	}
	.ft-hist li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		padding: 2px 0;
		border-top: 1px solid var(--line);
		min-width: 0;
	}
	.ft-hist li:first-child {
		border-top: 0;
	}
	.ft-h-main {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.ft-h-meta {
		display: block;
		color: var(--muted);
		font-size: var(--fs-xs);
	}
	.ft-h-confirm {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.ft-h-link {
		color: var(--ink);
		text-decoration: underline;
		font-size: var(--fs-xs);
	}

	@media (min-width: 900px) {
		.ft-cols,
		.ft-wide {
			display: grid;
			grid-template-columns: minmax(0, 1.5fr) 110px 90px 120px minmax(80px, 1fr) 150px;
			align-items: center;
			gap: var(--sp-5);
			padding: 8px var(--sp-6);
		}
		.ft-cols {
			border-bottom: 1px solid var(--line);
			font: 600 var(--fs-xs) / 1 var(--f-body);
			color: var(--muted);
			text-transform: uppercase;
			letter-spacing: 0.06em;
		}
		.ft-wide {
			min-height: 48px;
		}
		.ft-num {
			font: 500 var(--fs-sm) / 1.2 var(--f-mono);
			font-variant-numeric: tabular-nums;
		}
		.ft-spare {
			justify-self: start;
		}
		.ft-wide .ft-stock {
			justify-self: end;
		}
		.ft-wide .ft-total {
			min-width: 9ch;
			justify-content: flex-end;
		}
		.ft-sub:has(> *) {
			display: flex;
			gap: var(--sp-5);
			padding: 0 var(--sp-6) 6px;
			margin-top: -4px;
		}
		.ft-time {
			padding: 10px var(--sp-6);
		}
		.ft-timehead,
		.ft-time .ft-l2,
		.ft-note {
			padding-inline: 0;
		}
	}
</style>
