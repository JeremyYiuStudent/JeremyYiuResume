# Site tooling

The site itself has no build step — the HTML at the repo root is served
verbatim by GitHub Pages. This directory holds the one exception.

## `rose-for-regret/`

`https://jeremyyiu.org/rose-for-regret/` is the [Particle
Rose](https://github.com/JeremyYiuStudent/Particle-Rose) app, a WebGL page that
has to be compiled before it can be served.

**`rose-for-regret/` is generated. Do not edit it by hand** — the next rebuild
overwrites the whole directory, including any manual change. Its title and the
`noindex` meta tag are injected by `update-rose.mjs`; change them there.

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
