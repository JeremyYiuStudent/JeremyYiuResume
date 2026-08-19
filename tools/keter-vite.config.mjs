// Vite config used ONLY to build keter-chan/ for this site.
//
// It is deliberately not part of the Keter project. Running `vite build` with
// this config leaves that project's own vite.config.ts, its dist/ and its
// source files completely untouched — the host-specific changes below are
// applied in memory, to the module graph, exactly like the index.html edits in
// update-keter.mjs are applied to the built HTML. Nothing has to be patched
// upstream and re-patched after every change over there.
//
// Run it through tools/update-keter.mjs; it is not meant to be invoked directly.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The page lives at https://jeremyyiu.org/keter-chan/, so every URL the app
// emits has to carry that prefix. Vite rewrites the ones it can see (the
// script and stylesheet tags); BASE_URL, injected by the plugin below, covers
// the four it cannot — the art paths, which are plain string literals.
export const BASE = '/keter-chan/';

/**
 * The two changes this site needs in `src/main.ts`.
 *
 * Both are asserted: if the upstream lines move or get reworded, the build
 * fails here rather than emitting a page that silently 404s its own artwork,
 * or one that ships the debug panel to visitors.
 */
function hostPatches() {
  const edits = [
    // Art paths. main.ts hardcodes the four site-absolute bases, which resolve
    // to /layers and /face — the root of this site, where they do not exist.
    // import.meta.env.BASE_URL is the `base` below, with its trailing slash.
    {
      what: 'face manifest fetch',
      find: "fetch('/face/manifest.json')",
      replace: 'fetch(`${import.meta.env.BASE_URL}face/manifest.json`)',
    },
    {
      what: 'layer manifest fetch',
      find: "fetch('/layers/manifest.json')",
      replace: 'fetch(`${import.meta.env.BASE_URL}layers/manifest.json`)',
    },
    {
      what: 'body layer base',
      find: "buildBody(layerManifest, '/layers')",
      replace: 'buildBody(layerManifest, `${import.meta.env.BASE_URL}layers`)',
    },
    {
      what: 'face rig base',
      find: "new FaceRig(faceManifest, '/face')",
      replace: 'new FaceRig(faceManifest, `${import.meta.env.BASE_URL}face`)',
    },
    // The dock is the development control panel: FPS, pause, every animation
    // clip and expression as a button, the state readout. INTEGRATION.md lists
    // it first under "strip the development tooling", and it is the only one of
    // the three that is visible.
    //
    // Its constructor takes the element to mount into and appends itself to it,
    // so handing it a detached div is enough — main.ts goes on calling
    // dock.addToggle/addButton/setFps against a panel that is never in the
    // document. That keeps the patch to one line and leaves the ~30 wiring
    // calls below it alone; deleting the panel outright would mean deleting
    // those too, and re-deleting them after every upstream change.
    {
      what: 'dock detach',
      find: 'const dock = new Dock();',
      replace: 'const dock = new Dock(document.createElement(`div`));',
    },
  ];

  return {
    name: 'keter-host-patches',
    enforce: 'pre',
    transform(code, id) {
      // Vite normalises module ids to forward slashes, on Windows too.
      if (!id.endsWith('/src/main.ts')) return null;

      let out = code;
      for (const { what, find, replace } of edits) {
        if (!out.includes(find)) {
          this.error(
            `Could not apply the "${what}" patch: ${JSON.stringify(find)} is no longer in src/main.ts.\n` +
              `Keter changed - update the anchors in tools/keter-vite.config.mjs.`,
          );
        }
        out = out.replaceAll(find, replace);
      }
      // No sourcemap returned on purpose: this build emits none (see below).
      return out;
    },
  };
}

export default {
  base: BASE,
  plugins: [hostPatches()],
  build: {
    // Matches the Keter project's own build target.
    target: 'es2022',
    // Upstream builds with sourcemap: true, which emits a 380 KB .map beside a
    // 76 KB bundle. Nothing on a published page reads it.
    sourcemap: false,
    // Staged outside the Keter project (so its dist/ stays whatever the last
    // `npm run build` over there left) and outside keter-chan/ (so a failed
    // build cannot leave the live page half-written). vendor/ is gitignored.
    outDir: resolve(root, 'vendor', 'keter-dist'),
    // Required because outDir is outside the Vite root.
    emptyOutDir: true,
  },
};
