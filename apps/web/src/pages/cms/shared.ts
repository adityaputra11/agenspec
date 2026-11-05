import { providerDisplayName } from "../../lib/localized-provider-hint";
import type { ModelCatalogEntry } from "../../lib/model-auth";

export const DOCUMENT_MIME_TYPES: Record<
  string,
  "application/pdf" | "text/plain" | "text/markdown"
> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
};

export const DOCUMENT_ACCEPT = ".pdf,.md,.txt,application/pdf,text/plain,text/markdown";

export const APP_SLUG_PATTERN = /^[a-z0-9_.-]{1,80}$/;

const DOCUMENT_TYPE_BADGES: Record<string, string> = {
  "application/pdf": "PDF",
  "text/markdown": "MD",
  "text/plain": "TXT",
};

/** The MIME type for a picked file, from its extension, or undefined when it is not allowed. */
export function documentMimeType(
  fileName: string,
): "application/pdf" | "text/plain" | "text/markdown" | undefined {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return DOCUMENT_MIME_TYPES[extension];
}

export function documentTypeBadge(mimeType: string): string {
  return DOCUMENT_TYPE_BADGES[mimeType] ?? mimeType;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

export function sameApps(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((app) => set.has(app));
}

export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** The shared catalog's name for a provider, with the same subscription labels as onboarding. */
export function providerLabel(catalog: ModelCatalogEntry[], provider: string): string {
  const entry = catalog.find((item) => item.provider === provider);
  return providerDisplayName(provider, entry?.providerName ?? provider);
}
