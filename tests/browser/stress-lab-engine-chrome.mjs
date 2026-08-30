import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import ts from "typescript";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = resolve(repositoryRoot, "src");
const chromeExecutable =
  process.argv[2] ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const timezoneId = process.env.TZ ?? "UTC";

function transpile(source, fileName) {
  const output = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  });
  const errors = (output.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new Error(
      errors
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
        )
        .join("; "),
    );
  }
  return output.outputText;
}

function browserModule(source, fileName) {
  return transpile(source, fileName).replace(/(["'])@\//gu, "$1/src/");
}

async function sourceFiles(directory) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) values.push(...(await sourceFiles(path)));
    else if (
      [".ts", ".tsx"].includes(extname(entry.name)) &&
      !entry.name.endsWith(".d.ts")
    ) values.push(path);
  }
  return values;
}

function nodeImportSpecifier(specifier, sourceFile, outputFile, temporaryRoot) {
  let target;
  if (specifier.startsWith("@/")) {
    target = resolve(temporaryRoot, "src", `${specifier.slice(2)}.js`);
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    target = resolve(dirname(outputFile), `${specifier}.js`);
  } else {
    return specifier;
  }
  let rewritten = relative(dirname(outputFile), target).split(sep).join("/");
  if (!rewritten.startsWith(".")) rewritten = `./${rewritten}`;
  return rewritten;
}

