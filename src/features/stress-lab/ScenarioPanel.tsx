"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { ScenarioSlot, VerifiedRunResultArtifact } from "@/domain/stress-lab/types";
import {
  type ScenarioDraft,
  type ScenarioPresentation,
  validateScenarioDraft,
} from "@/state/stress-lab-hooks";
import styles from "./stress-lab.module.css";

interface ScenarioPanelProps {
  readonly slot: ScenarioSlot;
  readonly scenario: ScenarioPresentation | null;
  readonly run: {
    readonly id: string;
    readonly isCurrent: boolean;
    readonly metrics: VerifiedRunResultArtifact["metrics"];
  } | null;
  readonly differenceSummary: string;
  readonly busy: boolean;
  readonly runActive: boolean;
  readonly onConfigure: (draft: ScenarioDraft) => void;
  readonly onInject: () => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
}

interface FieldDefinition {
  readonly key: keyof ScenarioDraft;
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const FIELDS: readonly FieldDefinition[] = Object.freeze([
  { key: "vehicleCount", label: "Fleet size", unit: "vehicles", min: 0, max: 30, step: 1 },
  { key: "seatsPerVehicle", label: "Seats", unit: "per vehicle", min: 1, max: 20, step: 1 },
  { key: "batteryCapacityKWh", label: "Battery", unit: "kWh", min: 0.001, max: 1_000_000, step: 0.001 },
  { key: "startingBatteryPercent", label: "Starting charge", unit: "%", min: 0, max: 100, step: 0.01 },
  { key: "minimumReservePercent", label: "Reserve floor", unit: "%", min: 0, max: 100, step: 0.01 },
  { key: "energyKWhPerKm", label: "Energy rate", unit: "kWh/km", min: 0.001, max: 100, step: 0.001 },
  { key: "dwellSeconds", label: "Dwell", unit: "seconds", min: 0, max: 86_400, step: 1 },
  { key: "maximumWaitSeconds", label: "Maximum wait", unit: "seconds", min: 0, max: 86_400, step: 1 },
  { key: "maximumUnservedPassengers", label: "Maximum unserved", unit: "passengers", min: 0, max: 1_000_000, step: 1 },
  { key: "maximumRecoverySeconds", label: "Maximum recovery", unit: "seconds", min: 0, max: 86_400, step: 1 },
]);

export function ScenarioPanel({
  slot,
  scenario,
  run,
  differenceSummary,
  busy,
  runActive,
  onConfigure,
  onInject,
  onRun,
  onCancel,
}: ScenarioPanelProps) {
  const [draft, setDraft] = useState<ScenarioDraft | null>(scenario?.draft ?? null);

  const errors = useMemo(
    () => (draft ? validateScenarioDraft(draft) : {}),
    [draft],
  );
  const errorEntries = Object.entries(errors);
  const accent = slot === "A" ? styles.scenarioA : styles.scenarioB;
  const hasScenario = Boolean(scenario && draft);
  const canInject = hasScenario && Boolean(scenario?.configured) && !scenario?.disrupted && !busy;
  const canRun = hasScenario && Boolean(scenario?.configured && scenario.disrupted) && !busy;
  const scenarioStatus = !hasScenario
    ? "EMPTY"
    : !scenario?.configured
      ? "GOLDEN TEMPLATE"
      : scenario.disrupted
        ? "08:42 FAILURE"
        : "BASELINE";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft && errorEntries.length === 0 && !busy) onConfigure(draft);
  }

  return (
    <section className={`${styles.panel} ${styles.scenarioPanel} ${accent}`} aria-labelledby={`scenario-${slot}-title`}>
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>SCENARIO {slot}</span>
          <h2 id={`scenario-${slot}-title`}>{scenario?.label ?? "Not initialized"}</h2>
        </div>
        <div className={styles.statusStack}>
          <span className={styles.revisionBadge}>REV {scenario?.revision ?? "—"}</span>
          <span className={`${styles.statusBadge} ${scenario?.configured && scenario.disrupted ? styles.statusWarning : styles.statusNeutral}`}>
            {scenarioStatus}
          </span>
        </div>
      </header>

      <div className={styles.differenceLine}>
        <span>CONFIGURATION</span>
        <strong>{differenceSummary}</strong>
      </div>

      {scenario?.resolvedFailureVehicleId ? (
        <div className={styles.resolvedTarget}>
          <span>RESOLVED FAILURE TARGET</span>
          <code>{scenario.resolvedFailureVehicleId}</code>
        </div>
      ) : null}

      {!draft ? (
        <div className={styles.emptyState}>
          <strong>Initialize the golden experiment</strong>
          <p>Reset creates the authoritative Scenario {slot} starting point.</p>
        </div>
      ) : (
        <form className={styles.scenarioForm} onSubmit={submit} noValidate>
          {errorEntries.length > 0 ? (
            <div className={styles.errorSummary} role="alert" aria-label={`Scenario ${slot} validation errors`}>
              <strong>Correct {errorEntries.length} field{errorEntries.length === 1 ? "" : "s"}</strong>
              <ul>
                {errorEntries.map(([key, message]) => (
                  <li key={key}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={styles.fieldGrid}>
            {FIELDS.map((field) => {
              const error = errors[field.key];
              const fieldId = `scenario-${slot}-${field.key}`;
              return (
                <label className={styles.field} key={field.key} htmlFor={fieldId}>
                  <span>{field.label}</span>
                  <div className={styles.inputShell}>
                    <input
                      id={fieldId}
                      name={field.key}
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={draft[field.key]}
                      aria-invalid={Boolean(error)}
                      aria-describedby={`${fieldId}-unit${error ? ` ${fieldId}-error` : ""}`}
                      onChange={(event) => {
                        const value = event.currentTarget.valueAsNumber;
                        setDraft({ ...draft, [field.key]: value });
                      }}
                    />
                    <small id={`${fieldId}-unit`}>{field.unit}</small>
                  </div>
                  {error ? <em id={`${fieldId}-error`}>{error}</em> : null}
                </label>
              );
            })}
          </div>

          <div className={styles.scenarioActions}>
            <button
              className={styles.secondaryButton}
              type="submit"
              disabled={busy || errorEntries.length > 0}
              aria-describedby={`scenario-${slot}-configure-help`}
            >
              Configure {slot}
            </button>
            <button
              className={styles.warningButton}
              type="button"
              disabled={!canInject}
              onClick={onInject}
              aria-describedby={`scenario-${slot}-inject-help`}
            >
              Inject 08:42 failure
            </button>
            {runActive ? (
              <button className={styles.dangerButton} type="button" onClick={onCancel}>
                Cancel run
              </button>
            ) : (
              <button
                className={styles.primaryButton}
                type="button"
                disabled={!canRun}
                onClick={onRun}
                aria-describedby={`scenario-${slot}-run-help`}
              >
                Run scenario {slot}
              </button>
            )}
          </div>
          <div className={styles.helpRow}>
            <small id={`scenario-${slot}-configure-help`}>
              {errorEntries.length > 0 ? "Resolve validation errors before configuring." : "Creates a new immutable scenario revision."}
            </small>
            <small id={`scenario-${slot}-inject-help`}>
              {!scenario?.configured
                ? "Configure this template to establish a clean baseline."
                : scenario.disrupted
                  ? "Equivalent failure already scheduled."
                  : "Requires a current scenario revision."}
            </small>
            <small id={`scenario-${slot}-run-help`}>
              {scenario?.configured && scenario.disrupted
                ? "Publishes verified evidence after commit."
                : "Configure, then inject the equivalent failure first."}
            </small>
          </div>
        </form>
      )}

      <footer className={styles.panelFooter}>
        <span>{run?.isCurrent ? `CURRENT RUN · ${run.id}` : "NO CURRENT RUN"}</span>
        <code title={scenario?.inputFingerprint}>{scenario?.inputFingerprint.slice(0, 18) ?? "NO INPUT"}</code>
      </footer>
    </section>
  );
}
