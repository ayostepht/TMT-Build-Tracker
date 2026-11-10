# Design studio UX audit (TMT Build Tracker)

> Snapshot of the 2026-11-09 audit (before r31). Line numbers and screenshots refer to that state; most findings
> are implemented (see STATUS "Design studio redesign and mobile fixes"). Open: M6 Options placement, L1-L4 a11y.

Reviewed 2026-11-09 against the current source (r28). Seeded app run in a throwaway container with the real MakeGood kit pack (real 3D model). No repo files changed. Screenshots sit beside this file (names below).

## Verdict

The design studio is better than "so long" suggests on its default tab, and worse on the tabs people actually use to choose colors. The **Slots** tab is a fine 2.5 phone screens. The **Palettes** tab is 8.3 phone screens (7,013 px) and **Parts** is 5.9 (5,009 px) because everything is a stack of full cards: 4 large generator tiles, 6 variation cards, 13 ready-made cards, a 90-row parts list, each with its own Preview/Apply buttons. The real UX failures are structural, not just length: (1) on phones the 3D chair is not sticky, so scroll down to a palette, press Preview, and the chair (and the "Previewing" banner) is off-screen; (2) the desktop layout is already side-by-side with a sticky 3D view, but it is capped at ~1050 px wide, so 1920 px screens waste 45% of the width and the stage is clipped at 1440x900; (3) after you apply a palette the slot identities "Primary / Accent" disappear and are replaced by long filament names, so you can no longer tell which slot is which; (4) the setup-wizard Colors step already has the right pattern (fixed-height two-pane, panel scrolls on its own, 961 px total) but the real Design tab does not use it. "Save as design" is a share/snapshot feature but reads like the "save" step of the flow, though edits already autosave. The recommended fix is mostly re-using what the wizard embedded layout does, collapsing palettes into a compact picker, and fixing the phone stage.

## Page-length measurements (document scrollHeight, build Design tab, 4 slots, real model)

| Viewport           | Tab                      | Height px                  | Screens         | Notes                                                                                                             |
| ------------------ | ------------------------ | -------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| 390x844 phone      | Slots                    | 2,119                      | 2.5             | stage starts at y=464 (header+tabs eat 55% of first screen)                                                       |
| 390                | Palettes                 | 7,013                      | 8.3             | generator at 1,197 (1.4 screens), variations at 2,057 (2.4), ready-made starts ~4,000 (4.7), Save at ~6,500 (7.7) |
| 390                | Parts                    | 5,009                      | 5.9             | with a part selected: 5,484 (6.5)                                                                                 |
| 1440x900           | Slots                    | 1,392                      | 1.5             | stage top y=265, height 648, bottom 913 (below the 900 fold)                                                      |
| 1440               | Palettes                 | 5,766                      | 6.4             | generator at 499; variations 1,263; ready-made ~2,550; stage stays sticky                                         |
| 1440               | Parts                    | 4,169                      | 4.6             | with a part selected: 4,560                                                                                       |
| 1920x1080          | Slots / Palettes / Parts | 1,392 / 5,766 / 4,169      | 1.3 / 5.3 / 3.9 | identical heights to 1440: extra space not used                                                                   |
| 1440 @1.5 scale    | same as 1440             | 1,392 / 5,766 / 4,169      |                 | CSS px identical; layout holds, text fine                                                                         |
| Draft Design tab   | Slots                    | 1,362 (1440) / 2,078 (390) | 1.5 / 2.5       | same workspace                                                                                                    |
| Wizard Colors step | Slots                    | 961 (1440) / 2,023 (390)   | 1.1 / 2.4       | desktop: fixed-height panes, no page scroll                                                                       |
| /studio            |                          | 900 (1440) / 863 (390)     | 1.0             |                                                                                                                   |
| /designs gallery   |                          | 900 / 1,667                |                 |                                                                                                                   |
| /designs/[slug]    |                          | 1,489 (1440) / 2,120 (390) |                 |                                                                                                                   |

