#!/usr/bin/env node
// Validates every plugins/*.json registry entry: schema shape, unique slugs, and that the
// pinned GitHub release actually contains a manifest.json + entry-point .wasm matching what the
// entry claims, checksum included. No dependencies (hand-rolled against schema/entry.schema.json's
// fixed field set rather than pulling in a JSON Schema validator for six fields).

import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const PLUGINS_DIR = new URL("../plugins/", import.meta.url);
const GITHUB_API = "https://api.github.com";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const CHECKSUM_RE = /^sha256:[a-f0-9]{64}$/;
const CATEGORIES = new Set(["Metadata", "Artwork", "Subtitles", "Sync"]);
const REQUIRED_FIELDS = ["slug", "name", "description", "category", "publisher", "repository", "version", "checksum"];

function githubHeaders() {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "kosmos-plugin-registry-ci" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function validateShape(entry, file) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!entry[field]) errors.push(`${file}: missing required field "${field}"`);
  }
  if (entry.slug && !SLUG_RE.test(entry.slug)) errors.push(`${file}: slug "${entry.slug}" doesn't match ${SLUG_RE}`);
  if (entry.category && !CATEGORIES.has(entry.category)) {
    errors.push(`${file}: category "${entry.category}" must be one of ${[...CATEGORIES].join(", ")}`);
  }
  if (entry.checksum && !CHECKSUM_RE.test(entry.checksum)) {
    errors.push(`${file}: checksum must look like "sha256:<64 hex chars>", got "${entry.checksum}"`);
  }
  if (entry.repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry.repository)) {
    errors.push(`${file}: repository "${entry.repository}" must be "owner/repo", not a full URL`);
  }
  return errors;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function validateRelease(entry, file) {
  const errors = [];
  let release;
  try {
    release = await fetchJson(`${GITHUB_API}/repos/${entry.repository}/releases/tags/${entry.version}`);
  } catch (e) {
    errors.push(`${file}: couldn't fetch release ${entry.repository}@${entry.version}: ${e.message}`);
    return errors;
  }

  const assetByName = new Map((release.assets ?? []).map((a) => [a.name, a]));
  const manifestAsset = assetByName.get("manifest.json");
  if (!manifestAsset) {
    errors.push(`${file}: release ${entry.version} has no manifest.json asset`);
    return errors;
  }

  let manifest;
  try {
    const bytes = await fetchBytes(manifestAsset.browser_download_url);
    manifest = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (e) {
    errors.push(`${file}: couldn't read/parse manifest.json: ${e.message}`);
    return errors;
  }

  for (const field of ["slug", "name", "version", "kind", "entryPoint"]) {
    if (!manifest[field]) errors.push(`${file}: release manifest.json is missing "${field}"`);
  }
  if (manifest.slug && manifest.slug !== entry.slug) {
    errors.push(`${file}: manifest.json slug "${manifest.slug}" doesn't match registry entry slug "${entry.slug}"`);
  }

  const wasmAsset = manifest.entryPoint ? assetByName.get(manifest.entryPoint) : undefined;
  if (manifest.entryPoint && !wasmAsset) {
    errors.push(`${file}: release ${entry.version} has no "${manifest.entryPoint}" asset (manifest.json's entryPoint)`);
    return errors;
  }
  if (wasmAsset) {
    let wasmBytes;
    try {
      wasmBytes = await fetchBytes(wasmAsset.browser_download_url);
    } catch (e) {
      errors.push(`${file}: couldn't download ${manifest.entryPoint}: ${e.message}`);
      return errors;
    }
    const actual = `sha256:${createHash("sha256").update(wasmBytes).digest("hex")}`;
    if (actual !== entry.checksum) {
      errors.push(`${file}: checksum mismatch for ${manifest.entryPoint} — entry says ${entry.checksum}, actual is ${actual}`);
    }
  }

  return errors;
}

async function main() {
  const files = (await readdir(PLUGINS_DIR)).filter((f) => f.endsWith(".json"));
  const entries = [];
  let errors = [];

  for (const file of files) {
    let entry;
    try {
      entry = JSON.parse(await readFile(join(new URL(PLUGINS_DIR).pathname, file), "utf8"));
    } catch (e) {
      errors.push(`${file}: invalid JSON: ${e.message}`);
      continue;
    }
    errors.push(...validateShape(entry, file));
    entries.push({ file, entry });
  }

  const slugCounts = new Map();
  for (const { file, entry } of entries) {
    if (!entry.slug) continue;
    slugCounts.set(entry.slug, [...(slugCounts.get(entry.slug) ?? []), file]);
  }
  for (const [slug, files] of slugCounts) {
    if (files.length > 1) errors.push(`Duplicate slug "${slug}" used by: ${files.join(", ")}`);
  }

  for (const { file, entry } of entries) {
    if (validateShape(entry, file).length > 0) continue; // already reported, skip the network round trip
    errors.push(...(await validateRelease(entry, file)));
  }

  if (errors.length > 0) {
    console.error(`${errors.length} problem(s) found:\n`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${entries.length} registry entr${entries.length === 1 ? "y" : "ies"} validated OK.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
