# Site tooling

The site itself has no build step — the HTML at the repo root is served
verbatim by GitHub Pages. This directory holds the exceptions: two apps that
have to be compiled before they can be served, each living at its own unlinked
URL.

| Page | Source | Script |
| --- | --- | --- |
| `rose-for-regret/` | Particle Rose (private repo, cloned into `vendor/`) | `update-rose.mjs` |
| `keter-chan/` | Keter (a sibling working directory) | `update-keter.mjs` |

Both output directories are **generated. Do not edit them by hand** — the next
rebuild overwrites the whole directory, including any manual change.

To look at either one locally, serve the repo root (not the subdirectory — both
pages reference their assets from the site root) and open the path:

```bash
npx serve --listen 4321 .
```

`.claude/launch.json` runs the same command.

## `rose-for-regret/`

`https://jeremyyiu.org/rose-for-regret/` is the [Particle
Rose](https://github.com/JeremyYiuStudent/Particle-Rose) app, a WebGL page that
has to be compiled before it can be served.

Its title and the `noindex` meta tag are injected by `update-rose.mjs`; change
them there.

The page is deliberately unlinked: nothing on the site points at it, and it
carries `noindex, nofollow`. Reaching it requires typing the URL.

### Updating it

The source is a plain clone at `vendor/particle-rose`, which is **not tracked by
this repo** (see `.gitignore`). `update-rose.mjs` creates it on first run.

```bash
node tools/update-rose.mjs --pull
git add -A
git commit -m "Update rose-for-regret (particle-rose <sha>)"
git push
```

The script prints the exact commit line to use, and records the upstream commit
in `tools/rose-build-info.json` so this repo's history alone answers "which
version of the rose is live".

| Command | Does |
| --- | --- |
| `node tools/update-rose.mjs` | Rebuild from the existing clone, no fetch |
| `node tools/update-rose.mjs --pull` | Fast-forward the clone to `origin/main`, reinstall, rebuild |
| `node tools/update-rose.mjs --install` | Force `npm ci` before building |

Re-running is safe: the script regenerates `rose-for-regret/` from scratch each
time, so rebuilding the same upstream commit leaves the tree unchanged.

After a `--pull`, it's worth running the upstream test suite before committing:

```bash
npm --prefix vendor/particle-rose run check
```

### Why this is a plain clone and not a submodule

It was a submodule first. That broke the GitHub Pages build.

A branch-based Pages deploy runs `git submodule update --init` across the repo,
and it has no credentials for a private repository — so the build fails and
**the entire site stops deploying**, not just this page. Already-published pages
keep serving from the last good build, which makes the failure quiet and easy to
miss.

Do not reintroduce the submodule while Particle-Rose is private. If it is ever
made public, a submodule becomes safe again — but the clone approach works
either way and needs no `.gitmodules`.

### Requirements

Node (any recent version; built with 24.x) and read access to the Particle-Rose
repository, which is **private**.

That access is only needed to *rebuild* the rose. The live site never touches
the clone — Pages serves the committed `rose-for-regret/` directory — so a fresh
clone of this repo without that access still deploys the site correctly. It just
can't regenerate the page.

## `keter-chan/`

`https://jeremyyiu.org/keter-chan/` is **Keter**, an interactable winged
companion: a hand-authored SVG character on a custom JS bone rig, who watches
the cursor, can be picked up and thrown, and wanders off on his own when left
alone. No runtime dependencies; 25 KB of gzipped JavaScript and 4.4 MB of
artwork.

Its title and the `noindex` meta tag are injected by `update-keter.mjs`; change
them there.

Like the rose, the page is deliberately unlinked: nothing on the site points at
it, and it carries `noindex, nofollow`. Reaching it requires typing the URL.

### Updating it

The source is a separate working directory. `update-keter.mjs` looks for it at
`../InteractableBuddy` — beside this repo — and takes `--source=<path>` or the
`KETER_SOURCE` environment variable if it lives somewhere else.

```bash
node tools/update-keter.mjs
git add -A
git commit -m "Update keter-chan (keter <version>)"
git push
```

| Command | Does |
| --- | --- |
| `node tools/update-keter.mjs` | Typecheck the source, build, replace `keter-chan/` |
| `node tools/update-keter.mjs --source=<path>` | Build from a checkout elsewhere |
| `node tools/update-keter.mjs --install` | Force `npm ci` in the source first |
| `node tools/update-keter.mjs --no-typecheck` | Skip `tsc --noEmit` |

Re-running is safe, and the build never writes into the source tree: it stages
into `vendor/keter-dist` (gitignored, and outside `keter-chan/` so a failed
build cannot leave the live page half-written), then replaces `keter-chan/`
wholesale. Rebuilding unchanged source leaves the tree unchanged.

Worth running the source's own suite before committing — 375 tests, about half
a minute:

```bash
npm --prefix ../InteractableBuddy test
```

### What the build changes, and why it changes it here

Keter is written as a full-page app served from `/`. Two things about that are
wrong for this site, and both are fixed at build time by the Vite plugin in
`keter-vite.config.mjs`, which rewrites the module in memory:

- **The art paths.** `src/main.ts` hardcodes `/layers` and `/face`, which on
  this site resolve to the root, where they do not exist. They become
  `import.meta.env.BASE_URL`-relative, so they follow the `base` setting
  (`/keter-chan/`) instead.
- **The debug dock.** The control panel — FPS, pause, every animation clip and
  expression as a button — is created unconditionally and is visible. It gets
  handed a detached element to mount into, so it is built and wired but never
  enters the document. One line, instead of deleting the panel and the thirty
  calls that configure it.

Doing this here rather than in Keter is the same call the rose makes about its
`<head>` edits: the source stays free of anything host-specific, so it can keep
moving without carrying a fork, and the changes are re-applied on every build by
construction. Every patch is asserted — if an anchor stops matching, or the
prefix fails to reach the emitted bundle, the build fails instead of shipping a
page that 404s its own artwork.

Two things are deliberately *not* changed. `INTEGRATION.md` in the source calls
for scoping the CSS and the keyboard shortcuts before embedding — but both of
those are about putting him in a corner of an existing page. Here he *is* the
page, so full-viewport CSS and window-level arrow/space capture are correct.

### Provenance

Keter has no git remote, so there is no upstream commit to pin the way
`rose-build-info.json` pins the rose. `keter-build-info.json` records the
package version, a SHA-256 over every source and art file the build reads, and
the hash of each emitted asset. No timestamps: rebuilding the same source
produces a byte-identical file, so a no-op rebuild stays a no-op in git.

### Requirements

Node (any recent version; built with 24.x) and a checkout of the Keter project.

That checkout is only needed to *rebuild* the page. The live site never touches
it — Pages serves the committed `keter-chan/` directory — so a fresh clone of
this repo without it still deploys the site correctly. It just can't regenerate
the page.

### If the artwork needs to get smaller

4.4 MB is nearly all art, and by the source's own measurement about 730 KB of it
is dead — files left over from earlier cuts that neither manifest references,
plus two 1024x1024 face bases that render at about 305 px. `INTEGRATION.md` in
the source has the file-by-file breakdown. That is a change to make over there,
in the manifests; this script copies whatever `public/` holds.