Light and dark heights are identical (no overflow either way).

## Current structure map (build Design tab, top to bottom)

Phone (390): site nav (~190) · back link · build header with name, DESIGN badge, Live, 2 stat lines, progress bar (~270) · tab bar Overview/Design/Print/Files/Finish/Settings (~50) → **3D stage 464** (y 464) · "Tap a part…" hint (~30) · sticky tab bar Slots/Palettes/Parts · then the tab content · **Save as design card (~300, always at the very bottom, under every tab)** · "Next: files and export".

- Slots tab: Colors header + 4 slot cards (~135 each) + Add a color (~40).
- Palettes tab: title + Prefer brand dropdown · 5-line intro · generator card (~810 phone / 715 desktop: 4 slot tiles each with swatch button, color input, hex input, clear, "Use current"; 12 quick swatches; 7 theme chips) · Variations (6 cards, +More) · Ready-made (13 cards).
- Parts tab: Parts search + sections (Seat, Frame, …) with one row per part (~33 parts) · Options (variants) card at the bottom.
- When a part is selected a Part sheet (~250 desktop, ~460 phone) is inserted above the tabs and pushes everything down.
- Swatch picker: fixed overlay. Phone: bottom sheet 46vh (388 px). Desktop: right drawer 420x594 covering the slot list.

Desktop (1440): header ~265 px → two columns (stage 1.25fr sticky, panel 1fr). Same panel order as above.

Other surfaces: Studio page (new-draft form, draft cards, "Shared designs" card with one button), Designs gallery (cards with a thumbnail, filament list), Design detail (3D + filament list with every part name + "Start a build" form), Wizard step 3 (embedded designer + "Start from a saved or shared design" select).

## Findings

### Critical

**C1. On phones the 3D chair scrolls away, so Preview/Apply/pick give no visible feedback.** The stage is not sticky below 900 px. In the Palettes tab you scroll ~4,000 px to the ready-made list, tap Preview and the model that should change is two-plus screens above. The "Previewing X. Not saved yet." banner is also under the stage, off-screen. Same on Parts: selecting a row scrolls the Part sheet into view (`pick()` scrollIntoView, DesignWorkspace.svelte:141-148) and not the model, so the highlighted part is off-screen. Evidence: `st-390-light-palette-preview.png` (no chair visible while "Stop preview" shown), `st-390-light-part-selected-fold.png`. Code: `.stagebox` plain block on phones (DesignWorkspace.svelte:351-354; sticky only in the 900px media query :420-430). Fix: pin a compact stage (see layout below: ~30vh sticky mini-viewer or a bottom-docked mini preview) while the panel scrolls; move the preview banner into the pinned region; on Preview auto-scroll nothing, just keep the chair visible.

**C2. Palettes tab is a 7,000 px (8 screens) scroll of near-identical cards.** 6 variation cards + 13 ready-made, each ~190 px with 4 name rows and two buttons, preceded by a 810 px generator. Users must scroll to compare and re-scroll to apply. Evidence: `390-light-palettes-full.png`, `1440-light-palettes-full.png`. Code: PalettePanel.svelte:305-361 (lists), card snippet :408-471. Fix: compact palette rows (4 color dots + name, one tap = live preview in 3D, one Apply in a sticky action bar), generator collapsed behind "Make your own", variations as a horizontal chip/carousel rather than 6 tall cards; target the whole tab under ~2 screens on phone (details in the redesign).

### High

