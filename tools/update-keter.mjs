#!/usr/bin/env node
// Rebuilds Keter and refreshes the servable copy in keter-chan/.
//
//   node tools/update-keter.mjs                   build from ../InteractableBuddy
//   node tools/update-keter.mjs --source=<path>   build from somewhere else
//   node tools/update-keter.mjs --install         npm ci in the source first
//   node tools/update-keter.mjs --no-typecheck    skip tsc --noEmit
//
// Unlike the rose, the source is NOT a clone this script manages: Keter lives
// in a working directory of its own (no git remote, and at the time of writing
// no repository at all), so there is nothing to fetch and no commit to pin.
// Point --source at wherever it is; the default assumes it sits beside this
// repo, which is where it lives today.
//
// The build never writes to the source tree. The two changes this site needs in
// Keter's src/main.ts - the /keter-chan/ prefix on the art paths, and detaching
// the debug dock - are applied in memory by tools/keter-vite.config.mjs, so the
// source can keep moving without carrying a fork of anything.
//
// Provenance lives in tools/keter-build-info.json, which is committed: with no
// upstream commit to record, it stores a content hash of the source instead, so
// this repo's history alone answers "which Keter is live", and a rebuild that
// changes nothing is visibly a no-op.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_TITLE = "Keter";
const DEFAULT_SOURCE = "../InteractableBuddy";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "keter-chan");
const staging = join(root, "vendor", "keter-dist");
const configPath = join(root, "tools", "keter-vite.config.mjs");
const infoPath = join(root, "tools", "keter-build-info.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const die = (message) => {
  console.error(message);
  process.exit(1);
};

const src = resolve(root, option("source") ?? process.env["KETER_SOURCE"] ?? DEFAULT_SOURCE);
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

// --- the source ------------------------------------------------------------

if (!existsSync(join(src, "package.json"))) {
  die(
    `No package.json in ${src}.\n` +
      `Pass --source=<path to the Keter checkout>, or set KETER_SOURCE.`,
  );
}

const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
if (pkg.name !== "interactable-buddy") {
  die(
    `${src} is "${pkg.name}", not the Keter project ("interactable-buddy"). Refusing to build it.`,
  );
}

// A stale node_modules builds the wrong dependency tree silently, so reinstall
// on request - and install unprompted only when there is nothing there at all.
if (flag("install") || !existsSync(join(src, "node_modules"))) {
  run("npm ci", src);
}

// Keter's own `npm run build` is `tsc --noEmit && vite build`. This script
// replaces the vite half with its own config, so run the tsc half by hand
// rather than lose it. It checks the source as written; the two host patches
// are applied later, in the bundler, and are too small to change the answer.
if (!flag("no-typecheck")) {
  run("npm run typecheck", src);
}

// --- build -----------------------------------------------------------------

// cwd is the source, so Vite's root - and with it publicDir, which is what
// carries public/layers and public/face into the output - resolves there.
// Only the config comes from this repo.
rmSync(staging, { recursive: true, force: true });
run(`npm exec -- vite build --config "${configPath}"`, src);

// --- check what came out ---------------------------------------------------

const required = ["index.html", "assets", "layers/manifest.json", "face/manifest.json"];
for (const entry of required) {
  if (!existsSync(join(staging, entry))) {
    die(`Build produced no ${entry} in ${staging} - aborting before touching keter-chan/.`);
  }
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const built = walk(staging);
const maps = built.filter((f) => f.endsWith(".map"));
if (maps.length > 0) {
  die(
    `Build emitted ${maps.length} sourcemap(s); keter-vite.config.mjs sets sourcemap: false. Aborting.`,
  );
}

// The whole point of the custom config is the /keter-chan/ prefix. Vite applies
// it to the tags in index.html; the plugin applies it to the art paths. Check
// the second one against the emitted bundle rather than trusting that the
// transform ran - a patched-but-not-bundled main.ts would 404 every PNG at
// runtime and look, in the build log, exactly like a success.
const bundle = built.find((f) => f.endsWith(".js"));
const js = readFileSync(bundle, "utf8");
for (const needle of ["/keter-chan/layers", "/keter-chan/face"]) {
  if (!js.includes(needle)) {
    die(
      `The built bundle never mentions ${needle}, so the art would 404 at runtime.\n` +
        `The host patches in tools/keter-vite.config.mjs did not reach the output.`,
    );
  }
}

// --- publish ---------------------------------------------------------------

// Vite content-hashes the JS and CSS, so the old directory has to go rather
// than be merged into, or every previous bundle lingers forever.
rmSync(out, { recursive: true, force: true });
cpSync(staging, out, { recursive: true });

// Host-specific tweaks live here rather than in Keter, so its tree stays
// fork-free and these are re-applied on every build by construction.
const indexPath = join(out, "index.html");
let html = readFileSync(indexPath, "utf8");

const edits = [
  {
    what: "noindex meta",
    find: /<meta charset="UTF-8" \/>/,
    replace: '<meta charset="UTF-8" />\n    <meta name="robots" content="noindex, nofollow" />',
  },
  {
    what: "page title",
    find: /<title>.*<\/title>/,
    replace: `<title>${PAGE_TITLE}</title>`,
  },
];

for (const { what, find, replace } of edits) {
  if (!find.test(html)) {
    // Loud rather than silent: a quiet no-op here would ship an indexable page.
    die(
      `Could not apply ${what}: pattern ${find} no longer matches the built index.html.\n` +
        `Keter's markup changed - update the anchors in tools/update-keter.mjs.`,
    );
  }
  html = html.replace(find, replace);
}

if (!html.includes("/keter-chan/assets/")) {
  die(
    `index.html does not reference /keter-chan/assets/ - the base is wrong and the page will not load.`,
  );
}

writeFileSync(indexPath, html);

// --- provenance ------------------------------------------------------------

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

// Everything the build actually reads: the TypeScript, the CSS, the artwork and
// both manifests. Sorted and path-tagged, so the digest is stable across
// machines and moves if and only if the input moved. No timestamp on purpose -
// rebuilding the same source must leave this file byte-identical, so a no-op
// rebuild stays a no-op in git.
const sourceDigest = createHash("sha256");
for (const file of ["src", "public"].flatMap((d) => walk(join(src, d))).sort()) {
  sourceDigest.update(relative(src, file).split(sep).join("/"));
  sourceDigest.update(sha(readFileSync(file)));
}

const assets = readdirSync(join(out, "assets")).sort();
writeFileSync(
  infoPath,
  JSON.stringify(
    {
      project: pkg.name,
      version: pkg.version,
      sourceHash: sourceDigest.digest("hex"),
      assets: Object.fromEntries(
        assets.map((name) => [name, sha(readFileSync(join(out, "assets", name)))]),
      ),
    },
    null,
    2,
  ) + "\n",
);

const published = walk(out);
const bytes = published.reduce((total, f) => total + statSync(f).size, 0);
console.log(
  `\nketer-chan/ rebuilt from ${src}\n` +
    `  version: ${pkg.name} ${pkg.version}\n` +
    `  assets:  ${assets.join(", ")}\n` +
    `  size:    ${(bytes / 1024 / 1024).toFixed(1)} MB across ${published.length} files\n` +
    `  next:    git add -A && git commit -m "Update keter-chan (keter ${pkg.version})"`,
);
