# Obsidian Connector

A local [MCP](https://modelcontextprotocol.io) connector that lets Claude read, write and
search any [Obsidian](https://obsidian.md) vault. It works **directly with the Markdown files
on disk** — no community plugins, and Obsidian does not need to be running.

All access is sandboxed to the single vault folder you configure; the server refuses any path
that would escape it.

## Tools

| Tool | Access | Description |
|------|--------|-------------|
| `list_notes` | read | List Markdown notes, optionally within a folder |
| `list_folders` | read | List sub-folders of the vault or a folder |
| `read_note` | read | Read the full content of a note |
| `search_notes` | read | Full-text and `#tag` search across the vault |
| `get_backlinks` | read | Find notes linking to a target via `[[wikilinks]]` |
| `create_note` | write | Create a note with optional YAML frontmatter |
| `append_to_note` | write | Append text to a note, optionally under a heading |
| `append_to_daily_note` | write | Append an entry to today's (or a given date's) daily note |
| `update_frontmatter` | write | Set or remove YAML frontmatter fields |

## Configuration

The server is configured through environment variables (set automatically from the connector
settings when installed as a Desktop Extension):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OBSIDIAN_VAULT_PATH` | yes | — | Absolute path to the vault folder |
| `OBSIDIAN_DAILY_FOLDER` | no | `` (root) | Vault-relative folder for daily notes |
| `OBSIDIAN_DAILY_FORMAT` | no | `YYYY-MM-DD` | Daily-note filename format (`YYYY`/`MM`/`DD`) |

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
