# Export for your slicer (3MF)

The **Files** tab has an **Export for your slicer** card. It builds a 3MF from the build's arranged plates and filaments, so after you change colors and re-arrange, the next download has the new groups.

- **Elegoo Slicer / OrcaSlicer** and **Bambu Studio**: one project file with every plate (or the plates you tick), one object per part, the filament slot of each part's color, MakeGood's per-part settings (walls, infill, supports, brim) and the printer's bed. Plates sit in the slicer's shared build volume at its own grid offsets (see `src/lib/server/threemf-export/plate-grid.ts`).
- **Other slicer**: a plain 3MF per plate (a zip when you export several); the filament is part of each object's name, and PrusaSlicer also gets the extruder per object.
- Needs a printer on the build and the print geometry imported by a site admin (kit admin page, or the command line described in [Site admin](site-admin.md#importing-print-geometry-without-the-browser); on a public instance, print-geometry import is site-admin only). Parts without imported geometry are left out and listed in the card and in `Metadata/tmt_export_notes.txt`. The standard kit's print geometry is already installed by the kit pack.
- API: `GET /api/builds/<id>/export.3mf?flavor=orca|bambu|plain&plates=1,2` and `GET /api/builds/<id>/export/preview` (JSON summary). Any team member, viewers included. The file is streamed, never held in memory.

If the build's plates are not arranged for its printer, or colors changed since, the export arranges in memory (nothing is saved) and says so.
