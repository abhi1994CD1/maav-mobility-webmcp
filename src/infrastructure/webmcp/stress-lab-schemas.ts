import { z } from "zod";

const stableIdPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$";
const stableIdSchema = z.string().min(1).max(64).regex(new RegExp(stableIdPattern));
const scenarioRevisionIdPattern = "^scenario-[AB]-r[1-9][0-9]*$";
const scenarioRevisionIdSchema = z
  .string()
  .min(13)
  .max(64)
  .regex(new RegExp(scenarioRevisionIdPattern));
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const secondSchema = z.number().int().min(0).max(86_400);
const labelSchema = z
  .string()
  .min(1)
  .max(48)
  .refine((value) => value === value.trim())
  .refine((value) => !/[<>\u0000-\u001F\u007F]/u.test(value));
const exactScaled = (scale: number, minimum: number, maximum: number) =>
  z
    .number()
    .min(minimum / scale)
    .max(maximum / scale)
    .refine((value) => Number.isSafeInteger(value * scale));

const objectiveSchema = z.enum([
  "LOWER_WAIT",
  "LOWER_ENERGY_PER_PASSENGER_KM",
  "HIGHER_UTILIZATION",
  "FASTER_RECOVERY",
  "LOWER_EMPTY_KM",
]);
const h0ZoneIds = [
  "sandton",
  "parkmore",
  "illovo",
  "rosebank",
  "melrose-arch",
] as const;
const zoneWeightSchema = z.number().int().min(1).max(1_000_000);
const zoneWeightsSchema = z
  .strictObject({
    sandton: zoneWeightSchema,
    parkmore: zoneWeightSchema,
    illovo: zoneWeightSchema,
    rosebank: zoneWeightSchema,
    "melrose-arch": zoneWeightSchema,
  })
  .refine(
    (weights) =>
      Object.values(weights).reduce((sum, weight) => sum + weight, 0) === 100,
    {
      message: "The five authored zone weights must total exactly 100.",
    },
  );
const fleetSchema = z.strictObject({
  vehicleCount: z.number().int().min(0).max(30),
  seatsPerVehicle: z.number().int().min(1).max(20),
  batteryCapacityKWh: exactScaled(1_000, 1, 1_000_000_000),
  startingBatteryPercent: exactScaled(100, 0, 10_000),
  minimumReservePercent: exactScaled(100, 0, 10_000),
  energyKWhPerKm: exactScaled(1_000, 1, 100_000),
  dwellSeconds: secondSchema.refine((value) => value % 30 === 0),
  initialZoneWeights: zoneWeightsSchema,
});
const constraintsSchema = z.strictObject({
  maximumWaitSeconds: secondSchema,
  maximumUnservedPassengers: z.number().int().min(0).max(1_000_000),
  minimumBatteryReservePercent: exactScaled(100, 0, 10_000),
  maximumRecoverySeconds: secondSchema,
  standingAllowed: z.literal(false),
});

export const stressLabScenarioConfigurationSchema = z
  .strictObject({
    label: labelSchema,
    fleet: fleetSchema,
    constraints: constraintsSchema,
    objectives: z.array(objectiveSchema).min(1).max(5),
  })
  .superRefine((configuration, context) => {
    if (
      configuration.fleet.minimumReservePercent >
      configuration.fleet.startingBatteryPercent
    ) {
      context.addIssue({
        code: "custom",
        path: ["fleet", "minimumReservePercent"],
        message: "Minimum reserve cannot exceed starting battery.",
      });
    }
    if (
      configuration.constraints.minimumBatteryReservePercent !==
      configuration.fleet.minimumReservePercent
    ) {
      context.addIssue({
        code: "custom",
        path: ["constraints", "minimumBatteryReservePercent"],
        message: "Fleet and constraint reserve values must match.",
      });
    }
    if (new Set(configuration.objectives).size !== configuration.objectives.length) {
      context.addIssue({
        code: "custom",
        path: ["objectives"],
        message: "Objectives must be unique.",
      });
    }
  });
const fleetPatchSchema = fleetSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Fleet patch must contain at least one field.",
);
const constraintPatchSchema = constraintsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Constraint patch must contain at least one field.",
);
export const stressLabScenarioPatchSchema = z
  .strictObject({
    label: labelSchema.optional(),
    fleet: fleetPatchSchema.optional(),
    constraints: constraintPatchSchema.optional(),
    objectives: z.array(objectiveSchema).min(1).max(5).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "PATCH requires at least one supported mutable field.",
  });

