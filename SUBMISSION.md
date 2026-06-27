# Desktop Extension — Directory Submission Packet

Copy-paste material for `clau.de/desktop-extention-submission`.

---

## Basics

| Field | Value |
|-------|-------|
| **Extension name** | Vault Connector for Obsidian |
| **Version** | 0.2.0 |
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

## Tools (20) — with access classification

| Tool | Access | What it does |
|------|--------|--------------|
| `list_notes` | read-only | List Markdown notes, optionally within a folder |
| `list_folders` | read-only | List sub-folders of the vault or a folder |
| `read_note` | read-only | Read a note, or just a heading's section / line range |
| `get_note_info` | read-only | Note metadata: dates, size, tags, link & task counts |
| `search_notes` | read-only | Text or regex search with `#tag` and path-glob filters |
| `list_tags` | read-only | List all tags with usage counts |
| `get_backlinks` | read-only | Find notes linking to a target via `[[wikilinks]]` |
| `get_outgoing_links` | read-only | List a note's links, flagging unresolved ones |
| `list_tasks` | read-only | List task checkboxes with file and line |
| `read_periodic_note` | read-only | Read a daily/weekly/monthly note |
| `create_note` | write (non-destructive) | Create a note; refuses to overwrite unless asked |
| `append_to_note` | write (non-destructive) | Append text, optionally under a heading |
| `edit_note` | write (non-destructive) | Find/replace text, or rewrite a heading's section |
| `update_frontmatter` | write (idempotent) | Set or remove YAML frontmatter fields |
| `toggle_task` | write (non-destructive) | Toggle a task checkbox on a line |
| `move_note` | write (non-destructive) | Move/rename a note and rewrite backlinks |
| `append_to_daily_note` | write (non-destructive) | Append to a daily note |
| `append_to_periodic_note` | write (non-destructive) | Append to a daily/weekly/monthly note |
| `create_note_from_template` | write (non-destructive) | Create a note from a template |
| `delete_note` | **write (destructive)** | Move a note to the vault's `.trash` (recoverable) |

Every tool declares a `title` and the appropriate `readOnlyHint` / `destructiveHint` annotation
in its MCP metadata. The only destructive tool is `delete_note`, and it performs a recoverable
move to `.trash` rather than a permanent delete. Also exposes MCP prompts (`summarize_note`,
`daily_review`) and a `vault-structure` resource.

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
