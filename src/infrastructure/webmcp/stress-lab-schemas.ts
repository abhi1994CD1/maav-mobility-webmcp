import { z } from "zod";

const operationIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    "Use 1–64 letters, numbers, dots, colons, underscores, or hyphens.",
  );

const scenarioLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .refine(
    (value) => !/[<>\u0000-\u001F\u007F]/u.test(value),
    "Use plain text without markup or control characters.",
  );

export const stressLabReadInputSchema = z.strictObject({
  scope: z.enum(["SUMMARY", "SCENARIO"]).optional(),
  objectId: z.enum(["A", "B"]).optional(),
});

const provisionalFleetSchema = z.strictObject({
  vehicleCount: z.number().int().min(0).max(30),
  seatsPerVehicle: z.number().int().min(1).max(20),
});

export const stressLabConfigureInputSchema = z.strictObject({
  operationId: operationIdSchema,
  expectedRevision: z.number().int().min(0),
  slot: z.enum(["A", "B"]),
  mode: z.literal("REPLACE"),
  configuration: z.strictObject({
    label: scenarioLabelSchema,
    fleet: provisionalFleetSchema,
  }),
});

const stressLabConfigureIntentSchema = z.strictObject({
  operationId: operationIdSchema.optional(),
  expectedRevision: z.number().int().min(0).optional(),
  slot: z.enum(["A", "B"]).optional(),
  mode: z.literal("REPLACE").optional(),
  configuration: z
    .strictObject({
      label: scenarioLabelSchema.optional(),
      fleet: z
        .strictObject({
          vehicleCount: z.number().int().min(0).max(30).optional(),
          seatsPerVehicle: z.number().int().min(1).max(20).optional(),
        })
        .optional(),
    })
    .optional(),
});

export const stressLabReadJsonSchema = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      description:
        "Optional bounded view of the provisional experiment state.",
      enum: ["SUMMARY", "SCENARIO"],
    },
    objectId: {
      type: "string",
      description:
        "Optional provisional scenario slot to focus in the visible lab.",
      enum: ["A", "B"],
    },
  },
  additionalProperties: false,
} as const;

export const stressLabConfigureJsonSchema = {
  type: "object",
  properties: {
    operationId: {
      type: "string",
      description:
        "Unique retry-safe identifier for this exact mutation. Use a new value when correcting input.",
      minLength: 1,
      maxLength: 64,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    },
    expectedRevision: {
      type: "integer",
      description:
        "Current stateRevision returned by read_lab_state. Stale values are rejected without mutation.",
      minimum: 0,
    },
    slot: {
      type: "string",
      description: "Scenario slot to replace in this bounded Gate 2 proof.",
      enum: ["A", "B"],
    },
    mode: {
      type: "string",
      description:
        "Gate 2 supports a complete provisional replacement only; PATCH arrives in a later domain gate.",
      enum: ["REPLACE"],
    },
    configuration: {
      type: "object",
      description:
        "Provisional integration-test configuration. It does not produce simulation results.",
      properties: {
        label: {
          type: "string",
          description: "Visible plain-text scenario label.",
          minLength: 1,
          maxLength: 48,
        },
        fleet: {
          type: "object",
          properties: {
            vehicleCount: {
              type: "integer",
              description: "Synthetic vehicle count for the provisional slot.",
              minimum: 0,
              maximum: 30,
            },
            seatsPerVehicle: {
              type: "integer",
              description: "Synthetic seated capacity per provisional vehicle.",
              minimum: 1,
              maximum: 20,
            },
          },
          required: ["vehicleCount", "seatsPerVehicle"],
          additionalProperties: false,
        },
      },
      required: ["label", "fleet"],
      additionalProperties: false,
    },
  },
  required: [
    "operationId",
    "expectedRevision",
    "slot",
    "mode",
    "configuration",
  ],
  additionalProperties: false,
} as const;

export function parseStressLabConfigureIntent(input: unknown): {
  validShape: boolean;
  operationId?: string;
  missingFields: string[];
} {
  const parsed = stressLabConfigureIntentSchema.safeParse(input);
  if (!parsed.success) {
    return { validShape: false, missingFields: [] };
  }

  const missingFields: string[] = [];
  if (!parsed.data.operationId) missingFields.push("operationId");
  if (parsed.data.expectedRevision === undefined)
    missingFields.push("expectedRevision");
  if (!parsed.data.slot) missingFields.push("slot");
  if (!parsed.data.mode) missingFields.push("mode");
  if (!parsed.data.configuration) {
    missingFields.push("configuration");
  } else {
    if (!parsed.data.configuration.label)
      missingFields.push("configuration.label");
    if (!parsed.data.configuration.fleet) {
      missingFields.push("configuration.fleet");
    } else {
      if (parsed.data.configuration.fleet.vehicleCount === undefined)
        missingFields.push("configuration.fleet.vehicleCount");
      if (parsed.data.configuration.fleet.seatsPerVehicle === undefined)
        missingFields.push("configuration.fleet.seatsPerVehicle");
    }
  }

  return {
    validShape: true,
    ...(parsed.data.operationId
      ? { operationId: parsed.data.operationId }
      : {}),
    missingFields,
  };
}

export function stressLabZodIssueMessage(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}
