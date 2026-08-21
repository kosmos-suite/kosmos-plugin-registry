# kosmos-plugin-registry

A discovery index for [Kosmos](https://github.com/kosmos-suite/kosmos) WASM plugins — one JSON file
per plugin under `plugins/`, each pointing at the plugin author's own GitHub repository rather
than mirroring the actual `.wasm` binary here. Kosmos's own security boundary is the WASM sandbox
itself (`plugins.PluginHost` enforces a per-plugin `allowedHosts` allowlist, no filesystem, no
other imports) — this registry's job is purely discovery and integrity, not review of what a
plugin's code actually does.

## How it works

1. A plugin author builds a plugin against one of the `kosmos-plugin-sdk-*` SDKs, in their own
   repository.
2. They cut a GitHub release whose tag is the plugin's version, with two required assets attached:
   `manifest.json` and the `.wasm` file it names as `entryPoint`.
3. They open a PR here adding `plugins/<slug>.json` — see `schema/entry.schema.json` for the exact
   fields, and `CONTRIBUTING.md` for the process.
4. CI (`scripts/validate.mjs`) fetches that exact tagged release, confirms both assets exist,
   parses `manifest.json`, and checks the `.wasm` asset's sha256 against the checksum the entry
   claims. A PR that doesn't match what it claims fails CI automatically.

## Why pin an exact version + checksum instead of "latest release"

So that getting listed once isn't a standing ability to silently swap what gets installed later.
An entry only ever resolves to the exact release it was reviewed against; shipping a new plugin
version means a new PR (updating `version` and `checksum` together), the same model
Homebrew/Scoop use for their own package manifests. Kosmos re-checks the checksum again at install
time, not just CI — the registry entry is a real integrity anchor, not just a display label.

## Status

Empty as of 2026-08-21 — no plugins have a tagged release yet to register against. The validator
is tested against real GitHub API calls for its error paths (malformed entry, duplicate slug,
nonexistent release); the full success path is untested until a first real entry exists.
