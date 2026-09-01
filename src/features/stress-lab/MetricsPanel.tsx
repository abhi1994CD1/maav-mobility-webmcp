"use client";

import { useState } from "react";
import type { MetricSet, ScenarioSlot } from "@/domain/stress-lab/types";
import type { StressLabStateView } from "@/application/stress-lab-ports";
import styles from "./stress-lab.module.css";

interface MetricsPanelProps {
  readonly slot: ScenarioSlot;
  readonly run: StressLabStateView["currentRuns"][ScenarioSlot];
}

interface MetricDefinition {
  readonly key: keyof MetricSet;
  readonly label: string;
  readonly unit: string;
  readonly format: (value: number | null) => string;
}

const integer = (value: number | null) => (value === null ? "N/A" : value.toLocaleString("en-US"));
const seconds = (value: number | null) => (value === null ? "N/A" : `${value.toLocaleString("en-US")} s`);
const percentage = (value: number | null) => (value === null ? "N/A" : `${(value / 100).toFixed(2)}%`);
const basisPoints = (value: number | null) => (value === null ? "N/A" : `${value.toLocaleString("en-US")} bp`);
const kilometres = (value: number | null) => (value === null ? "N/A" : `${(value / 1_000).toFixed(2)} km`);
const wattHours = (value: number | null) => (value === null ? "N/A" : `${value.toLocaleString("en-US")} Wh`);

const PRIMARY_METRICS: readonly MetricDefinition[] = Object.freeze([
  { key: "maximumWaitSeconds", label: "Maximum wait", unit: "SECONDS", format: seconds },
  { key: "unservedPassengers", label: "Unserved", unit: "PASSENGERS", format: integer },
  { key: "totalEnergyWh", label: "Total energy", unit: "WATT HOURS", format: wattHours },
  { key: "minimumBatteryBasisPoints", label: "Minimum reserve", unit: "BASIS POINTS", format: basisPoints },
  { key: "recoveryTimeSeconds", label: "Recovery", unit: "SECONDS", format: seconds },
]);

const SECONDARY_METRICS: readonly MetricDefinition[] = Object.freeze([
  { key: "requestedPassengers", label: "Requested", unit: "PASSENGERS", format: integer },
  { key: "servedPassengers", label: "Served", unit: "PASSENGERS", format: integer },
  { key: "inServiceAtHorizonPassengers", label: "In service at horizon", unit: "PASSENGERS", format: integer },
  { key: "averageWaitSeconds", label: "Average wait", unit: "SECONDS", format: seconds },
  { key: "p95WaitSeconds", label: "P95 wait", unit: "SECONDS", format: seconds },
  { key: "onTimeBasisPoints", label: "On-time pickup", unit: "BASIS POINTS", format: percentage },
  { key: "peakOccupancyBasisPoints", label: "Peak occupancy", unit: "BASIS POINTS", format: percentage },
  { key: "utilizationBasisPoints", label: "Capacity utilization", unit: "BASIS POINTS", format: percentage },
  { key: "vehicleMetres", label: "Vehicle distance", unit: "METRES", format: kilometres },
  { key: "emptyVehicleMetres", label: "Empty distance", unit: "METRES", format: kilometres },
  { key: "passengerMetres", label: "Passenger distance", unit: "METRES", format: kilometres },
  { key: "energyWhPerPassengerKilometre", label: "Energy / passenger-km", unit: "WH / PASSENGER-KM", format: wattHours },
  { key: "reserveViolations", label: "Reserve breaches", unit: "COUNT", format: integer },
  { key: "reserveBlockedAssignments", label: "Reserve-blocked assignments", unit: "COUNT", format: integer },
]);

function CopyIdentity({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.copyButton}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
      aria-label={`Copy fingerprint ${value}`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function MetricsPanel({ slot, run }: MetricsPanelProps) {
  if (!run) {
    return (
      <section className={`${styles.panel} ${styles.metricsPanel}`} aria-labelledby={`metrics-${slot}-title`}>
        <header className={styles.panelHeader}>
          <div>
            <span className={styles.eyebrow}>SCENARIO {slot} EVIDENCE</span>
            <h2 id={`metrics-${slot}-title`}>Awaiting verified run</h2>
          </div>
        </header>
        <div className={styles.emptyState}>
          <strong>No committed metrics</strong>
          <p>Configure, inject, and run Scenario {slot} to publish verified evidence.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.panel} ${styles.metricsPanel}`} aria-labelledby={`metrics-${slot}-title`}>
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>SCENARIO {slot} EVIDENCE</span>
          <h2 id={`metrics-${slot}-title`}>Verified run metrics</h2>
        </div>
        <span className={`${styles.statusBadge} ${run.isCurrent ? styles.statusSuccess : styles.statusWarning}`}>
          {run.isCurrent ? "CURRENT" : "STALE"}
        </span>
      </header>

      <div className={styles.primaryMetricGrid}>
        {PRIMARY_METRICS.map((metric) => (
          <div className={styles.primaryMetric} key={metric.key}>
            <small>{metric.label}</small>
            <strong>{metric.format(run.metrics[metric.key])}</strong>
            <span>{metric.unit}</span>
          </div>
        ))}
      </div>

      <details className={styles.evidenceDetails}>
        <summary>Complete KPI and constraint evidence</summary>
        <dl className={styles.metricList}>
          {SECONDARY_METRICS.map((metric) => (
            <div key={metric.key}>
              <dt>{metric.label}</dt>
              <dd>{metric.format(run.metrics[metric.key])}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.constraintList}>
          {run.constraints.map((constraint) => (
            <div key={constraint.code}>
              <span className={constraint.passed ? styles.passMark : styles.failMark} aria-hidden="true" />
              <div>
                <strong>{constraint.code.replaceAll("_", " ")}</strong>
                <small>
                  {constraint.passed ? "PASS" : "FAIL"} · observed {constraint.observed ?? "N/A"} · threshold {constraint.threshold ?? "N/A"} {constraint.unit}
                </small>
              </div>
            </div>
          ))}
        </div>
      </details>

      <footer className={styles.identityFooter}>
        <div>
          <span>RUN ARTIFACT</span>
          <code>{run.id}</code>
        </div>
        <div>
          <span>RESULT</span>
          <code title={run.resultFingerprint}>{run.resultFingerprint.slice(0, 22)}…</code>
        </div>
        <CopyIdentity value={run.resultFingerprint} />
      </footer>
    </section>
  );
}
