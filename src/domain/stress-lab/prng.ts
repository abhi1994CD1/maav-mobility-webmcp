import { StressLabInputValidationError, type Seed } from "./types";

export const STRESS_LAB_PRNG_VERSION = "mulberry32-v1" as const;

export interface SeededPrng {
  readonly version: typeof STRESS_LAB_PRNG_VERSION;
  nextUint32(): number;
  nextInteger(exclusiveMaximum: number): number;
  state(): number;
}

export function createSeededPrng(seedValue: Seed): SeededPrng {
  let state = Number(seedValue) >>> 0;

  function nextUint32(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (mixed ^ (mixed >>> 14)) >>> 0;
  }

  function nextInteger(exclusiveMaximum: number): number {
    if (
      !Number.isSafeInteger(exclusiveMaximum) ||
      exclusiveMaximum < 1 ||
      exclusiveMaximum > 0x1_0000_0000
    ) {
      throw new StressLabInputValidationError(
        "INVALID_PRNG_RANGE",
        "PRNG exclusive maximum must be an integer from 1 to 4294967296.",
      );
    }

    const acceptedRange =
      Math.floor(0x1_0000_0000 / exclusiveMaximum) * exclusiveMaximum;
    let candidate = nextUint32();
    while (candidate >= acceptedRange) candidate = nextUint32();
    return candidate % exclusiveMaximum;
  }

  return Object.freeze({
    version: STRESS_LAB_PRNG_VERSION,
    nextUint32,
    nextInteger,
    state: () => state,
  });
}
