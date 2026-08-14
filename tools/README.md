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

Source lives in the `vendor/particle-rose` submodule. To pull the latest
upstream changes and refresh the deployed copy:

```bash
node tools/update-rose.mjs --pull
git add -A
git commit -m "Update rose-for-regret (particle-rose <sha>)"
git push
```

The script prints the exact commit line to use. Recording the upstream SHA
there means this repo's history alone answers "which version of the rose is
live", without needing access to the other repo.

Other forms:

| Command | Does |
| --- | --- |
| `node tools/update-rose.mjs` | Rebuild the currently pinned commit, no upstream fetch |
| `node tools/update-rose.mjs --pull` | Fast-forward the submodule to `origin/main`, reinstall, rebuild |
| `node tools/update-rose.mjs --install` | Force `npm ci` before building |

Re-running is safe: the script regenerates `rose-for-regret/` from scratch each
time, so a second run leaves the tree unchanged.

After a `--pull`, it's worth running the upstream test suite before committing:

```bash
npm --prefix vendor/particle-rose run check
```

### Requirements

Node (any recent version; built with 24.x) and access to the Particle-Rose
repository, which is **private**.

That access is only needed to *rebuild* the rose. The live site never touches
the submodule — Pages serves the committed `rose-for-regret/` directory — so a
clone without submodule access still deploys the site correctly. It just can't
regenerate the page. If `vendor/particle-rose` is empty after cloning:

```bash
git submodule update --init --recursive
```
