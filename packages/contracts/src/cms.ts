import * as z from "zod";

/** Document types an organization can upload as reference material for its bots. */
export const OrganizationDocumentMimeTypeSchema = z.enum([
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

export const OrganizationMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
});

export const OrganizationDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
});

/** One app slug as an admin types it: trimmed, lower-cased, and limited to slug characters. */
const AllowedAppSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_.-]+$/, "App slugs use letters, digits, dots, dashes and underscores");

export const OrganizationPolicyInputSchema = z.object({
  restrictApps: z.boolean(),
  allowedApps: z.array(AllowedAppSlugSchema).max(200),
});

export const OrganizationPolicySchema = z.object({
  restrictApps: z.boolean(),
  allowedApps: z.array(z.string()),
});
