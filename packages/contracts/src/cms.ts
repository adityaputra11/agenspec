import * as z from "zod";
import { ModelConnectOptionFields, refineModelConnectOptions } from "./domain.js";
import { ModelHeadersSchema } from "./model-headers.js";

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
  /** Processing until its sections are indexed; a ready document can be searched and attached. */
  status: z.enum(["processing", "ready", "failed"]),
  error: z.string().nullable(),
  chunkCount: z.number().int(),
});

/** One app slug as an admin types it: trimmed, lower-cased, and limited to slug characters. */
const AllowedAppSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_.-]+$/, "App slugs use letters, digits, dots, dashes and underscores");

/** The Timesheet MCP endpoint. Absent leaves it unchanged; null clears it. */
export const TimesheetServerUrlSchema = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an https URL");

export const OrganizationPolicyInputSchema = z.object({
  restrictApps: z.boolean(),
  allowedApps: z.array(AllowedAppSlugSchema).max(200),
  timesheetServerUrl: TimesheetServerUrlSchema.nullable().optional(),
});

export const OrganizationPolicySchema = z.object({
  restrictApps: z.boolean(),
  allowedApps: z.array(z.string()),
  timesheetServerUrl: z.string().nullable(),
});

/** The organization model and the member provider policy. Never carries the key or the stored connection. */
export const OrganizationModelSettingsSchema = z.object({
  connected: z.boolean(),
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
  baseUrl: z.string().nullable(),
  restrictMemberProviders: z.boolean(),
  allowedProviders: z.array(z.string()),
});

const ProviderIdSchema = z.string().trim().min(1).max(200);

/** A key lists a catalog provider's models; a server address lists an OpenAI-compatible server's. */
export const OrganizationModelProbeSchema = z.object({
  provider: ProviderIdSchema,
  apiKey: z.string().trim().max(4096).optional(),
  baseUrl: z.string().trim().max(2048).optional(),
  headers: ModelHeadersSchema.optional(),
});

/**
 * The organization's connection. Its per-model settings are the member's own (ModelConnectOptionFields),
 * stored in the connection and run the same way.
 */
export const OrganizationModelConnectSchema = z
  .object({
    provider: ProviderIdSchema,
    apiKey: z.string().trim().max(4096).optional(),
    baseUrl: z.string().trim().max(2048).optional(),
    modelId: z.string().trim().min(1).max(512),
    headers: ModelHeadersSchema.optional(),
    ...ModelConnectOptionFields,
  })
  .superRefine(refineModelConnectOptions);

export const OrganizationModelPolicyInputSchema = z.object({
  restrictMemberProviders: z.boolean(),
  allowedProviders: z.array(ProviderIdSchema).max(200),
});

export type OrganizationDocument = z.infer<typeof OrganizationDocumentSchema>;
