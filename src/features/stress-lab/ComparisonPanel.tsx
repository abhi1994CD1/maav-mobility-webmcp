"use client";

import type { CurrentComparisonRecord } from "@/application/stress-lab-ports";
import type { ComparisonMetricKey, MetricDelta } from "@/domain/stress-lab/types";
import styles from "./stress-lab.module.css";

interface ComparisonPanelProps {
  readonly comparison: CurrentComparisonRecord | null;
  readonly canCompare: boolean;
  readonly canStage: boolean;
  readonly busy: boolean;
  readonly pendingReview: boolean;
  readonly onCompare: () => void;
  readonly onStage: () => void;
}

const FEATURED_METRICS: readonly ComparisonMetricKey[] = Object.freeze([
  "maximumWaitSeconds",
  "unservedPassengers",
  "totalEnergyWh",
  "minimumBatteryBasisPoints",
  "recoveryTimeSeconds",
]);

const METRIC_LABELS: Readonly<Partial<Record<ComparisonMetricKey, string>>> = Object.freeze({
  maximumWaitSeconds: "Maximum wait",
  unservedPassengers: "Unserved passengers",
  totalEnergyWh: "Total energy",
  minimumBatteryBasisPoints: "Minimum reserve",
  recoveryTimeSeconds: "Maximum recovery",
});

function formatValue(value: number | null, unit: MetricDelta["unit"]): string {
  if (value === null) return "N/A";
  if (unit === "BASIS_POINTS") return `${(value / 100).toFixed(2)}%`;
  if (unit === "SECONDS") return `${value.toLocaleString("en-US")} s`;
  if (unit === "WATT_HOURS") return `${value.toLocaleString("en-US")} Wh`;
  if (unit === "METRES") return `${(value / 1_000).toFixed(2)} km`;
  return value.toLocaleString("en-US");
}

function relationLabel(relation: MetricDelta["relation"]): string {
  if (relation === "RIGHT_HIGHER") return "B higher";
  if (relation === "RIGHT_LOWER") return "B lower";
  if (relation === "EQUAL") return "Equal";
  return "Not applicable";
}

export function ComparisonPanel({
  comparison,
  canCompare,
  canStage,
  busy,
  pendingReview,
  onCompare,
  onStage,
}: ComparisonPanelProps) {
  const artifact = comparison?.artifact;
  const featured = artifact
    ? FEATURED_METRICS.map((key) =>
        artifact.metricDeltas.find((metric) => metric.metricKey === key),
      ).filter((metric): metric is MetricDelta => Boolean(metric))
    : [];

  return (
    <section className={`${styles.panel} ${styles.comparisonPanel}`} aria-labelledby="comparison-title">
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>TRUSTED COMPARISON</span>
          <h2 id="comparison-title">Neutral decision evidence</h2>
        </div>
        <div className={styles.actionCluster}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={!canCompare || busy}
            onClick={onCompare}
            aria-describedby="compare-help"
          >
            Compare current runs
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!canStage || busy || pendingReview}
            onClick={onStage}
            aria-describedby="stage-help"
          >
            Stage trade-off finding
          </button>
        </div>
      </header>
      <div className={styles.actionHelp}>
        <small id="compare-help">Requires compatible current A and B runs.</small>
        <small id="stage-help">
          {pendingReview ? "Resolve the pending finding in the human review panel." : "Stages TRADE_OFF / BALANCED evidence for human review."}
        </small>
      </div>

      {!artifact ? (
        <div className={styles.emptyState}>
          <strong>No current comparison</strong>
          <p>Run both scenarios, then compare their verified artifacts.</p>
        </div>
      ) : (
        <>
          <div className={styles.comparisonTable} role="table" aria-label="Scenario A and B comparison">
            <div className={styles.comparisonTableHeader} role="row">
              <span role="columnheader">Measure</span>
              <span role="columnheader">Scenario A</span>
              <span role="columnheader">Scenario B</span>
              <span role="columnheader">Right − left</span>
              <span role="columnheader">Relation</span>
            </div>
            {featured.map((metric) => (
              <div className={styles.comparisonRow} role="row" key={metric.metricKey}>
                <strong role="cell">{METRIC_LABELS[metric.metricKey] ?? metric.metricKey}</strong>
                <span role="cell">{formatValue(metric.leftValue, metric.unit)}</span>
                <span role="cell">{formatValue(metric.rightValue, metric.unit)}</span>
                <span role="cell">
                  {formatValue(metric.rightMinusLeft, metric.unit)}
                  {metric.relativeDeltaStatus === "DEFINED" && metric.relativeDeltaBasisPoints !== null
                    ? ` · ${(metric.relativeDeltaBasisPoints / 100).toFixed(2)}%`
                    : ""}
                </span>
                <span role="cell" className={styles.relationPill}>{relationLabel(metric.relation)}</span>
              </div>
            ))}
          </div>

          <div className={styles.comparisonEvidenceGrid}>
            <section aria-labelledby="constraint-differences-title">
              <h3 id="constraint-differences-title">Hard constraints</h3>
              <div className={styles.constraintList}>
                {artifact.constraintComparisons.map((constraint) => (
                  <div key={constraint.constraintCode}>
                    <span
                      className={constraint.transition === "BOTH_PASS" ? styles.passMark : styles.failMark}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{constraint.constraintCode.replaceAll("_", " ")}</strong>
                      <small>{constraint.transition.replaceAll("_", " ")}</small>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section aria-labelledby="configuration-differences-title">
              <h3 id="configuration-differences-title">Permitted configuration differences</h3>
              <dl className={styles.metricList}>
                {artifact.permittedScenarioDifferences.map((difference) => (
                  <div key={difference.path}>
                    <dt>{difference.path.replace("scenario.", "")}</dt>
                    <dd>{String(difference.leftValue)} → {String(difference.rightValue)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <footer className={styles.identityFooter}>
            <div>
              <span>COMPARISON ARTIFACT</span>
              <code>{comparison.id}</code>
            </div>
            <div>
              <span>FINGERPRINT</span>
              <code title={artifact.comparisonFingerprint}>{artifact.comparisonFingerprint.slice(0, 30)}…</code>
            </div>
            <span className={styles.statusBadge}>NO WINNER SCORE</span>
          </footer>
        </>
      )}
    </section>
  );
}
