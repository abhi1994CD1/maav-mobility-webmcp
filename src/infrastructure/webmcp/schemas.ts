import { z } from "zod";

export const snapshotInputSchema = z.strictObject({
  focus: z.enum([
    "network",
    "incident",
    "fleet",
    "demand",
    "accessibility",
    "all",
  ]),
});

export const objectivesSchema = z.strictObject({
  minimumOnTimePercent: z.number().min(0).max(100),
  maximumWaitMinutes: z.number().positive(),
  preserveAccessibility: z.boolean(),
  maximumEnergyIncreasePercent: z.number().min(0),
});

export const evaluateInputSchema = z.strictObject({
  expectedRevision: z.number().int().min(0),
  objectives: objectivesSchema,
});

export const stageInputSchema = z.strictObject({
  planId: z.string().min(1).max(128),
  expectedRevision: z.number().int().min(0),
});

export const commitInputSchema = stageInputSchema;

export const rollbackInputSchema = z.strictObject({
  reason: z.string().trim().min(1).max(240),
  expectedRevision: z.number().int().min(0),
});

export const auditInputSchema = z.strictObject({
  afterSequence: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
});

export const snapshotJsonSchema = {
  type: "object",
  properties: {
    focus: {
      type: "string",
      enum: [
        "network",
        "incident",
        "fleet",
        "demand",
        "accessibility",
        "all",
      ],
    },
  },
  required: ["focus"],
  additionalProperties: false,
} as const;

export const evaluateJsonSchema = {
  type: "object",
  properties: {
    expectedRevision: { type: "integer", minimum: 0 },
    objectives: {
      type: "object",
      properties: {
        minimumOnTimePercent: { type: "number", minimum: 0, maximum: 100 },
        maximumWaitMinutes: { type: "number", exclusiveMinimum: 0 },
        preserveAccessibility: { type: "boolean" },
        maximumEnergyIncreasePercent: { type: "number", minimum: 0 },
      },
      required: [
        "minimumOnTimePercent",
        "maximumWaitMinutes",
        "preserveAccessibility",
        "maximumEnergyIncreasePercent",
      ],
      additionalProperties: false,
    },
  },
  required: ["expectedRevision", "objectives"],
  additionalProperties: false,
} as const;

export const planJsonSchema = {
  type: "object",
  properties: {
    planId: { type: "string", minLength: 1, maxLength: 128 },
    expectedRevision: { type: "integer", minimum: 0 },
  },
  required: ["planId", "expectedRevision"],
  additionalProperties: false,
} as const;

export const rollbackJsonSchema = {
  type: "object",
  properties: {
    reason: { type: "string", minLength: 1, maxLength: 240 },
    expectedRevision: { type: "integer", minimum: 0 },
  },
  required: ["reason", "expectedRevision"],
  additionalProperties: false,
} as const;

export const auditJsonSchema = {
  type: "object",
  properties: {
    afterSequence: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  required: ["afterSequence", "limit"],
  additionalProperties: false,
} as const;

export function zodIssueMessage(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}
