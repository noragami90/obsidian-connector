# Vault Connector for Obsidian

A local [MCP](https://modelcontextprotocol.io) connector that lets Claude read, write and
search any [Obsidian](https://obsidian.md) vault. It works **directly with the Markdown files
on disk** — no community plugins, and Obsidian does not need to be running.

> Independent project, not affiliated with or endorsed by Obsidian. "Obsidian" is a trademark of Dynalist Inc.

All access is sandboxed to the single vault folder you configure; the server refuses any path
that would escape it.

## Tools

| Tool | Access | Description |
|------|--------|-------------|
| `list_notes` | read | List Markdown notes, optionally within a folder |
| `list_folders` | read | List sub-folders of the vault or a folder |
| `read_note` | read | Read a note — or just one heading's section / a line range |
| `get_note_info` | read | Note metadata: dates, size, tags, link & task counts |
| `search_notes` | read | Text or regex search, with `#tag` and path-glob filters |
| `list_tags` | read | List every tag in the vault with usage counts |
| `get_backlinks` | read | Find notes linking to a target via `[[wikilinks]]` |
| `get_outgoing_links` | read | List links a note points to, flagging unresolved ones |
| `list_tasks` | read | List task checkboxes (`- [ ]`) with file and line |
| `create_note` | write | Create a note with optional YAML frontmatter |
| `append_to_note` | write | Append text to a note, optionally under a heading |
| `edit_note` | write | Find/replace text, or rewrite a heading's section |
| `update_frontmatter` | write | Set or remove YAML frontmatter fields |
| `toggle_task` | write | Toggle a task checkbox on a given line |
| `move_note` | write | Move/rename a note and rewrite `[[wikilinks]]` to it |
| `delete_note` | write (destructive) | Move a note to the vault's `.trash` (recoverable) |
| `append_to_daily_note` | write | Append an entry to today's (or a given date's) daily note |
| `append_to_periodic_note` | write | Append to a daily, weekly or monthly note |
| `read_periodic_note` | read | Read a daily, weekly or monthly note |
| `create_note_from_template` | write | Create a note from a template with `{{variable}}` substitution |

Also exposes MCP **prompts** (`summarize_note`, `daily_review`) and a **resource**
(`obsidian://vault/structure`) describing the vault layout.

## Configuration

The server is configured through environment variables (set automatically from the connector
settings when installed as a Desktop Extension):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OBSIDIAN_VAULT_PATH` | yes | — | Absolute path to the vault folder |
| `OBSIDIAN_DAILY_FOLDER` | no | `` (root) | Vault-relative folder for daily notes |
| `OBSIDIAN_DAILY_FORMAT` | no | `YYYY-MM-DD` | Daily-note filename format |
| `OBSIDIAN_WEEKLY_FOLDER` | no | daily folder | Folder for weekly notes |
| `OBSIDIAN_WEEKLY_FORMAT` | no | `YYYY-[W]WW` | Weekly-note format (`WW` = ISO week; `[..]` = literal) |
| `OBSIDIAN_MONTHLY_FOLDER` | no | daily folder | Folder for monthly notes |
| `OBSIDIAN_MONTHLY_FORMAT` | no | `YYYY-MM` | Monthly-note filename format |
| `OBSIDIAN_TEMPLATES_FOLDER` | no | `` (root) | Folder holding note templates |

## Development

```bash
npm install
npm run build         # compile TypeScript to dist/
npm run inspect       # open the MCP Inspector against the server
```

### Try it locally in Claude Desktop

Add to `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/Vault",
        "OBSIDIAN_DAILY_FOLDER": "Log"
      }
    }
  }
}
```

### Package as a Desktop Extension (`.mcpb`)

```bash
npm run pack          # builds and produces obsidian-connector.mcpb
```

The resulting `.mcpb` can be installed in Claude Desktop with one click, or submitted to the
[Claude connector directory](https://claude.com/docs/connectors/building/submission) via the
Desktop Extension submission form.

## License

MIT