async function compileNodeTree(temporaryRoot) {
  for (const sourceFile of await sourceFiles(sourceRoot)) {
    const outputFile = resolve(
      temporaryRoot,
      relative(repositoryRoot, sourceFile).replace(/\.tsx?$/u, ".js"),
    );
    await mkdir(dirname(outputFile), { recursive: true });
    const source = await readFile(sourceFile, "utf8");
    const javascript = transpile(source, sourceFile).replace(
      /(from\s+|import\s*)(["'])([^"']+)\2/gu,
      (_match, prefix, quote, specifier) =>
        `${prefix}${quote}${nodeImportSpecifier(
          specifier,
          sourceFile,
          outputFile,
          temporaryRoot,
        )}${quote}`,
    );
    await writeFile(outputFile, javascript, "utf8");
  }
  await writeFile(
    resolve(temporaryRoot, "package.json"),
    JSON.stringify({ type: "module" }),
    "utf8",
  );
}

function utf8Base64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function identityDocuments(inputs, run, createEventLedgerDocument, slot) {
  const result = run(inputs.runs[slot]);
  const ledger = createEventLedgerDocument(result);
  return {
    inputFingerprint: result.inputFingerprint,
    ledgerFingerprint: result.eventLedgerFingerprint,
    resultFingerprint: result.resultFingerprint,
    inputBase64: utf8Base64(inputs.runs[slot].canonicalJson),
    ledgerBase64: utf8Base64(ledger.canonicalJson),
    resultBase64: utf8Base64(result.canonicalResultJson),
  };
}

function assertRepeated(label, first, next) {
  if (JSON.stringify(first) !== JSON.stringify(next)) {
    throw new Error(`${label} canonical bytes changed across repetitions.`);
  }
}

const temporaryRoot = await mkdtemp(resolve(tmpdir(), "maav-stress-lab-node-"));
let browser;
try {
  await compileNodeTree(temporaryRoot);
  const fixture = await import(
    pathToFileURL(
      resolve(temporaryRoot, "src/data/scenarios/sandton-rosebank-v1.js"),
    ).href
  );
  const engine = await import(
    pathToFileURL(
      resolve(temporaryRoot, "src/domain/stress-lab/engine.js"),
    ).href
  );
  const fingerprints = await import(
    pathToFileURL(
      resolve(temporaryRoot, "src/domain/stress-lab/fingerprint.js"),
    ).href
  );
  const nodeObserved = {};
  const nodeInputs = fixture.createGoldenExperimentInputs();
  const nodeShared = {
    networkFingerprint: nodeInputs.networkFingerprint,
    demandFingerprint: nodeInputs.sharedDemandTrace.fingerprint,
    presetFingerprint: nodeInputs.presetFingerprint,
  };
  for (const slot of ["A", "B"]) {
    const first = identityDocuments(
      nodeInputs,
      engine.runDeterministicSimulation,
      fingerprints.createEventLedgerDocument,
      slot,
    );
    for (let iteration = 1; iteration < 20; iteration += 1) {
      assertRepeated(
        `Node ${slot}`,
        first,
        identityDocuments(
          nodeInputs,
          engine.runDeterministicSimulation,
          fingerprints.createEventLedgerDocument,
          slot,
        ),
      );
    }
    nodeObserved[slot] = first;
  }

  browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
  const context = await browser.newContext({ timezoneId });
  const page = await context.newPage();
  await page.route("http://stress-lab.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8"><script type="module">
          import { createGoldenExperimentInputs } from "/src/data/scenarios/sandton-rosebank-v1";
          import { runDeterministicSimulation } from "/src/domain/stress-lab/engine";
          import { createEventLedgerDocument } from "/src/domain/stress-lab/fingerprint";
          const base64 = (value) => {
            const bytes = new TextEncoder().encode(value);
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 8192) {
              binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            }
            return btoa(binary);
          };
          try {
            const inputs = createGoldenExperimentInputs();
            const observed = {};
            for (const slot of ["A", "B"]) {
              let first;
              for (let iteration = 0; iteration < 20; iteration += 1) {
                const result = runDeterministicSimulation(inputs.runs[slot]);
                const ledger = createEventLedgerDocument(result);
                const identity = {
                  inputFingerprint: result.inputFingerprint,
                  ledgerFingerprint: result.eventLedgerFingerprint,
                  resultFingerprint: result.resultFingerprint,
                  inputBase64: base64(inputs.runs[slot].canonicalJson),
                  ledgerBase64: base64(ledger.canonicalJson),
                  resultBase64: base64(result.canonicalResultJson),
                };
                first ??= identity;
                if (JSON.stringify(identity) !== JSON.stringify(first)) {
                  throw new Error(slot + " changed browser canonical bytes");
                }
              }
              observed[slot] = first;
            }
            globalThis.__stressLabOutcome = {
              ok: true,
              shared: {
                networkFingerprint: inputs.networkFingerprint,
                demandFingerprint: inputs.sharedDemandTrace.fingerprint,
                presetFingerprint: inputs.presetFingerprint,
              },
              observed,
            };
          } catch (error) {
            globalThis.__stressLabOutcome = {
              ok: false,
              message: error instanceof Error ? error.message : "UNKNOWN_BROWSER_ERROR",
            };
          }
        </script>`,
      });
      return;
    }
    const requested = resolve(repositoryRoot, `.${decodeURIComponent(url.pathname)}.ts`);
    if (!requested.startsWith(`${sourceRoot}${sep}`)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({
      contentType: "text/javascript",
      body: browserModule(await readFile(requested, "utf8"), requested),
    });
  });

  await page.goto("http://stress-lab.test/", { waitUntil: "load" });
  await page.waitForFunction(() => globalThis.__stressLabOutcome !== undefined, {
    timeout: 120_000,
  });
  const outcome = await page.evaluate(() => globalThis.__stressLabOutcome);
  if (!outcome?.ok) throw new Error(outcome?.message ?? "BROWSER_PROOF_FAILED");
  const browserVersion = browser.version();
  if (!browserVersion.startsWith("150.")) {
    throw new Error(`Expected Chrome 150 but found ${browserVersion}.`);
  }

  if (JSON.stringify(nodeShared) !== JSON.stringify(outcome.shared)) {
    throw new Error("Node/Chrome shared input identities differ.");
  }
  const report = {
    browserVersion,
    timezoneId,
    iterationsPerScenario: 20,
    shared: nodeShared,
    scenarios: {},
  };
  for (const slot of ["A", "B"]) {
    const node = nodeObserved[slot];
    const chrome = outcome.observed[slot];
    const equality = {
      input: node.inputBase64 === chrome.inputBase64,
      ledger: node.ledgerBase64 === chrome.ledgerBase64,
      result: node.resultBase64 === chrome.resultBase64,
    };
    if (!equality.input || !equality.ledger || !equality.result) {
      throw new Error(`${slot} Node/Chrome canonical bytes differ.`);
    }
    report.scenarios[slot] = {
      inputBytes: Buffer.from(node.inputBase64, "base64").length,
      ledgerBytes: Buffer.from(node.ledgerBase64, "base64").length,
      resultBytes: Buffer.from(node.resultBase64, "base64").length,
      inputFingerprint: node.inputFingerprint,
      ledgerFingerprint: node.ledgerFingerprint,
      resultFingerprint: node.resultFingerprint,
      equality,
    };
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  if (browser) await browser.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
