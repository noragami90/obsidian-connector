import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/**
 * Safe accessor for an Obsidian vault on disk.
 *
 * Every public method that takes a note path runs it through `resolve()`,
 * which guarantees the final absolute path stays inside the vault root.
 * This is the single security boundary of the connector: no tool can read or
 * write outside the folder the user explicitly configured.
 *
 * Raw file contents are memoised by mtime so repeated whole-vault scans
 * (search, list_tags, backlinks) don't re-read unchanged files. Any write
 * clears the cache.
 */
export class Vault {
  readonly root: string;
  private cache = new Map<string, { mtimeMs: number; raw: string }>();

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

  private invalidate(): void {
    this.cache.clear();
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

  async stat(relPath: string) {
    return fs.stat(this.resolve(relPath));
  }

  /** Read a note's raw text, memoised by mtime. */
  async readNote(relPath: string): Promise<string> {
    const abs = this.resolve(relPath);
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(abs)).mtimeMs;
    } catch {
      return fs.readFile(abs, "utf8"); // let the read throw a clear ENOENT
    }
    const hit = this.cache.get(abs);
    if (hit && hit.mtimeMs === mtimeMs) return hit.raw;
    const raw = await fs.readFile(abs, "utf8");
    this.cache.set(abs, { mtimeMs, raw });
    return raw;
  }

  /** Parse a note into frontmatter + body. */
  async readParsed(relPath: string): Promise<{ data: Record<string, unknown>; body: string }> {
    const parsed = matter(await this.readNote(relPath));
    return { data: parsed.data as Record<string, unknown>, body: parsed.content };
  }

  /** Write a note, creating parent folders as needed. */
  async writeNote(relPath: string, content: string): Promise<void> {
    const abs = this.resolve(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    this.invalidate();
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
    this.invalidate();
  }

  /** Move a file into the vault's `.trash` folder (Obsidian-style soft delete). */
  async deleteToTrash(relPath: string): Promise<string> {
    const abs = this.resolve(relPath);
    const base = path.basename(abs);
    const trashDir = this.resolve(".trash");
    await fs.mkdir(trashDir, { recursive: true });

    let dest = path.join(trashDir, base);
    let n = 1;
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    while (await fileExists(dest)) {
      dest = path.join(trashDir, `${stem} (${n})${ext}`);
      n++;
    }
    await fs.rename(abs, dest);
    this.invalidate();
    return this.toRel(dest);
  }

  /** Rename/move a note. Refuses to clobber an existing file unless `overwrite`. */
  async move(oldRel: string, newRel: string, overwrite = false): Promise<void> {
    const from = this.resolve(oldRel);
    const to = this.resolve(newRel);
    if (!overwrite && (await fileExists(to))) {
      throw new Error(`Target already exists: ${this.toRel(to)}`);
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    this.invalidate();
  }

  /** Compose a note from frontmatter + body. */
  static compose(frontmatter: Record<string, unknown> | undefined, body: string): string {
    if (frontmatter && Object.keys(frontmatter).length > 0) {
      return matter.stringify(body, frontmatter);
    }
    return body.endsWith("\n") ? body : body + "\n";
  }
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Insert `text` immediately after the given heading line. If the heading is
 * not found, the heading and text are appended to the end of the document.
 */
export function insertUnderHeading(content: string, heading: string, text: string): string {
  const lines = content.split("\n");
  const sec = findSection(lines, heading);
  const block = text.endsWith("\n") ? text.slice(0, -1) : text;

  if (!sec) {
    const sep = content.length === 0 || content.endsWith("\n") ? "" : "\n";
    return `${content}${sep}\n## ${heading.replace(/^#+\s*/, "")}\n${block}\n`;
  }
  let insertAt = sec.end;
  while (insertAt > sec.index + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, block);
  return lines.join("\n");
}

interface Section {
  index: number; // line index of the heading
  level: number;
  end: number; // exclusive line index where the section ends
}

/** Locate a heading by its text (with or without leading #), case-insensitive. */
function findSection(lines: string[], heading: string): Section | null {
  const wanted = heading.replace(/^#+\s*/, "").trim().toLowerCase();
  let index = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (m && m[2].trim().toLowerCase() === wanted) {
      index = i;
      level = m[1].length;
      break;
    }
  }
  if (index === -1) return null;
  let end = lines.length;
  for (let i = index + 1; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return { index, level, end };
}

/** Return the text of a heading's section (heading line + body), or null. */
export function extractSection(content: string, heading: string): string | null {
  const lines = content.split("\n");
  const sec = findSection(lines, heading);
  if (!sec) return null;
  return lines.slice(sec.index, sec.end).join("\n").replace(/\s+$/, "");
}

/** Replace the body under a heading (keeping the heading line). Appends if missing. */
export function replaceSection(content: string, heading: string, newBody: string): string {
  const lines = content.split("\n");
  const sec = findSection(lines, heading);
  const bodyLines = newBody.replace(/\s+$/, "").split("\n");
  if (!sec) {
    const sep = content.length === 0 || content.endsWith("\n") ? "" : "\n";
    return `${content}${sep}\n## ${heading.replace(/^#+\s*/, "")}\n${bodyLines.join("\n")}\n`;
  }
  lines.splice(sec.index + 1, sec.end - (sec.index + 1), ...bodyLines);
  return lines.join("\n");
}

/** Extract a line range (1-based, inclusive) from content. */
export function sliceLines(content: string, from?: number, to?: number): string {
  if (from == null && to == null) return content;
  const lines = content.split("\n");
  const start = Math.max(1, from ?? 1) - 1;
  const end = Math.min(lines.length, to ?? lines.length);
  return lines.slice(start, end).join("\n");
}

/** Extract inline `#tags` and frontmatter `tags:` from a parsed note. */
export function collectTags(data: Record<string, unknown>, body: string): string[] {
  const tags = new Set<string>();
  const fmTags = data.tags ?? (data as Record<string, unknown>).tag;
  if (Array.isArray(fmTags)) for (const t of fmTags) tags.add(String(t).replace(/^#/, ""));
  else if (typeof fmTags === "string") for (const t of fmTags.split(/[,\s]+/)) if (t) tags.add(t.replace(/^#/, ""));
  // strip code spans/fences to avoid false positives from `#hex` etc. is overkill; keep simple
  for (const m of body.matchAll(/(?:^|\s)#([A-Za-z0-9_][\w\/-]*)/g)) tags.add(m[1]);
  return [...tags];
}

export interface WikiLink {
  embed: boolean;
  target: string;
  heading?: string;
  alias?: string;
  raw: string;
}

/** Parse `[[wikilinks]]` and `![[embeds]]` from note body. */
export function parseLinks(body: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of body.matchAll(/(!?)\[\[\s*([^\]\n]+?)\s*\]\]/g)) {
    const embed = m[1] === "!";
    let inner = m[2];
    let alias: string | undefined;
    const pipe = inner.indexOf("|");
    if (pipe >= 0) {
      alias = inner.slice(pipe + 1).trim();
      inner = inner.slice(0, pipe);
    }
    let heading: string | undefined;
    const hash = inner.indexOf("#");
    if (hash >= 0) {
      heading = inner.slice(hash + 1).trim();
      inner = inner.slice(0, hash);
    }
    out.push({ embed, target: inner.trim(), heading, alias, raw: m[0] });
  }
  return out;
}

export interface Task {
  line: number; // 1-based
  checked: boolean;
  mark: string;
  text: string;
}

/** Parse Markdown task checkboxes (`- [ ]` / `- [x]`). */
export function parseTasks(body: string): Task[] {
  const out: Task[] = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*[-*+]\s+\[([ xX/\-])\]\s+(.*)$/);
    if (m) out.push({ line: i + 1, checked: /[xX]/.test(m[1]), mark: m[1], text: m[2].trim() });
  }
  return out;
}

/** Toggle the checkbox on a given 1-based line. Returns the new content or throws. */
export function toggleTaskLine(content: string, line: number): { content: string; checked: boolean } {
  const lines = content.split("\n");
  if (line < 1 || line > lines.length) throw new Error(`Line ${line} is out of range`);
  const m = lines[line - 1].match(/^(\s*[-*+]\s+)\[([ xX/\-])\](\s+.*)$/);
  if (!m) throw new Error(`Line ${line} is not a task checkbox`);
  const nowChecked = !/[xX]/.test(m[2]);
  lines[line - 1] = `${m[1]}[${nowChecked ? "x" : " "}]${m[3]}`;
  return { content: lines.join("\n"), checked: nowChecked };
}

/**
 * Rewrite `[[wikilinks]]`/`![[embeds]]` that point at a renamed/moved note.
 * Matches links by basename or by full vault path (without extension).
 */
export function updateLinksForMove(content: string, oldRel: string, newRel: string): string {
  const noExt = (p: string) => p.replace(/\\/g, "/").replace(/\.md$/i, "");
  const oldPath = noExt(oldRel);
  const oldBase = oldPath.split("/").pop()!;
  const newPath = noExt(newRel);
  const newBase = newPath.split("/").pop()!;
  const norm = (s: string) => s.trim().replace(/\.md$/i, "").toLowerCase();

  return content.replace(/(!?)\[\[\s*([^\]\n]+?)\s*\]\]/g, (full, bang, inner) => {
    const pipe = inner.indexOf("|");
    const aliasPart = pipe >= 0 ? inner.slice(pipe) : "";
    const beforeAlias = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const hash = beforeAlias.indexOf("#");
    const headingPart = hash >= 0 ? beforeAlias.slice(hash) : "";
    const target = (hash >= 0 ? beforeAlias.slice(0, hash) : beforeAlias).trim();

    const t = norm(target);
    if (t !== norm(oldBase) && t !== norm(oldPath)) return full;
    const replacement = target.includes("/") ? newPath : newBase;
    return `${bang}[[${replacement}${headingPart}${aliasPart}]]`;
  });
}

/** ISO-8601 week number for a date. */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fdNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

/**
 * Format a Date with a small Moment-like token set: YYYY, MM, DD, WW, W.
 * Text inside [square brackets] is emitted literally (e.g. `YYYY-[W]WW`).
 */
export function formatDate(d: Date, fmt = "YYYY-MM-DD"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    WW: pad(isoWeek(d)),
    W: String(isoWeek(d)),
  };
  const order = ["YYYY", "MM", "DD", "WW", "W"];
  let out = "";
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] === "[") {
      const j = fmt.indexOf("]", i);
      if (j >= 0) {
        out += fmt.slice(i + 1, j);
        i = j + 1;
        continue;
      }
    }
    const tk = order.find((t) => fmt.startsWith(t, i));
    if (tk) {
      out += tokens[tk];
      i += tk.length;
      continue;
    }
    out += fmt[i];
    i++;
  }
  return out;
}