**H1. After applying a palette or picking a filament, slot identity is lost.** Slots are named by filament ("PETG Kingroon Porcelain Blue") instead of Primary/Accent; the Part sheet says "In slot Polymaker PolyLite™ PETG Polymaker Teal"; the part list shows the long name in every row; the picker title becomes "Change Polymaker PolyLite™ PETG Polym…" (truncated). The user can no longer tell primary from accent, or recognize the TPU "Primary/Accent" roles. Evidence: `st-1440-light-save-done.png`, `st-1440-light-part-selected-fold.png`, `st-1440-light-picker-open.png`. Code: `filamentLabel(f, f.key)` used in SlotPanel.svelte:~70/80, PartSheet.svelte:~42/74, PartList.svelte:67; title `Change {pickerSlot.name}` DesignWorkspace.svelte:322. Fix: show a fixed role label as the primary text ("Primary PETG", "Accent TPU", matching the kit's role names) with the chosen filament name as the secondary line; never use the filament name as the heading. (Mind "existing builds keep their own role names" decision in STATUS r26: needs a role-label field distinct from the filament name; see product decisions.)

**H2. Desktop width is capped (~1050 px), so 1440 clips the stage and 1920 wastes ~860 px.** Evidence: `1920-light-slots-fold.png` (content is a centered column with 430 px empty gutters each side), `1440-light-slots-fold.png` (stage bottom at 913 > 900: the "Reset view" button and credit sit below the fold; the build header (stats, progress bar, ~265 px) pushes the workspace down). The page uses the global site container, not a work-area layout. The wizard embedded mode fills the viewport height; the build tab does not. Fix: on the Design tab only, widen the container (~1500-1700), hide/compress the build header stats here, and use the wizard's fixed-viewport two-pane pattern (stage fills left, panel scrolls on its own) so the stage never scrolls away or clips.

**H3. The Part sheet pushes the whole panel down (layout shift) and on phones takes ~460 px.** Selecting a part inserts a card above the tab bar; the tabs, list and Save shift. On phone it covers one full screen before the list resumes. Evidence: `st-390-light-part-selected-fold.png`, `st-1440-light-part-selected-fold.png`. Code: DesignWorkspace.svelte:236-248 + PartSheet.svelte. Fix: show the part as a floating chip/popover on the stage ("Wing Left · Accent PETG ▾") with slot buttons as a compact row of 4 round swatches; or a bottom sheet on phone that does not move the content; keep one row of slot swatches + "Both sides" toggle.

**H4. The swatch picker covers the very things you are comparing.** Phone: bottom sheet 388 px (46vh) over the lower half, and `openPicker()` scrolls the stage up to the top so the chair is ~half visible (`st-390-light-picker-open.png`). Desktop: a 420x594 right drawer sits over the slot list and the Palettes tab, so the slot you are editing is hidden under it. First thing in the sheet is "My filaments 0" + "Your own brand…" explainer and "Show all types (276 hidden: silk, matte…)" before any swatch; the first swatches are 84 pale neutrals, so a user wanting "red" must scroll past them. 425 buttons in the sheet. Code: SwatchPicker.svelte:556-580, 838+ (media), neutrals first via `pickerSwatches`. Fix: color families row (Reds, Blues, …) up top or color-first ordering with neutrals collapsed; hide "My filaments" until the user has some (show a small "+ Add filament" link); keep the drawer but make it non-overlapping (push the panel) on wide screens; sheet title should be the slot role ("Accent PETG color"), not the current filament.

**H5. "Save as design" misleads and is far from the flow.** Edits already autosave, but a card titled "Save as design" at the bottom of the page (after 13 palettes) looks like the commit step. Its real purpose is sharing/reuse. It is always rendered after whichever tab is open, so on Palettes it is 6,500 px down. After saving, the toast "Applied Ocean · Undo" can overlap the saved confirmation (`st-1440-light-save-done.png`). Also there is no way on the Design tab to _apply_ a saved/shared design to this build (the wizard has "Start from a saved or shared design… / Use design"; the tab does not). Fix: rename "Share or save as design…", put it behind a header button that opens a sheet/dialog, plus a "Saved designs" entry in the same header; show an explicit "All changes saved" status near the title.

**H6. Three tabs mix two different jobs and the default hides the main one.** "Slots" (review + per-slot filament), "Palettes" (generate/choose whole schemes), "Parts" (per-part reassign) are good names, but "Parts" really is an advanced tool. Meanwhile the main task, "make it look right", needs palette + slot + 3D together. The tab bar is `position: sticky` but the part hint line is above it, so the sticky tab bar sits under the global nav only on some scroll positions. Evidence: tab bar at `1440-light-slots-fold.png` vs sticky in later shots. Fix: see redesign (Colors / Parts as the two top-level modes; Palettes becomes a sheet launched from Colors).

### Medium

**M1. Generator tiles are too heavy and hard to read.** Four 130 px tiles (swatch button, native color picker, hex text box, clear ×, "Use current") each with dashed "Auto" state; 12 anonymous quick swatches (26x26 px, aria-label "Color #e53935" only), theme chips with jargon "Complementary / Analogous / Triadic / Monochrome / High contrast / Soft". Phone: 810 px before any result. "Soft" is also a slot nickname in code, confusing. Evidence: `st-390-light-generator.png`. Code: PalettePanel.svelte:305-361, 680-760 styles. Fix: start with one "Start from a color" row (swatch + quick colors); reveal per-slot lock tiles via "Lock more slots"; plain-language theme labels with a tiny swatch preview.

**M2. Naming is inconsistent for the same four slots.** Slots tab: "Primary TPU / Accent TPU"; Palettes: "Primary (TPU) / Accent (TPU)"; part rows: "Primary TPU". Plain "Primary" in the generator = Primary PETG. Wording of the brand control: "Prefer brand: Any brand" is jargon for a filtering preference and sits in the palette header only. Code: palettes.ts:43 `SLOT_LABEL`, labels.ts `filamentLabel`. Fix: one label table, used everywhere ("Primary (PETG)", "Accent (PETG)", "Primary (TPU)", "Accent (TPU)").

**M3. Preview vs Apply vs Stop is confusing.** Pressing Preview marks the card with a border and toggles the button to "Stop preview"; Apply is next to it. The "Previewing Ocean ." banner has a stray space before the period (DesignWorkspace.svelte:~190 markup `<b>…</b>. Not saved yet.`) and sits under the stage on desktop where it moves the layout. Preview is lost when switching tabs (`setTab` clears it, :100-104) without notice. Fix: tapping a palette previews it immediately; one sticky action bar "Previewing Ocean · Apply · Cancel".

**M4. Undo is only for palettes, and only via a transient toast.** Slot filament changes, part moves and adds have no undo; the toast overlaps content on phone and desktop (`st-390-light-generator.png`, `st-1440-light-save-done.png`). No "unsaved" concept exists (everything saves immediately), but nothing says so. Fix: "Saved ✓" micro-status + simple undo/redo (last N) for design edits; place toasts above the pinned action bar.

**M5. Part list: 33 rows, 90+ px per screen on phone, no grouping controls.** Search is good, but there is no role filter chips (the filter exists only by tapping a slot name on the Slots tab, which silently jumps to Parts tab, `onfilter` DesignWorkspace.svelte:~250). Rows look like links but are toggle buttons; selecting a row does not clearly select the part in 3D on phone (C1). Fix: group chips by slot at top of the list; tapping a 3D part scrolls the list row into view; list collapsed by section.

**M6. "Options" (variants) is hidden at the bottom of the Parts tab**, although variants change what is rendered and the totals. A user looking for "short wheels / caster kit" options will not look under Parts. Code: DesignWorkspace.svelte:~290-306. Fix: an "Options" chip/section in the header or a dedicated item near the stage.

**M7. Gallery header collapses.** `/designs` filter bar (`.bar`, `.seg`) renders only 10 px tall under the subtitle, the segmented control and search look clipped/missing and the cards butt against the heading. Evidence: `designs-1440-fold.png` (bar at y 152-162). Code: designs/+page.svelte:100-132. Likely a flex/overflow bug; verify in a real browser. Also thumbnails and the filament-name lists use long names; no "Use in my build" on the card (only on the detail page).

**M8. Design detail page lists every part name for each filament** (a 12-line text wall in the Filaments card, `design-detail-1440-fold.png`), and "Start a build from this design" is below the fold on phone (2,120 px). Fix: show part counts with an expand, and put the primary action ("Start a build" / "Apply to a build") in a sticky header button.

**M9. Studio page is mostly empty.** `/studio` is one form + drafts + a "Shared designs" card whose only content is one button (`studio-1440-newdraft.png`). For the page named "Studio" there is no preview of drafts (a progress bar of color slots rather than a chair thumbnail) and no gallery inline. Fix: draft cards with a 3D snapshot, gallery strip, "New draft" as the primary button.

**M10. Build header chrome on the Design tab.** On phone 464 px (more than half a screen) is nav + header stats + progress bar + tab bar before the chair. These stats ("0 of 33 parts printed", "~382 h of printing left") are tracking info irrelevant to coloring. In drafts the header is shorter (`draft-1440-fold.png`). Fix: collapse the stats row on the Design tab; keep name + tabs.

### Low

- **L1. A11y: role=tablist without arrow-key support.** ArrowRight on a tab does nothing (tested: stays on Palettes), no roving tabindex. Code: DesignWorkspace.svelte:196-212.
- **L2. 202 tab stops in the Palettes tab** (two buttons per card x 19 cards + tiles). A skip link or collapsing lists reduces this.
- **L3. Small targets.** Quick-color swatches 26x26 (also color-only labels), "Use current" 63x21, clear × 32x32, `btn.sm` 29 px tall on desktop and 40 on phone (OK), color inputs 40x34.
- **L4. Picker dialog** has `role="dialog"` but no `aria-modal` or focus trap; Escape closes it (works). On desktop focus goes to search (good); on phone to the sheet container.
- **L5. Muted text** is rgb(93,100,120) on #f4f5f8 at 13-14 px (about 5.3:1: passes AA) but the 12-13 px "why disabled" warning text in warn color and the `.small` muted notes are borderline; check in dark mode.
- **L6. "Tap a part in the 3D view…" hint** persists forever; make it a one-time hint. 3D tap-to-select works on desktop (`st-1440-light-3d-tap.png`); the phone tap test was inconclusive in my run (script clicked at a scrolled position), so verify on a real device.
- **L7. Slots are not removable when they have parts, and "Add a color" is a full-width button** with the same weight as "Change filament"; fine, but "Add a color" creates a new slot (a different concept from changing a filament): label it "Add a slot".
- **L8. "Needs 3.3 kg, have 4 ok"** is stock jargon for a design task; hide `have/ok` unless short.

## Redesign proposal

Principles: (1) the chair is always visible; (2) one mode at a time; (3) palettes are a picker, not a page; (4) the same layout for build tab, draft tab and wizard.

### Desktop (>= 1100 px): fixed-viewport workspace, no page scroll

```
+--------------------------------------------------------------------------------+
| Audit chair [DESIGN]   Overview Design Print Files Finish Settings    Saved ✓  |  compact header, stats collapsed
+--------------------------------------------------------------------------------+
| [Colors] [Parts] [Options]        | Palettes ▾  Share/Save ▾  Undo Redo         |
+-----------------------------------+--------------------------------------------+
|                                   |  COLORS                                    |
|          3D CHAIR                 |  (●) Primary PETG   Overture Blue   [Change]|
|     (fills left pane, sticky,     |  (●) Accent PETG    Digital Blue    [Change]|
|      never clipped)               |  (◐) Primary TPU    ...                    |
|                                   |  (◐) Accent TPU     ...                    |
|   floating chip when part tapped: |  + Add a slot                              |
|   "Wing Left · Accent PETG  ○○○○" |                                            |
|                                   |  Palettes drawer replaces this list when   |
|  Previewing Ocean [Apply][Cancel] |  opened: compact 2-col grid of 19 palettes |
+-----------------------------------+--------------------------------------------+
```

- Left pane `flex:1`, right pane 440 px scrolling on its own (what the wizard does). Container widened to ~1600 px on this route.
- Palettes: a drawer/segment inside the right pane showing a 2-column grid of dot-strip cards (name + 4 dots); click = live 3D preview; sticky Apply/Cancel bar; "Make your own…" expands the generator; variations as a row of 6 chips.
- Swatch picker opens inside the right pane (replaces the slot list with a back arrow) instead of overlaying it; color-family tabs; neutrals collapsed.
- Part chip + 4 round slot swatches replace the Part sheet card (no layout shift).
- Save/Share and "Saved designs" in the header; Options chips.
- Estimated page height: 1 screen (no page scroll); right pane scroll for palettes ~2 screens-of-pane.

### Phone (390)

```
[ nav ]                                  70
 Audit chair · Design  ▾ (stats folded)  60
 Overview Design Print Files Finish ⚙    44
+-------------------------------------+
|  3D CHAIR  (sticky, 34vh ≈ 285px)   |  pinned under tab bar
|  [Previewing Ocean  Apply  Cancel]  |  appears only when previewing
+-------------------------------------+
 [Colors][Palettes][Parts]   (sticky)
  Primary PETG  ● Overture Blue  >      slot rows 64px, tap = picker sheet
  Accent PETG   ● Digital Blue   >
  Primary TPU   ◐ ...            >
  Accent TPU    ◐ ...            >
  + Add a slot
  Share / save design ▸    Options ▸      collapsed rows
```

- Palettes tab: horizontal-scrolling palette cards (dot strips), tap = preview on the pinned chair; "Make your own" collapsed (one color row); total ~1.5 screens instead of 8.3.
- Parts tab: role filter chips + collapsible sections; selecting a row (or tapping the chair) shows the part chip on the pinned chair and a one-row slot-swatch strip (no 460 px card).
- Picker: bottom sheet at 40vh with the pinned chair above, so the recolor is visible.
- Estimated phone heights: Colors ~1,100 px (1.3 screens), Palettes ~1,300 px (1.5), Parts ~2,200 px (2.6, was 5.9).

### What collapses / moves / merges / is cut

- Collapse: generator, brand preference ("Prefer brand" into palette settings), "Save as design", Options, build stats row, per-slot stock lines (have/ok) unless short.
- Move: Save/Share to header; Preview banner to the pinned stage; Options to header chips; "Next: files and export" into the page header as a primary button.
- Merge: Slots + Palettes into a single "Colors" mode (palettes as a drawer); the three slot-label tables into one.
- Cut: the 5-line palette intro paragraph; the persistent "Tap a part…" hint after first use; "Use current" per tile (replace by one "Fill from build" menu); duplicate "Change filament" button + circle button (the circle already opens it).

## Implementation plan (independent chunks, file ownership)

1. **Slot role labels and naming (small, do first).** Own: `src/lib/domain/labels.ts`, `src/lib/domain/palettes.ts` (SLOT_LABEL only), `SlotPanel.svelte`, `PartSheet.svelte`, `PartList.svelte`, title in `DesignWorkspace.svelte:322`. Needs product decision (D1).
2. **Phone sticky stage + pinned preview banner (C1).** Own: `DesignWorkspace.svelte` (styles/markup for stage + banner), `ModelStage.svelte`. Includes picker `openPicker()` scroll logic and `pick()` scroll logic.
3. **Desktop fixed-viewport layout and widened container (H2, M10).** Own: `DesignWorkspace.svelte` layout CSS (reuse the `.embedded` rules for all), the build layout `src/routes/(app)/builds/[id]/+layout.svelte`/`BuildHeader.svelte` (compact header on Design tab). Conflicts with chunk 2 on DesignWorkspace.svelte: run sequentially or give both to one agent.
4. **Palette panel redesign (C2, M1, M3).** Own: `PalettePanel.svelte` only (+ new subcomponent files under `design/`). Compact cards, generator collapse, preview/apply bar. Independent of others apart from the preview/apply bar placement (agree on a `preview` prop contract with chunk 2).
5. **Swatch picker (H4).** Own: `SwatchPicker.svelte`, `src/lib/domain/swatch-picker.ts` (ordering: color families, neutrals collapsed), `CustomFilamentForm.svelte` untouched. Independent.
6. **Part sheet → part chip, parts list filters (H3, M5, M6).** Own: `PartSheet.svelte`, `PartList.svelte`; shares `DesignWorkspace.svelte` markup with 2/3 (coordinate).
7. **Save/Share/Saved designs and status/undo (H5, M4).** Own: `SaveDesign.svelte`, new dialog, `toast.svelte.ts` placement, add "apply a saved design" to the tab (reuse the wizard's selector in `src/routes/(app)/builds/[id]/setup/+page.svelte:167-194`). Needs decision D2/D3.
8. **Gallery, detail and Studio pages (M7-M9).** Own: `src/routes/(app)/designs/+page.svelte`, `designs/[slug]/+page.svelte`, `studio/+page.svelte`. Fully independent.
9. **A11y pass (L1-L4).** Own: tab keyboard support in `DesignWorkspace.svelte` (coordinate), target sizes in `PalettePanel.svelte`/`SlotPanel.svelte`, picker `aria-modal`/focus trap. Do last.

Suggested order: 1, 2, 3 (one agent), then 4 and 5 and 8 in parallel, then 6, 7, 9. Existing e2e (`e2e/design.spec.ts`, `palettes.spec.ts`, `studio.spec.ts`, `setup-wizard.spec.ts`, `mobile.spec.ts`) use `getByRole('tab', { name: 'Parts' })`, `button.row[data-slug]`, `[data-palette]`, `[data-testid=part-sheet]`; keep these hooks or update the specs in the same chunk.

### Product decisions needed from the maintainer

- **D1.** Slot display: fixed role names ("Primary PETG") with the filament as subtitle, even for older builds whose role names were copied at creation? (STATUS r26 says "no migration"; a display-only change avoids migrating.)
- **D2.** Is "Save as design" mainly for sharing? Rename and demote it, and should the Design tab also be able to apply a saved/shared design?
- **D3.** Undo scope: palettes only (today) or all design edits with undo/redo?
- **D4.** Merge Slots and Palettes into one "Colors" mode (palettes as a drawer), keeping Parts separate?
- **D5.** Is it acceptable to widen the page container on the Design route and hide build stats there?
- **D6.** Should the generator (lock colors, 6 harmonies, variations) stay a primary feature or become an "advanced" collapsed tool?
- **D7.** Is real 3D tap-to-select required to work on touch phones (needs a device check; my headless run did not conclusively test it)?

## Screenshots (same folder)

- Sizes: `390-*`, `1440-*`, `1920-*`, `1440x1_5-*` with `-light`/`-dark`, tab (`slots|palettes|parts`), `-fold` (above the fold) or `-full` (full page). Example: `390-light-palettes-full.png`, `1920-light-slots-fold.png`.
- States: `st-390-light-*`, `st-1440-light-*`, `st-1440-dark-*`: `part-selected-fold/full`, `picker-open`, `parts-list-top`, `3d-tap`, `palette-preview`, `palette-applied-toast`, `generator`, `save-filled`, `save-done`.
- Other surfaces: `draft-{390,1440}-{fold,full}`, `studio-*` (including `-newdraft`), `designs-*`, `design-detail-*`, `wizard-colors-*`, `_wizard-first.png`.
- Raw numbers: `measure.json`, `states.json`; scripts in `scripts/`.
- Caveats: dark and 1.5x scale showed no layout differences beyond the above; the build was seeded fresh (4 default slots, no custom filaments), so builds with custom filaments or more slots will be longer. Palettes were applied during the run (the Ocean palette appears in later shots).
