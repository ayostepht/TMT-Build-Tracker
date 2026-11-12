# Third-party data

## SpoolmanDB

`src/lib/server/filaments/catalog.json` is derived from the compiled
[SpoolmanDB](https://github.com/Donkie/SpoolmanDB) filament database
(`https://donkie.github.io/SpoolmanDB/filaments.json`), normalised by
`scripts/update-filaments.mjs`.

MIT License

Copyright (c) 2024 Donkie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Vendor store product data (Overture, Schoolhouse Spools)

`src/lib/server/filaments/supplement.json` lists filament colors (names and hex values) read from the public
product pages of [Overture](https://overture3d.com) and [Schoolhouse Spools](https://schoolhousespools.com),
for colors that SpoolmanDB does not have yet. `scripts/fetch-vendor-filaments.mjs` builds it and
`scripts/update-filaments.mjs` merges it into `catalog.json`. Only factual data (brand, material, color name,
color value) is kept; no images, descriptions or prices. Each entry says whether its hex came from the store
(`hexSource: "store"`) or was estimated from a product photo (`"image"`). Brand names belong to their
owners; no endorsement is implied.

## 3D model pipeline (npm dependencies)

The kit admin converts each install's own MakeGood STEP files into a web model. None of
these libraries ship any MakeGood data.

- **occt-import-js** (LGPL-2.1, https://github.com/kovacsv/occt-import-js): a WebAssembly build of
  OpenCascade that reads STEP files. Used unmodified as an npm dependency, loaded at runtime from
  `node_modules`; you can replace it with your own build of the library.
- **OpenCascade Technology** (LGPL-2.1 with the OCCT exception, https://dev.opencascade.org): the
  geometry kernel compiled into occt-import-js.
- **three** (MIT, https://threejs.org): the 3D viewer (`ChairViewer`), including its GLTFLoader,
  OrbitControls, RoomEnvironment and meshopt decoder add-ons.
- **glTF-Transform** (MIT, https://gltf-transform.dev): builds and optimises the GLB.
- **meshoptimizer** (MIT, https://github.com/zeux/meshoptimizer): geometry compression
  (EXT_meshopt_compression).

## Guide import (npm dependencies)

The kit admin imports each install's own MakeGood guide PDF in the browser. Neither library ships
any MakeGood data.

- **pdf.js / pdfjs-dist** (Apache-2.0, https://github.com/mozilla/pdf.js): renders the guide PDF's
  pages to images in the admin's browser (the worker is served by the app's own bundle).
- **fflate** (MIT, https://github.com/101arrowz/fflate): reads the guide PDF out of a MakeGood 3MF
  (a zip) in the browser.

## Fonts

`static/fonts/` bundles latin-subset woff2 files of Barlow Condensed (500, 600,
700; Copyright The Barlow Project Authors), IBM Plex Sans (variable 400-600) and
IBM Plex Mono (400, 500) (Copyright IBM Corp.), downloaded from Google Fonts so
the app has no runtime dependency on it. All three are licensed under the SIL
Open Font License 1.1 (<https://openfontlicense.org>). The licence texts ship next to the
font files: [static/fonts/LICENSE-IBM-Plex.txt](static/fonts/LICENSE-IBM-Plex.txt) (copyright
2017 IBM Corp., Reserved Font Name "Plex", from <https://github.com/IBM/plex>) and
[static/fonts/LICENSE-Barlow.txt](static/fonts/LICENSE-Barlow.txt) (copyright 2017 The Barlow
Project Authors, from <https://github.com/jpt/barlow>).

## MakeGood 3D TMT (kit pack)

The 3D model and print files of the MakeGood 3D TMT (toddler mobility trainer) are by **MakeGood**,
released as **Creative Commons Public Domain (CC0 1.0)** (confirmed by the maintainer from the
model's MakerWorld page). Credit: 3D model and print files by MakeGood.

They are not in this git repository. TMT Build Tracker converts them (STEP to a web 3D model, slicer
projects to compact print geometry with the per-object print settings and painted supports) and
ships the result as a kit pack, a release asset that the Docker image includes and installs on first
start (see `docs/kit-pack.md`; `CREDITS.md` and the license in `manifest.json` are inside every
pack). The design is unchanged, the data is only reformatted (print meshes are quantized to 0.01 mm).

The maker guide (PDF) is **not** bundled. The app refers to MakeGood's guide page numbers and links
to their guide; get it from MakeGood.
