# Adding a plugin

1. Your plugin's repository needs a GitHub release whose **tag is the version** you're
   registering, with exactly two required assets attached:
   - `manifest.json` — the plugin's manifest (`slug`/`name`/`version`/`kind`/`entryPoint`/
     `permissions.allowedHosts`)
   - the `.wasm` file `manifest.json`'s `entryPoint` names

2. Compute its checksum:

   ```shell
   shasum -a 256 your-plugin.wasm
   ```

3. Add `plugins/<slug>.json` in this repo (`<slug>` must match `manifest.json`'s own `slug`
   exactly) — see `schema/entry.schema.json` for the required fields:

   ```json
   {
     "slug": "your-plugin",
     "name": "Your Plugin",
     "description": "One sentence, shown in the browse UI.",
     "category": "Metadata",
     "publisher": "Your Name",
     "repository": "your-github-username/your-plugin-repo",
     "version": "v1.0.0",
     "checksum": "sha256:<the checksum from step 2>"
   }
   ```

4. Open a PR. CI fetches your pinned release, confirms both assets exist, and checks the checksum
   for real — a mismatch fails the check with a specific reason, not a generic error.

## Updating a plugin

Bump `version` and `checksum` together in the same PR, pointing at a new release tag. The old
version stops being what the registry resolves to; there's no way to update in place without
review.
