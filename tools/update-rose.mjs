#!/usr/bin/env node
// Rebuilds the Particle Rose bundle and refreshes the servable copy in
// rose-for-regret/.
//
//   node tools/update-rose.mjs            rebuild from the existing local clone
//   node tools/update-rose.mjs --pull     fast-forward the clone to origin/main, then rebuild
//   node tools/update-rose.mjs --install  force a fresh npm ci first
//
// vendor/particle-rose is a plain clone that is NOT tracked by this repo (see
// .gitignore). It deliberately used to be a git submodule; that broke the
// GitHub Pages build, because a branch-based Pages deploy runs
// `git submodule update --init` across the repo and has no credentials for a
// private submodule. The failure takes down deploys for the *whole site*, not
// just this page. Do not reintroduce the submodule while Particle-Rose is
// private.
//
// Provenance instead lives in tools/rose-build-info.json, which is committed.

import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_TITLE = "A Rose for Regret";
const REPO_URL = "https://github.com/JeremyYiuStudent/Particle-Rose.git";
const BRANCH = "main";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "vendor", "particle-rose");
const out = join(root, "rose-for-regret");
const infoPath = join(root, "tools", "rose-build-info.json");
const args = new Set(process.argv.slice(2));
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });
const capture = (cmd, cwd) => execSync(cmd, { cwd }).toString().trim();

const cloned = existsSync(join(src, "package.json"));
if (!cloned) {
  console.log(`Cloning ${REPO_URL} into vendor/particle-rose ...`);
  run(`git clone --branch ${BRANCH} ${REPO_URL} vendor/particle-rose`);
}

const pulling = args.has("--pull");
if (pulling) {
  // --ff-only so a diverged or dirty vendor clone fails loudly instead of
  // quietly building something that is not upstream.
  run(`git pull --ff-only origin ${BRANCH}`, src);
}

// Always reinstall after a clone or pull: the upstream lockfile may have moved,
// and a stale node_modules would build the wrong dependency tree silently.
if (!cloned || pulling || args.has("--install") || !existsSync(join(src, "node_modules"))) {
  run("npm ci", src);
}

// --sourcemap=false matters: upstream hardcodes build.sourcemap true, which
// emits a 3 MB .map next to a 670 KB bundle. npm appends this to the chained
// `vite build`, leaving the `tsc --noEmit` step intact.
run("npm run build -- --sourcemap=false", src);

const dist = join(src, "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error(`Build produced no ${join(dist, "index.html")} - aborting.`);
  process.exit(1);
}

// Vite emits content-hashed filenames, so the old directory has to go rather
// than be merged into, or every previous bundle lingers forever.
rmSync(out, { recursive: true, force: true });
cpSync(dist, out, { recursive: true });

// Host-specific tweaks live here rather than upstream, so the vendor clone
// stays merge-free and these are re-applied on every build by construction.
const indexPath = join(out, "index.html");
let html = readFileSync(indexPath, "utf8");

const edits = [
  {
    what: "noindex meta",
    find: /<meta charset="UTF-8" \/>/,
    replace:
      '<meta charset="UTF-8" />\n    <meta name="robots" content="noindex, nofollow" />',
  },
  {
    what: "page title",
    find: /<title>.*<\/title>/,
    replace: `<title>${PAGE_TITLE}</title>`,
  },
];

for (const { what, find, replace } of edits) {
  if (!find.test(html)) {
    // Loud rather than silent: if upstream reformats its <head>, a quiet no-op
    // would ship an indexable page named "Particle Rose" and nobody would know.
    console.error(
      `Could not apply ${what}: pattern ${find} no longer matches the built index.html.\n` +
        `Upstream markup changed - update the anchors in tools/update-rose.mjs.`,
    );
    process.exit(1);
  }
  html = html.replace(find, replace);
}

writeFileSync(indexPath, html);

// Committed provenance, standing in for what the submodule gitlink used to
// record. No timestamp on purpose: rebuilding the same commit must produce an
// identical file, so a no-op rebuild stays a no-op in git.
const commit = capture("git rev-parse HEAD", src);
const subject = capture("git log -1 --pretty=%s", src);
writeFileSync(
  infoPath,
  JSON.stringify({ repository: REPO_URL, commit, subject }, null, 2) + "\n",
);

const short = commit.slice(0, 7);
const assets = readdirSync(join(out, "assets"));
console.log(
  `\nrose-for-regret/ rebuilt from particle-rose ${short} - ${subject}\n` +
    `  assets: ${assets.join(", ")}\n` +
    `  next:   git add -A && git commit -m "Update rose-for-regret (particle-rose ${short})"`,
);
