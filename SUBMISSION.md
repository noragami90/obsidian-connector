# Desktop Extension — Directory Submission Packet

Copy-paste material for `clau.de/desktop-extention-submission`.

---

## Basics

| Field | Value |
|-------|-------|
| **Extension name** | Vault Connector for Obsidian |
| **Version** | 0.1.0 |
| **Author** | Anton Shesterov (GitHub: noragami90) |
| **License** | MIT |
| **Category** | Productivity / Note-taking & Knowledge management |
| **Platforms** | macOS, Windows, Linux |
| **Runtime** | Node.js (bundled, single-file) |
| **Source repository** | https://github.com/noragami90/obsidian-connector |
| **Download (.mcpb)** | https://github.com/noragami90/obsidian-connector/releases/tag/v0.1.0 |
| **Support channel** | https://github.com/noragami90/obsidian-connector/issues |

---

## Short description (tagline, ~1 line)

Read, write and search your Obsidian vault from Claude — works directly with Markdown files on disk, no plugins required.

> Independent project, not affiliated with or endorsed by Obsidian. "Obsidian" is a trademark of Dynalist Inc.; used here only to describe compatibility.

## Long description

A local connector that lets Claude work with any Obsidian vault. It reads and writes Markdown
files directly on disk, so it works whether or not Obsidian is running and needs no community
plugins. Point it at your vault folder and Claude can list, read, search, create and append to
notes, follow `[[wikilinks]]` for backlinks, maintain daily notes, and edit YAML frontmatter.
All file access is sandboxed to the single folder you configure — the server refuses any path
that would escape it.

---

## Tools (9) — with access classification

| Tool | Access | What it does |
|------|--------|--------------|
| `list_notes` | read-only | List Markdown notes, optionally within a folder |
| `list_folders` | read-only | List sub-folders of the vault or a folder |
| `read_note` | read-only | Read the full content of a note |
| `search_notes` | read-only | Full-text and `#tag` search across the vault |
| `get_backlinks` | read-only | Find notes linking to a target via `[[wikilinks]]` |
| `create_note` | write (non-destructive) | Create a note with optional YAML frontmatter; refuses to overwrite unless asked |
| `append_to_note` | write (non-destructive) | Append text to a note, optionally under a heading |
| `append_to_daily_note` | write (non-destructive) | Append an entry to today's (or a given date's) daily note |
| `update_frontmatter` | write (idempotent) | Set or remove YAML frontmatter fields without touching the body |

Every tool declares a `title` and the appropriate `readOnlyHint` / `destructiveHint` annotation
in its MCP metadata. No tool deletes notes or performs destructive operations.

---

## User configuration

| Setting | Required | Purpose |
|---------|----------|---------|
| Vault folder | yes | Absolute path to the Obsidian vault; all access is limited to this folder |
| Daily notes folder | no | Vault-relative folder for daily notes (default: vault root) |
| Daily note date format | no | Filename format using `YYYY`/`MM`/`DD` (default: `YYYY-MM-DD`) |

---

## Privacy & data handling

- **Fully local.** The connector only reads and writes files inside the user-configured vault
  folder on the local machine.
- **No network access.** It makes no outbound network requests, sends no telemetry, and has no
  analytics or external dependencies at runtime.
- **No data collection.** Nothing leaves the user's device.
- **Sandboxed.** Every path is resolved and validated against the vault root; path traversal
  (`../`) outside the vault is rejected.

## Permissions requested

- Local filesystem read/write, restricted to the configured vault folder.

---

## Testing notes (for reviewers)

- Build: `npm install && npm run build` (TypeScript type-check + esbuild single-file bundle).
- The packaged `.mcpb` contains only the bundled `dist/index.js`, `manifest.json`, `icon.png`,
  `package.json` and `README.md` — no `node_modules`.
- Inspect locally: `npm run inspect` (MCP Inspector), or add to `claude_desktop_config.json`
  with `OBSIDIAN_VAULT_PATH` pointing at a test vault.
- Verified end-to-end against a real vault: read tools (list/search/backlinks) and write tools
  (create/append/daily-note/frontmatter) all function over MCP stdio.
