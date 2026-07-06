// Path B publish exporter (Decision 15 / publish-contract).
//
// Pulls every publish-flagged project from the Open Design daemon and writes a
// static snapshot + manifest.json into the website_deploy working tree under a
// dedicated publish root. The daemon endpoint already enforces the contract
// gates (opt-in flag, path-safe reachable file set, placeholder guard); this
// script re-checks exclusions defensively and fails loudly on any violation.
//
// Env:
//   OD_BASE_URL   e.g. https://design.realsolutions.cloud
//   OD_API_TOKEN  daemon bearer (bypasses the Traefik basic-auth gate)
//   PUBLISH_ROOT  folder under OUT_DIR to write units into (default "published")
//   OUT_DIR       website_deploy checkout dir (default ".")
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import path from 'node:path';

const base = (process.env.OD_BASE_URL || '').replace(/\/$/, '');
const token = process.env.OD_API_TOKEN || '';
const publishRoot = (process.env.PUBLISH_ROOT || 'published').replace(/^\/+|\/+$/g, '');
const outDir = process.env.OUT_DIR || '.';

if (!base || !token) {
  console.error('OD_BASE_URL and OD_API_TOKEN are required.');
  process.exit(1);
}

const headers = { authorization: `Bearer ${token}`, origin: base };

async function api(pathname) {
  const resp = await fetch(`${base}${pathname}`, { headers });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`GET ${pathname} -> ${resp.status} ${detail.slice(0, 300)}`);
  }
  return resp.json();
}

function isExcludedPath(p) {
  // Defense-in-depth: never write a traversal or dot-prefixed path, even
  // though the daemon's reachability walk already excludes them.
  if (!p || p.startsWith('/') || p.includes('..') || p.includes('\\')) return true;
  return p.split('/').some((seg) => seg.startsWith('.'));
}

const { projects = [] } = await api('/api/projects');
const flagged = projects.filter((p) => p?.metadata?.publish?.enabled);
console.log(`Publish-flagged units: ${flagged.length}`);

const rootDir = path.join(outDir, publishRoot);
// Rebuild the publish root from scratch so units that were un-flagged or
// removed disappear from the public site. Only our publish root is touched;
// the rest of website_deploy (the pre-existing site) is never modified.
await rm(rootDir, { recursive: true, force: true });
await mkdir(rootDir, { recursive: true });

const units = [];
const seenSlugs = new Set();

for (const project of flagged) {
  const { unit, files } = await api(
    `/api/projects/${encodeURIComponent(project.id)}/publish/export`,
  );
  if (!unit?.slug) throw new Error(`unit for project ${project.id} has no slug`);
  if (seenSlugs.has(unit.slug)) {
    throw new Error(`duplicate publish slug "${unit.slug}" — slugs must be unique`);
  }
  seenSlugs.add(unit.slug);

  const unitDir = path.join(rootDir, unit.slug);
  for (const file of files) {
    if (isExcludedPath(file.path)) {
      throw new Error(`refusing to publish excluded path "${file.path}" in ${unit.slug}`);
    }
    const dest = path.join(unitDir, file.path);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(file.contentBase64, 'base64'));
  }

  units.push({
    id: unit.id,
    title: unit.title,
    slug: unit.slug,
    kind: unit.kind,
    path: `${publishRoot}/${unit.slug}/index.html`,
    sourceProjectId: unit.sourceProjectId,
    sourceEntry: unit.sourceEntry,
    publishedAt: unit.publishedAt,
    contentHash: unit.contentHash,
    fileCount: unit.fileCount,
  });
  console.log(`  ✓ ${unit.slug} (${unit.fileCount} files) ${unit.contentHash}`);
}

const manifest = {
  manifestVersion: 1,
  generatedAt: new Date().toISOString(),
  site: { publishRoot },
  units: units.sort((a, b) => a.slug.localeCompare(b.slug)),
};
await writeFile(
  path.join(rootDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(`Wrote ${units.length} unit(s) + manifest.json to ${rootDir}`);
