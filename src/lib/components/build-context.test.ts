import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeView } from '#lib/domain/fixtures.ts';

const api = vi.hoisted(() => ({
	getView: vi.fn(),
	printing: vi.fn(),
	setPartStatus: vi.fn()
}));
vi.mock('#lib/client/api.ts', () => api);

import { BuildCtx } from './build-context.svelte.ts';
import { toasts } from './toast.svelte.ts';

const slugOf = (v: ReturnType<typeof makeView>) => v.parts[0].slug;

describe('BuildCtx optimistic actions', () => {
	let ctx: BuildCtx;
	let slug: string;
	beforeEach(() => {
		const view = makeView();
		slug = slugOf(view);
		ctx = new BuildCtx(view);
		toasts.items = [];
		api.getView.mockReset().mockImplementation(async () => makeView());
		api.printing.mockReset().mockResolvedValue({});
		api.setPartStatus.mockReset().mockResolvedValue({});
	});

	it('updates the view before the server answers, then lets the re-fetched view replace it', async () => {
		let release!: () => void;
		api.setPartStatus.mockImplementation(() => new Promise<void>((r) => (release = r)));
		api.getView.mockImplementation(async () => {
			const v = makeView();
			v.state[slug] = { ...v.state[slug], status: 'Printed', printedOn: '2026-01-02' };
			return v;
		});
		const done = ctx.setPartStatus(slug, 'Printed');
		expect(ctx.view.state[slug].status).toBe('Printed'); // before the call returns
		release();
		expect(await done).toBe(true);
		expect(ctx.view.state[slug].printedOn).toBe('2026-01-02'); // server's copy wins
	});

	it('rolls back and shows the server sentence when the call fails', async () => {
		api.setPartStatus.mockRejectedValue(new Error('You can only view this build.'));
		let during: string | undefined;
		api.getView.mockImplementation(async () => {
			during = ctx.view.state[slug].status; // rollback happens before the re-fetch
			return makeView();
		});
		expect(await ctx.setPartStatus(slug, 'Printed')).toBe(false);
		expect(during).toBe('To print');
		expect(ctx.view.state[slug].status).toBe('To print');
		expect(ctx.error).toBe('You can only view this build.');
		expect(toasts.items).toHaveLength(0);
	});

	it('offers Undo that restores the previous status', async () => {
		api.getView.mockImplementation(async () => ctx.view);
		await ctx.setPartStatus(slug, 'Printed');
		expect(toasts.items).toHaveLength(1);
		const t = toasts.items[0];
		expect(t.action?.label).toBe('Undo');
		await t.action!.run();
		expect(api.setPartStatus).toHaveBeenLastCalledWith(ctx.id, slug, 'To print');
		expect(ctx.view.state[slug].status).toBe('To print');
	});

	it('Take off printer is optimistic and Undo puts the start time back', async () => {
		const started = '2026-01-01T08:00:00.000Z';
		ctx.view = {
			...ctx.view,
			state: {
				...ctx.view.state,
				[slug]: { ...ctx.view.state[slug], status: 'Printing', startedAt: started }
			}
		};
		api.getView.mockImplementation(async () => ctx.view);
		expect(await ctx.takeOffParts([slug], 'plate 1')).toBe(true);
		expect(ctx.view.state[slug].status).toBe('To print');
		await toasts.items[0].action!.run();
		expect(ctx.view.state[slug].status).toBe('Printing');
		expect(api.printing).toHaveBeenCalledWith(ctx.id, {
			action: 'setStart',
			slugs: [slug],
			when: started
		});
	});

	it('does nothing (and offers no Undo) when the domain rules predict no change', async () => {
		expect(await ctx.setPartStatus(slug, 'To print')).toBe(true);
		expect(api.setPartStatus).not.toHaveBeenCalled();
		expect(toasts.items).toHaveLength(0);
	});
});
