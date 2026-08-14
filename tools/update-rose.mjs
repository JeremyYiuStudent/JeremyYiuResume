#!/usr/bin/env node
// Rebuilds the Particle Rose bundle from vendor/particle-rose and refreshes the
// servable copy in rose-for-regret/.
//
//   node tools/update-rose.mjs            rebuild the currently pinned commit
//   node tools/update-rose.mjs --pull     fast-forward to upstream main, then rebuild
//   node tools/update-rose.mjs --install  force a fresh npm ci first
//
// The site serves rose-for-regret/ directly, so the submodule is build-time
// only: if it is ever unavailable, the deployed page keeps working untouched.
// Commit the regenerated rose-for-regret/ afterwards.

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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sub = join(root, "vendor", "particle-rose");
const out = join(root, "rose-for-regret");
const args = new Set(process.argv.slice(2));
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });

const pulling = args.has("--pull");

if (pulling) {
  run("git submodule update --remote --init vendor/particle-rose");
}

if (!existsSync(join(sub, "package.json"))) {
  console.error(
    "vendor/particle-rose is empty. Run:\n  git submodule update --init --recursive",
  );
  process.exit(1);
}

// Always reinstall after a pull: the upstream lockfile may have moved, and a
// stale node_modules would build the wrong dependency tree without complaining.
if (pulling || args.has("--install") || !existsSync(join(sub, "node_modules"))) {
  run("npm ci", sub);
}

// --sourcemap=false matters: upstream hardcodes build.sourcemap true, which
// emits a 3 MB .map next to a 670 KB bundle. npm appends this to the chained
// `vite build`, leaving the `tsc --noEmit` step intact.
run("npm run build -- --sourcemap=false", sub);

const dist = join(sub, "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error(`Build produced no ${join(dist, "index.html")} — aborting.`);
  process.exit(1);
}

// Vite emits content-hashed filenames, so the old directory has to go rather
// than be merged into, or every previous bundle lingers forever.
rmSync(out, { recursive: true, force: true });
cpSync(dist, out, { recursive: true });

// Host-specific tweaks live here rather than upstream, so the submodule stays
// merge-free and these are re-applied on every build by construction.
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
        `Upstream markup changed — update the anchors in tools/update-rose.mjs.`,
    );
    process.exit(1);
  }
  html = html.replace(find, replace);
}

writeFileSync(indexPath, html);

const assets = readdirSync(join(out, "assets"));
const sha = execSync("git rev-parse --short HEAD", { cwd: sub }).toString().trim();
const subject = execSync("git log -1 --pretty=%s", { cwd: sub }).toString().trim();

console.log(
  `\nrose-for-regret/ rebuilt from particle-rose ${sha} — ${subject}\n` +
    `  assets: ${assets.join(", ")}\n` +
    `  next:   git add -A && git commit -m "Update rose-for-regret (particle-rose ${sha})"`,
);
