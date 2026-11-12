# vault memory

External port of `BankAndVaultMemory`. Enable **vault memory** in
the client's plugin settings. **Gather memory on entry** is enabled by default;
visiting Gomald's private or guild vault starts a scan. Disabling this setting cancels
an active scan and leaves saved memories available for recall. Bank memory continues
to update independently.
Bank balances are remembered from the native status bar and appended to subsequent
status updates outside the bank. **Show bank balance outside the bank** controls the
appended balance and is enabled by default. Changes appear on the next status update;
the bank's native balance is still shown and remembered when the setting is off.

## Installation

Build with Node 22.12 or newer and the pnpm version pinned in `package.json`:

```bash
pnpm install --frozen-lockfile
pnpm build
```

Copy `package.json` and the complete `dist` directory into one plugin folder:

```text
plugins/duplicis-plugin-vault-memory/
  package.json
  dist/
    index.js
```

For a packaged client, put `plugins` beside the Duplicis executable. With `pnpm start`
from the Duplicis repository, use `apps/client/plugins`. Restart the client to discover it.
The plugin requires the client's public utility API and built-in chat system. It shares
those runtimes through the client import map and does not bundle another client runtime.

The package and runtime identity remains `@duplicis/plugin-bank-vault-memory` so the
previous built-in plugin's enabled state, settings, and per-character saved memories are
reused. Its repository and submodule directory are named `duplicis-plugin-vault-memory`
and `packages/plugin-vault-memory`. Use a client that no longer bundles the built-in;
do not install duplicate copies of the plugin.

When working in a Duplicis checkout that includes this repository as a submodule, run
`pnpm start:external` from the client root to build/watch it and start the development
client with a temporary installation. Restart that command to load rebuilt bundles.

## Development and tests

The plugin builds and type-checks with its public GitHub-pinned `@duplicis/types` dependency:

```bash
pnpm build
pnpm lint:tsc
pnpm format
pnpm format-check
```

Tests live in the Duplicis repository and use its existing Vitest, Playwright, and Electron
fixtures. Initialize the submodules and install dependencies once at the Duplicis root.
Run these commands from that root:

```bash
pnpm test:unit test/unit/vault-memory
pnpm build
pnpm test:e2e vault-memory
```

The first command runs memory parsing and controller integration tests in `test/unit`.
Build the workspace before running Electron tests. The last command runs
`test/e2e/src/spec/vault-memory.test.ts`.
Electron tests install the emitted external bundle in temporary storage and verify identity,
persistence, profiles, settings, commands, and teardown without touching a player's database.
These tests also participate in the client's normal unit and Electron suites.
No separate test dependency installation, client path discovery, or test runner script is needed
in this submodule. For a focused Electron run after building, use
`pnpm -C test/e2e test vault-memory --grep "external plugin"` from the client root.

## Recall commands

Local commands (case-insensitive):

- `vaultmemory` / `vaultmem` / `vm`: recall the private vault's category list.
- `gvaultmemory` / `gvaultmem` / `gvm`: recall the guild vault.
- Add `items`, `gold`, `lastUpdate`, or a category, e.g. `vaultmemory scrolls`.

The **Vault command prefix regex** and **Guild vault command prefix regex** settings
change the two command prefixes independently. Defaults are `vaultmemory|vaultmem|vm`
and `gvaultmemory|gvaultmem|gvm`. Prefixes are case-insensitive, matched from the start
of the command, and automatically accept an optional category after a space. For
example, `stash|storage` supports `stash gold` and `storage scrolls`. Invalid or
empty-matching regexes keep the last valid pattern (or the defaults on startup).
These settings persist per profile.

Category lookup prefers an exact match, then a partial match, with singular/plural
matching. Arguments are treated as text rather than executable regular expressions.
Recall commands are consumed locally. Shared chat dismisses the native menu using
the current session's Escape adapter and preserves the recall hint through the server clear.

## Server behavior

The plugin sends the same native speech commands as the override: `vaultinventory`,
then `vaultinventory <category>` for each category in the server's overview. It uses
the supported native buffered-text transport, preserving the user's local draft.
Gold and the overall item count are excluded from category requests.

Each next category request follows the previous native response after a
200 ms delay, including the extra zero-length pause at every sixth overview
position. The initial overview request is immediate. There are no automatic retries;
each dispatched request has a five-second response deadline. Escape, zoning, disconnect,
character changes, server prompts, unrelated menus, and plugin exit cancel pending
work. Unrecognized replies leave the native menu visible and the prior memory intact.
Only a complete scan replaces the saved vault. Private and guild inventories remain
separate. Original server text is retained for recall.
Returning to the bank during a scan shows `Exited Vault` / `Vault Memory Update Aborted!`
in the hint window, including when zoning clears the screen before the bank status arrives.

During a scan, recognized inventory responses are replaced before drawing with
`Updating Vault Memory: X of Y`, followed by `Vault Memory Updated.` on completion.
The placeholder also survives native hint clears between requests. Original server
responses are still used for storage and parsing; unrelated menus remain untouched.

The protocol has no request IDs. Replies are checked against the active vault and
requested category, and duplicate overview replies are ignored. Fixture tests verify
this behavior; live server response wording and pacing still need in-game verification.

## Persistence

One versioned record per character uses the existing SQLite-backed `Plugin.config`
API, scoped to the current client profile and this plugin. Internal bindings are
hidden from settings. Writes are serialized and awaited on exit. Gold is stored as
text to preserve large balances. The last completed inventory survives failed or
canceled scans.