export const stressLabReadInputSchema = z.strictObject({
  scope: z
    .enum(["SUMMARY", "SCENARIO", "RUN", "COMPARISON", "FINDING"])
    .optional(),
  objectId: stableIdSchema.optional(),
});
const configureBase = {
  operationId: stableIdSchema,
  expectedRevision: revisionSchema,
  slot: z.enum(["A", "B"]),
};
export const stressLabConfigureInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    ...configureBase,
    mode: z.literal("REPLACE"),
    configuration: stressLabScenarioConfigurationSchema,
  }),
  z.strictObject({
    ...configureBase,
    mode: z.literal("PATCH"),
    configuration: stressLabScenarioPatchSchema,
  }),
]);
export const stressLabRunInputSchema = z.strictObject({
  operationId: stableIdSchema,
  expectedRevision: revisionSchema,
  scenarioRevisionId: stableIdSchema,
});
const targetSchema = z.strictObject({
  kind: z.literal("DETERMINISTIC_RULE"),
  rule: z.literal("HIGHEST_OCCUPANCY_THEN_VEHICLE_ID"),
});
const atSecondSchema = z
  .number()
  .int()
  .min(0)
  .max(1_799)
  .refine((value) => value % 30 === 0, {
    message: "Use seconds after 08:30 in 30-second increments; 08:42 is atSecond 720.",
  });
export const stressLabInjectInputSchema = z.strictObject({
  operationId: stableIdSchema,
  expectedRevision: revisionSchema,
  scenarioRevisionId: scenarioRevisionIdSchema,
  disruption: z.strictObject({
    type: z.literal("VEHICLE_FAILURE"),
    target: targetSchema,
    atSecond: atSecondSchema,
  }),
});
export const stressLabCompareInputSchema = z.strictObject({
  operationId: stableIdSchema,
  expectedRevision: revisionSchema,
  runAId: stableIdSchema,
  runBId: stableIdSchema,
});
export const stressLabStageFindingInputSchema = z.strictObject({
  operationId: stableIdSchema,
  expectedRevision: revisionSchema,
  comparisonId: stableIdSchema,
  selectedOutcome: z.enum(["A", "B", "TRADE_OFF", "INCONCLUSIVE"]),
  emphasis: z.enum(["BALANCED", "SERVICE", "ENERGY", "RESILIENCE"]),
});

export type StressLabReadInput = z.infer<typeof stressLabReadInputSchema>;
export type StressLabConfigureInput = z.infer<typeof stressLabConfigureInputSchema>;
export type StressLabRunInput = z.infer<typeof stressLabRunInputSchema>;
export type StressLabInjectInput = z.infer<typeof stressLabInjectInputSchema>;
export type StressLabCompareInput = z.infer<typeof stressLabCompareInputSchema>;
export type StressLabStageFindingInput = z.infer<
  typeof stressLabStageFindingInputSchema
