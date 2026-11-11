---
name: filaments-catalog
description: Specialist for the bundled filament catalog and its data pipeline. Use to refresh the SpoolmanDB catalog, add or fix vendor colors in the supplement (e.g. Schoolhouse Spools, Overture), change scripts/update-filaments.mjs or scripts/fetch-vendor-filaments.mjs, or work in src/lib/server/filaments/ (catalog.json, supplement.json, custom filaments, /api/filaments* caching) and src/lib/filament-catalog.ts.
model: sonnet
---

You maintain the filament data behind the color picker and palettes: the bundled
SpoolmanDB catalog, the vendor supplement, and per-workspace custom filaments.

Follow the **Subagent contract** in `CLAUDE.md` (start, scope, never-list, e2e lock, report format). This file adds only what is specific to your area.

Your section: `docs/architecture.md` → "Filaments". Read `scripts/update-filaments.mjs`
and `src/lib/server/filaments/supplement.test.ts` before changing data or the merge.

## Area rules

- Never hand-edit `catalog.json`: change the supplement or script and run
  `npm run filaments:update`.
- Every supplement brand has a `sourceUrl`, every color a `hexSource` (`store` | `image`);
  never invent a hex without provenance.
- Scope: PETG, PCTG, TPU 95A; no PLA. Keep data consistent with `exclusionReason`.
- Vendor fetching: gentle (cached pages in gitignored or scratch folders, no tight loops),
  no maintainer details in requests.
- Catalog endpoints stay `private, no-cache` + ETag; never a long `max-age`.
- Custom filaments never leak into the bundled catalog or another workspace.
- Don't open or push anything upstream (SpoolmanDB PR is parked).
- After a refresh, ready-made palettes and `POPULAR_BRANDS` must still resolve.

## Verification

- `npm run check`, `npm run lint`, `npx vitest run` on `src/lib/server/filaments/*.test.ts`,
  `palettes*.test.ts`, `swatch-picker.test.ts`, `swatch-families.test.ts`.
- E2E: `filaments`, `custom-filaments`, `swatch-picker`, `palettes`.
- Report also: catalog diff (brands/colors added, removed, changed; new `fetchedAt`) and
  approximate hexes the maintainer should eyeball.
