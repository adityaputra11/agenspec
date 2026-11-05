/** One searchable section of an organization document. */
export interface OrganizationDocumentChunk {
  ordinal: number;
  /** Nearest heading path, such as "BAB X Pemutusan Hubungan Kerja › Pasal 31". Empty before the first heading. */
  heading: string;
  content: string;
}

export const ORGANIZATION_CHUNK_MAX_CHARS = 1_500;
export const ORGANIZATION_CHUNK_OVERLAP_CHARS = 200;

const BAB_PATTERN = /^BAB\s+[IVXLCDM]+\b/i;
const PASAL_PATTERN = /^Pasal\s+\d+[A-Za-z]?\b/i;
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

interface PathEntry {
  level: number;
  title: string;
}

/** Heading level and title of a line that starts a section, or null for body text. */
function headingOf(line: string): PathEntry | null {
  const trimmed = line.trim();
  const markdown = MARKDOWN_HEADING.exec(trimmed);
  if (markdown) return { level: markdown[1]!.length, title: markdown[2]!.trim() };
  if (BAB_PATTERN.test(trimmed)) return { level: 1, title: trimmed };
  if (PASAL_PATTERN.test(trimmed)) return { level: 2, title: trimmed };
  return null;
}

/** Splits text into sections at BAB, Pasal and Markdown headings, then bounds each by size. */
export function chunkOrganizationDocument(text: string): OrganizationDocumentChunk[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const sections: Array<{ heading: string; body: string }> = [];
  let path: PathEntry[] = [];
  let heading = "";
  let body: string[] = [];
  // A heading with no text under it is not a section worth a chunk.
  const flush = () => {
    const content = body.join("\n").trim();
    const hasText = body.some((line, index) => line.trim() && (index > 0 || !headingOf(line)));
    if (content && hasText) sections.push({ heading, body: content });
  };
  for (const line of normalized.split("\n")) {
    const entry = headingOf(line);
    if (!entry) {
      body.push(line);
      continue;
    }
    flush();
    body = [line];
    path = [...path.filter((item) => item.level < entry.level), entry];
    heading = path.map((item) => item.title).join(" › ");
  }
  flush();

  const chunks: OrganizationDocumentChunk[] = [];
  for (const section of sections) {
    for (const content of boundedParts(section.body)) {
      if (content.trim())
        chunks.push({ ordinal: chunks.length, heading: section.heading, content });
    }
  }
  return chunks;
}

/** Keeps a part within the cap: whole paragraphs when they fit, otherwise hard slices with overlap. */
function boundedParts(text: string): string[] {
  if (text.length <= ORGANIZATION_CHUNK_MAX_CHARS) return [text];
  const parts: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n{2,}/)) {
    for (const piece of slicesOf(paragraph)) {
      if (current && current.length + 2 + piece.length > ORGANIZATION_CHUNK_MAX_CHARS) {
        if (current.trim()) parts.push(current.trim());
        // The tail carries context into the next part, but only when it still leaves room.
        const tail = current.slice(-ORGANIZATION_CHUNK_OVERLAP_CHARS);
        current = tail.length + 2 + piece.length <= ORGANIZATION_CHUNK_MAX_CHARS ? tail : "";
      }
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** A paragraph no longer than the cap, sliced at the cap when needed. */
function slicesOf(paragraph: string): string[] {
  const slices: string[] = [];
  for (let start = 0; start < paragraph.length; start += ORGANIZATION_CHUNK_MAX_CHARS) {
    slices.push(paragraph.slice(start, start + ORGANIZATION_CHUNK_MAX_CHARS));
  }
  return slices.length ? slices : [];
}