>;

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
export function unsafeInputPath(value: unknown, path = "input"): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return path;
  }
  for (const key of Object.keys(value)) {
    if (forbiddenKeys.has(key)) return `${path}.${key}`;
    const child = unsafeInputPath(
      (value as Record<string, unknown>)[key],
      Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`,
    );
    if (child) return child;
  }
  return undefined;
}
export function boundedOperationId(input: unknown): string | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const parsed = stableIdSchema.safeParse(
    (input as Record<string, unknown>).operationId,
  );
  return parsed.success ? parsed.data : undefined;
}
export function stressLabZodIssue(error: z.ZodError): {
  readonly message: string;
  readonly field?: string;
  readonly missingFields?: readonly string[];
} {
  const issues = error.issues.slice(0, 3);
  const missingFields = issues
    .filter((issue) => issue.code === "invalid_type" && issue.input === undefined)
    .map((issue) => issue.path.join("."))
    .filter(Boolean);
  const field = issues[0]?.path.join(".") || undefined;
  return {
    message: issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; "),
    ...(field ? { field } : {}),
    ...(missingFields.length > 0 ? { missingFields } : {}),
  };
}

const idJson = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: stableIdPattern,
} as const;
const revisionJson = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
const objectivesJson = {
  type: "array",
  description: "H0 uses all five listed objectives for both scenarios.",
  default: [
    "LOWER_WAIT",
    "LOWER_ENERGY_PER_PASSENGER_KM",
    "HIGHER_UTILIZATION",
    "FASTER_RECOVERY",
    "LOWER_EMPTY_KM",
  ],
  minItems: 1,
  maxItems: 5,
  uniqueItems: true,
  items: {
    type: "string",
    enum: [
      "LOWER_WAIT",
      "LOWER_ENERGY_PER_PASSENGER_KM",
      "HIGHER_UTILIZATION",
      "FASTER_RECOVERY",
      "LOWER_EMPTY_KM",
    ],
  },
} as const;
const zoneWeightJson = {
  type: "integer",
  minimum: 1,
  maximum: 1_000_000,
} as const;
const zoneWeightProperties = {
  sandton: { ...zoneWeightJson, description: "H0 weight 30.", default: 30 },
  parkmore: { ...zoneWeightJson, description: "H0 weight 15.", default: 15 },
  illovo: { ...zoneWeightJson, description: "H0 weight 20.", default: 20 },
  rosebank: { ...zoneWeightJson, description: "H0 weight 25.", default: 25 },
  "melrose-arch": {
    ...zoneWeightJson,
    description: "H0 weight 10.",
    default: 10,
  },
} as const;
const fleetProperties = {
  vehicleCount: {
    type: "integer",
    description: "H0 Scenario A uses 12; Scenario B uses 10.",
    examples: [12, 10],
    minimum: 0,
    maximum: 30,
  },
  seatsPerVehicle: {
    type: "integer",
    description: "H0 Scenario A uses 8; Scenario B uses 10.",
    examples: [8, 10],
    minimum: 1,
    maximum: 20,
  },
  batteryCapacityKWh: {
    type: "number",
    description: "H0 value is 70 kWh.",
    default: 70,
    exclusiveMinimum: 0,
    maximum: 1_000_000,
  },
  startingBatteryPercent: {
    type: "number",
    description: "H0 value is 82 percent.",
    default: 82,
    minimum: 0,
    maximum: 100,
  },
  minimumReservePercent: {
    type: "number",
    description: "H0 value is 20 and must equal the constraint reserve.",
    default: 20,
    minimum: 0,
    maximum: 100,
  },
  energyKWhPerKm: {
    type: "number",
    description: "H0 value is 0.21 kWh per kilometre.",
    default: 0.21,
    exclusiveMinimum: 0,
    maximum: 100,
  },
  dwellSeconds: {
    type: "integer",
    description: "H0 value is 30 seconds; must be a multiple of 30.",
    default: 30,
    minimum: 0,
    maximum: 86_400,
    multipleOf: 30,
  },
  initialZoneWeights: {
    type: "object",
    description: "All five authored H0 zones are required; positive integer weights must total exactly 100.",
    properties: zoneWeightProperties,
    required: h0ZoneIds,
    additionalProperties: false,
  },
} as const;
const constraintProperties = {
  maximumWaitSeconds: {
    type: "integer",
    description: "H0 value is 180 seconds.",
    default: 180,
    minimum: 0,
    maximum: 86_400,
  },
  maximumUnservedPassengers: {
    type: "integer",
    description: "H0 value is 12 passengers.",
    default: 12,
    minimum: 0,
    maximum: 1_000_000,
  },
  minimumBatteryReservePercent: {
    type: "number",
    description: "H0 value is 20 and must equal the fleet reserve.",
    default: 20,
    minimum: 0,
    maximum: 100,
  },
  maximumRecoverySeconds: {
    type: "integer",
    description: "H0 value is 600 seconds.",
    default: 600,
    minimum: 0,
    maximum: 86_400,
  },
  standingAllowed: {
    const: false,
    description: "Standing is always prohibited in H0.",
  },
} as const;
const fullConfiguration = {
  type: "object",
  description: "Complete H0 configuration. A is 12 by 8; B is 10 by 10. Use the documented shared assumptions.",
  properties: {
    label: {
      type: "string",
      description: "For seed-07 use exactly Twelve compact pods for A or Ten higher-capacity pods for B; do not add slot suffixes.",
      examples: ["Twelve compact pods", "Ten higher-capacity pods"],
      minLength: 1,
      maxLength: 48,
    },
    fleet: {
      type: "object",
      properties: fleetProperties,
      required: Object.keys(fleetProperties),
      additionalProperties: false,
    },
    constraints: {
      type: "object",
      properties: constraintProperties,
      required: Object.keys(constraintProperties),
      additionalProperties: false,
    },
    objectives: objectivesJson,
  },
  required: ["label", "fleet", "constraints", "objectives"],
  additionalProperties: false,
} as const;
const patchConfiguration = {
  type: "object",
  description: "Patch mutable fields only. A supplied zone-weight map must contain all five authored zones.",
  minProperties: 1,
  properties: {
    label: {
      type: "string",
      description: "New label text; omit unless the user explicitly requested it.",
      minLength: 1,
      maxLength: 48,
    },
    fleet: {
      type: "object",
      minProperties: 1,
      properties: fleetProperties,
      additionalProperties: false,
    },
    constraints: {
      type: "object",
      minProperties: 1,
      properties: constraintProperties,
      additionalProperties: false,
    },
    objectives: objectivesJson,
  },
  additionalProperties: false,
} as const;

export const stressLabReadJsonSchema = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      description: "Optional bounded artifact view.",
      enum: ["SUMMARY", "SCENARIO", "RUN", "COMPARISON", "FINDING"],
    },
    objectId: { ...idJson, description: "Optional artifact identifier." },
  },
  additionalProperties: false,
} as const;
const configureProperties = {
  operationId: { ...idJson, description: "Retry-safe command identifier." },
  expectedRevision: { ...revisionJson, description: "Current application revision." },
  slot: { type: "string", description: "Scenario slot to configure.", enum: ["A", "B"] },
} as const;
export const stressLabConfigureJsonSchema = {
  oneOf: [
    {
      type: "object",
      description: "Replace one scenario with a complete configuration.",
      properties: {
        ...configureProperties,
        mode: { const: "REPLACE", description: "Provide every configuration field." },
        configuration: fullConfiguration,
      },
      required: ["operationId", "expectedRevision", "slot", "mode", "configuration"],
      additionalProperties: false,
    },
    {
      type: "object",
      description: "Patch at least one supported mutable field on a configured scenario.",
      properties: {
        ...configureProperties,
        mode: { const: "PATCH", description: "Provide only fields that should change." },
        configuration: patchConfiguration,
      },
      required: ["operationId", "expectedRevision", "slot", "mode", "configuration"],
      additionalProperties: false,
    },
  ],
} as const;
export const stressLabRunJsonSchema = {
  type: "object",
  properties: {
    operationId: { ...idJson, description: "Retry-safe command identifier." },
    expectedRevision: { ...revisionJson, description: "Current application revision." },
    scenarioRevisionId: { ...idJson, description: "Current scenario revision ID." },
  },
  required: ["operationId", "expectedRevision", "scenarioRevisionId"],
  additionalProperties: false,
} as const;
export const stressLabInjectJsonSchema = {
  type: "object",
  properties: {
    operationId: { ...idJson, description: "Retry-safe command identifier." },
    expectedRevision: { ...revisionJson, description: "Current application revision." },
    scenarioRevisionId: {
      ...idJson,
      pattern: scenarioRevisionIdPattern,
      description: "Current Scenario A or B revision ID.",
    },
    disruption: {
      type: "object",
      properties: {
        type: { const: "VEHICLE_FAILURE" },
        target: {
          type: "object",
          properties: {
            kind: { const: "DETERMINISTIC_RULE" },
            rule: { const: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID" },
          },
          required: ["kind", "rule"],
          additionalProperties: false,
        },
        atSecond: {
          type: "integer",
          description: "Seconds after 08:30; use 720 for 08:42. Must be a 30-second increment.",
          default: 720,
          minimum: 0,
          maximum: 1_799,
          multipleOf: 30,
        },
      },
      required: ["type", "target", "atSecond"],
      additionalProperties: false,
    },
  },
  required: ["operationId", "expectedRevision", "scenarioRevisionId", "disruption"],
  additionalProperties: false,
} as const;
export const stressLabCompareJsonSchema = {
  type: "object",
  properties: {
    operationId: { ...idJson, description: "Retry-safe command identifier." },
    expectedRevision: { ...revisionJson, description: "Current application revision." },
    runAId: { ...idJson, description: "Current Scenario A run ID." },
    runBId: { ...idJson, description: "Current Scenario B run ID." },
  },
  required: ["operationId", "expectedRevision", "runAId", "runBId"],
  additionalProperties: false,
} as const;
export const stressLabStageFindingJsonSchema = {
  type: "object",
  properties: {
    operationId: { ...idJson, description: "Retry-safe command identifier." },
    expectedRevision: { ...revisionJson, description: "Current application revision." },
    comparisonId: { ...idJson, description: "Current trusted comparison ID." },
    selectedOutcome: {
      type: "string",
      description: "Finding outcome explicitly requested by the user; never infer it from vague assent.",
      enum: ["A", "B", "TRADE_OFF", "INCONCLUSIVE"],
    },
    emphasis: {
      type: "string",
      description: "Finding emphasis explicitly requested by the user.",
      enum: ["BALANCED", "SERVICE", "ENERGY", "RESILIENCE"],
    },
  },
  required: ["operationId", "expectedRevision", "comparisonId", "selectedOutcome", "emphasis"],
  additionalProperties: false,
} as const;
