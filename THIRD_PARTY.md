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
