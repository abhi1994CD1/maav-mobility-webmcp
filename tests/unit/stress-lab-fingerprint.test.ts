import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/domain/stress-lab/canonical-json";
import {
  createFingerprintDocument,
  fingerprintCanonical,
  sha256Hex,
} from "@/domain/stress-lab/fingerprint";

describe("Gate 3 canonical JSON", () => {
  it("sorts keys recursively while preserving array order", () => {
    expect(
      canonicalJson({ z: 1, nested: { beta: 2, alpha: 1 }, list: [3, 2, 1] }),
    ).toBe('{"list":[3,2,1],"nested":{"alpha":1,"beta":2},"z":1}');
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(canonicalJson({ list: [1, 2] })).not.toBe(
      canonicalJson({ list: [2, 1] }),
    );
  });

  it("normalizes strings to NFC and normalizes negative zero", () => {
    expect(canonicalJson({ label: "Cafe\u0301", value: -0 })).toBe(
      canonicalJson({ label: "Caf\u00e9", value: 0 }),
    );
  });

  it.each([
    ["NaN", { value: Number.NaN }],
    ["positive infinity", { value: Number.POSITIVE_INFINITY }],
    ["negative infinity", { value: Number.NEGATIVE_INFINITY }],
    ["undefined", { value: undefined }],
    ["function", { value: () => true }],
    ["bigint", { value: BigInt(1) }],
    ["date", { value: new Date(0) }],
    ["map", { value: new Map() }],
  ])("rejects unsupported %s values", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow();
  });

  it("rejects cycles, sparse arrays, unpaired surrogates, and normalized key collisions", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const sparse = new Array(2);
    sparse[1] = "present";

    expect(() => canonicalJson(cyclic)).toThrow(/Cyclic/u);
    expect(() => canonicalJson(sparse)).toThrow(/Sparse/u);
    expect(() => canonicalJson({ value: "\ud800" })).toThrow(/surrogate/u);
    expect(() =>
      canonicalJson({ "Cafe\u0301": 1, "Caf\u00e9": 2 }),
    ).toThrow(/normalize/u);
  });
});

describe("Gate 3 portable SHA-256", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "The quick brown fox jumps over the lazy dog",
      "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
    ],
  ])("matches the locked SHA-256 vector for %j", (input, digest) => {
    expect(sha256Hex(input)).toBe(digest);
  });

  it("matches the platform SHA-256 implementation for Unicode canonical bytes", () => {
    const canonical = canonicalJson({ city: "Johannesburg", mark: "\ud83d\ude8c" });
    const platformDigest = createHash("sha256").update(canonical, "utf8").digest("hex");
    expect(sha256Hex(canonical)).toBe(platformDigest);
  });

  it("records the exact canonical bytes that its versioned digest covers", () => {
    const document = createFingerprintDocument("TEST_INPUT", { b: 2, a: 1 });
    expect(document.canonicalJson).toContain('"canonicalizationVersion":"canonical-json-v1"');
    expect(document.canonicalJson).toContain('"fingerprintVersion":"sha256-v1"');
    expect(document.fingerprint).toBe(
      `sha256-v1:${createHash("sha256")
        .update(document.canonicalJson, "utf8")
        .digest("hex")}`,
    );
  });

  it("is key-order independent and changes for a semantic value change", () => {
    expect(fingerprintCanonical("TEST_INPUT", { a: 1, b: 2 })).toBe(
      fingerprintCanonical("TEST_INPUT", { b: 2, a: 1 }),
    );
    expect(fingerprintCanonical("TEST_INPUT", { a: 1, b: 2 })).not.toBe(
      fingerprintCanonical("TEST_INPUT", { a: 1, b: 3 }),
    );
  });
});
