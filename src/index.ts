#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Vault, collectTags, formatDate } from "./vault.js";

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;
const DAILY_FOLDER = process.env.OBSIDIAN_DAILY_FOLDER ?? "";
const DAILY_FORMAT = process.env.OBSIDIAN_DAILY_FORMAT ?? "YYYY-MM-DD";

if (!VAULT_PATH) {
  console.error(
    "OBSIDIAN_VAULT_PATH is not set. Configure the vault folder in the connector settings."
  );
  process.exit(1);
}

const vault = new Vault(VAULT_PATH);

const server = new McpServer({
  name: "obsidian-connector",
  version: "0.1.0",
});

/** Wrap a plain string into the MCP tool-result shape. */
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

// ─────────────────────────────────────────────────────────── read-only tools

server.registerTool(
  "list_notes",
  {
    title: "List notes",
    description:
      "List Markdown notes in the vault, optionally limited to a sub-folder. Returns vault-relative paths.",
    inputSchema: {
      folder: z.string().optional().describe("Vault-relative folder to list (default: whole vault)"),
      recursive: z.boolean().optional().describe("Recurse into sub-folders (default: true)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ folder, recursive }) => {
    try {
      const notes = await vault.listMarkdown(folder ?? "", recursive ?? true);
      return text(notes.length ? notes.join("\n") : "(no notes found)");
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "list_folders",
  {
    title: "List folders",
    description: "List immediate sub-folders of the vault or a given folder.",
    inputSchema: {
      folder: z.string().optional().describe("Vault-relative parent folder (default: vault root)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ folder }) => {
    try {
      const folders = await vault.listFolders(folder ?? "");
      return text(folders.length ? folders.join("\n") : "(no sub-folders)");
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "read_note",
  {
    title: "Read note",
    description: "Read the full Markdown content of a single note by its vault-relative path.",
    inputSchema: {
      path: z.string().describe("Vault-relative path to the note, e.g. 'Projects/Plan.md'"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ path: p }) => {
    try {
      return text(await vault.readNote(p));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "search_notes",
  {
    title: "Search notes",
    description:
      "Full-text search across the vault. Optionally filter by tag (frontmatter or inline #tag). Returns matching notes with a short snippet.",
    inputSchema: {
      query: z.string().optional().describe("Text to search for (case-insensitive)"),
      tag: z.string().optional().describe("Only notes carrying this tag (without '#')"),
      folder: z.string().optional().describe("Restrict search to this folder"),
      limit: z.number().int().positive().optional().describe("Max results (default: 20)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ query, tag, folder, limit }) => {
    try {
      const max = limit ?? 20;
      const q = query?.toLowerCase();
      const wantTag = tag?.replace(/^#/, "").toLowerCase();
      const files = await vault.listMarkdown(folder ?? "", true);
      const results: string[] = [];

      for (const file of files) {
        if (results.length >= max) break;
        const { data, body } = await vault.readParsed(file);

        if (wantTag) {
          const tags = collectTags(data, body).map((t) => t.toLowerCase());
          if (!tags.includes(wantTag)) continue;
        }

        if (q) {
          const hay = body.toLowerCase();
          const at = hay.indexOf(q);
          if (at === -1) continue;
          const start = Math.max(0, at - 40);
          const snippet = body.slice(start, at + q.length + 40).replace(/\s+/g, " ").trim();
          results.push(`${file}\n    …${snippet}…`);
        } else {
          results.push(file);
        }
      }
      return text(results.length ? results.join("\n") : "(no matches)");
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "get_backlinks",
  {
    title: "Get backlinks",
    description:
      "Find notes that link to the target note via [[wikilinks]]. Matches on the note's file name.",
    inputSchema: {
      path: z.string().describe("Vault-relative path of the target note"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ path: p }) => {
    try {
      const base = p.replace(/\\/g, "/").split("/").pop()!.replace(/\.md$/i, "");
      const re = new RegExp(`\\[\\[\\s*${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[|#][^\\]]*)?\\s*\\]\\]`, "i");
      const files = await vault.listMarkdown("", true);
      const hits: string[] = [];
      for (const file of files) {
        if (file === p) continue;
        const content = await vault.readNote(file);
        if (re.test(content)) hits.push(file);
      }
      return text(hits.length ? hits.join("\n") : "(no backlinks)");
    } catch (e) {
      return fail(e);
    }
  }
);

// ─────────────────────────────────────────────────────────────── write tools

server.registerTool(
  "create_note",
  {
    title: "Create note",
    description:
      "Create a new note with optional YAML frontmatter. Fails if the note already exists unless 'overwrite' is true.",
    inputSchema: {
      path: z.string().describe("Vault-relative path, e.g. 'Inbox/Idea.md'"),
      content: z.string().describe("Markdown body of the note"),
      frontmatter: z.record(z.any()).optional().describe("Optional YAML frontmatter as key/value pairs"),
      overwrite: z.boolean().optional().describe("Replace an existing note (default: false)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ path: p, content, frontmatter, overwrite }) => {
    try {
      const target = /\.md$/i.test(p) ? p : `${p}.md`;
      if (!overwrite && (await vault.exists(target))) {
        return fail(new Error(`Note already exists: ${target} (set overwrite=true to replace)`));
      }
      await vault.writeNote(target, Vault.compose(frontmatter, content));
      return text(`Created ${target}`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "append_to_note",
  {
    title: "Append to note",
    description:
      "Append text to a note, optionally under a specific Markdown heading. Creates the note if it does not exist.",
    inputSchema: {
      path: z.string().describe("Vault-relative path to the note"),
      content: z.string().describe("Text to append"),
      heading: z.string().optional().describe("Append under this heading (created at end if missing)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ path: p, content, heading }) => {
    try {
      const target = /\.md$/i.test(p) ? p : `${p}.md`;
      await vault.appendToNote(target, content, heading);
      return text(`Appended to ${target}`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "append_to_daily_note",
  {
    title: "Append to daily note",
    description:
      "Append a timestamped-friendly entry to today's daily note (or a given date). The note is created with a heading if missing. Folder and date format come from the connector settings.",
    inputSchema: {
      content: z.string().describe("Text to add to the daily note"),
      date: z.string().optional().describe("ISO date 'YYYY-MM-DD' (default: today)"),
      heading: z.string().optional().describe("Append under this heading within the daily note"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ content, date, heading }) => {
    try {
      const day = date ? new Date(date + "T00:00:00") : new Date();
      if (Number.isNaN(day.getTime())) return fail(new Error(`Invalid date: ${date}`));
      const stem = formatDate(day, DAILY_FORMAT);
      const rel = (DAILY_FOLDER ? DAILY_FOLDER.replace(/\/+$/, "") + "/" : "") + `${stem}.md`;
      if (!(await vault.exists(rel))) {
        await vault.writeNote(rel, `# ${stem}\n\n`);
      }
      await vault.appendToNote(rel, content, heading);
      return text(`Logged to ${rel}`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "update_frontmatter",
  {
    title: "Update frontmatter",
    description:
      "Set or remove YAML frontmatter fields on an existing note without touching its body.",
    inputSchema: {
      path: z.string().describe("Vault-relative path to the note"),
      set: z.record(z.any()).optional().describe("Fields to add or overwrite"),
      unset: z.array(z.string()).optional().describe("Field names to remove"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: p, set, unset }) => {
    try {
      const { data, body } = await vault.readParsed(p);
      const next = { ...data };
      if (set) for (const [k, v] of Object.entries(set)) next[k] = v;
      if (unset) for (const k of unset) delete next[k];
      await vault.writeNote(p, Vault.compose(next, body));
      return text(`Updated frontmatter on ${p}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ───────────────────────────────────────────────────────────────── bootstrap

async function main() {
  await vault.assertReady();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`obsidian-connector ready — vault: ${vault.root}`);
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
