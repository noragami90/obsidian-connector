import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

/**
 * Safe accessor for an Obsidian vault on disk.
 *
 * Every public method that takes a note path runs it through `resolve()`,
 * which guarantees the final absolute path stays inside the vault root.
 * This is the single security boundary of the connector: no tool can read or
 * write outside the folder the user explicitly configured.
 */
export class Vault {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resolve a vault-relative path to an absolute one, refusing path traversal. */
  resolve(relPath: string): string {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const abs = path.resolve(this.root, normalized);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Path escapes the vault: ${relPath}`);
    }
    return abs;
  }

  /** Vault-relative POSIX path for display. */
  toRel(absPath: string): string {
    return path.relative(this.root, absPath).replace(/\\/g, "/");
  }

  /** Ensure the configured root actually exists and is a directory. */
  async assertReady(): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(this.root);
    } catch {
      throw new Error(`Vault folder does not exist: ${this.root}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Vault path is not a folder: ${this.root}`);
    }
  }

  /** Recursively list every Markdown file under `folder` (vault-relative). */
  async listMarkdown(folder = "", recursive = true): Promise<string[]> {
    const start = this.resolve(folder);
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue; // skip .obsidian, .trash, etc.
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (recursive) await walk(abs);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          out.push(this.toRel(abs));
        }
      }
    };
    await walk(start);
    return out.sort();
  }

  /** List immediate sub-folders (vault-relative). */
  async listFolders(folder = ""): Promise<string[]> {
    const start = this.resolve(folder);
    let entries;
    try {
      entries = await fs.readdir(start, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => this.toRel(path.join(start, e.name)))
      .sort();
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.stat(this.resolve(relPath));
      return true;
    } catch {
      return false;
    }
  }

  async readNote(relPath: string): Promise<string> {
    return fs.readFile(this.resolve(relPath), "utf8");
  }

  /** Parse a note into frontmatter + body. */
  async readParsed(relPath: string): Promise<{ data: Record<string, unknown>; body: string }> {
    const raw = await this.readNote(relPath);
    const parsed = matter(raw);
    return { data: parsed.data as Record<string, unknown>, body: parsed.content };
  }

  /** Write a note, creating parent folders as needed. */
  async writeNote(relPath: string, content: string): Promise<void> {
    const abs = this.resolve(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }

  /** Append text to a note, optionally under a specific Markdown heading. */
  async appendToNote(relPath: string, text: string, underHeading?: string): Promise<void> {
    const abs = this.resolve(relPath);
    let current = "";
    if (await this.exists(relPath)) current = await fs.readFile(abs, "utf8");

    let next: string;
    if (underHeading) {
      next = insertUnderHeading(current, underHeading, text);
    } else {
      const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
      next = `${current}${sep}${text.endsWith("\n") ? text : text + "\n"}`;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, next, "utf8");
  }

  /** Compose a note from frontmatter + body. */
  static compose(frontmatter: Record<string, unknown> | undefined, body: string): string {
    if (frontmatter && Object.keys(frontmatter).length > 0) {
      return matter.stringify(body, frontmatter);
    }
    return body.endsWith("\n") ? body : body + "\n";
  }
}

/**
 * Insert `text` immediately after the given heading line. If the heading is
 * not found, the heading and text are appended to the end of the document.
 */
export function insertUnderHeading(content: string, heading: string, text: string): string {
  const lines = content.split("\n");
  const wanted = heading.replace(/^#+\s*/, "").trim().toLowerCase();
  const headingRe = /^(#{1,6})\s+(.*)$/;

  let idx = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[2].trim().toLowerCase() === wanted) {
      idx = i;
      level = m[1].length;
      break;
    }
  }

  const block = text.endsWith("\n") ? text.slice(0, -1) : text;

  if (idx === -1) {
    const sep = content.length === 0 || content.endsWith("\n") ? "" : "\n";
    return `${content}${sep}\n## ${heading.replace(/^#+\s*/, "")}\n${block}\n`;
  }

  // Find the end of this section (next heading of same or higher level).
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  // Insert just before the next section, after trimming trailing blanks.
  let insertAt = end;
  while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, block);
  return lines.join("\n");
}

/** Extract inline `#tags` and frontmatter `tags:` from a parsed note. */
export function collectTags(data: Record<string, unknown>, body: string): string[] {
  const tags = new Set<string>();
  const fmTags = data.tags;
  if (Array.isArray(fmTags)) for (const t of fmTags) tags.add(String(t).replace(/^#/, ""));
  else if (typeof fmTags === "string") for (const t of fmTags.split(/[,\s]+/)) if (t) tags.add(t.replace(/^#/, ""));
  for (const m of body.matchAll(/(?:^|\s)#([A-Za-z0-9_\/-]+)/g)) tags.add(m[1]);
  return [...tags];
}

/** Format a Date as a daily-note filename stem using a small token set. */
export function formatDate(d: Date, fmt = "YYYY-MM-DD"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return fmt
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()));
}
