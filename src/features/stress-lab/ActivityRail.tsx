import type { ApplicationAuditEntry } from "@/application/stress-lab-ports";
import type { StressLabWebMcpActivity } from "@/infrastructure/persistence/stress-lab-repository";
import type { ManualActivity } from "@/state/stress-lab-hooks";
import styles from "./stress-lab.module.css";

interface ActivityRailProps {
  readonly manual: readonly ManualActivity[];
  readonly webMcp: readonly StressLabWebMcpActivity[];
  readonly audit: readonly ApplicationAuditEntry[];
}

function statusClass(status: string): string {
  if (status === "COMMITTED" || status === "COMPLETED") return styles.activitySuccess;
  if (status === "FAILED" || status === "CANCELLED") return styles.activityFailure;
  return styles.activityRunning;
}

export function ActivityRail({ manual, webMcp, audit }: ActivityRailProps) {
  return (
    <aside className={`${styles.panel} ${styles.activityRail}`} aria-labelledby="activity-title">
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>APPLICATION ACTIVITY</span>
          <h2 id="activity-title">Authority rail</h2>
        </div>
        <span className={styles.revisionBadge}>{manual.length + webMcp.length} LIVE</span>
      </header>

      <div className={styles.activityStream} aria-live="polite">
        {manual.length === 0 && webMcp.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>No operation activity</strong>
            <p>Manual and WebMCP work appears here after it is genuinely received.</p>
          </div>
        ) : null}

        {manual.map((activity) => {
          const status = activity.transitions.at(-1) ?? "RECEIVED";
          return (
            <article className={styles.activityItem} key={activity.operationId}>
              <span className={`${styles.activityDot} ${statusClass(status)}`} aria-hidden="true" />
              <div>
                <small>HUMAN_UI · {status}</small>
                <strong>{activity.action.replaceAll("-", " ")}</strong>
                <code>{activity.operationId}</code>
                <p>
                  {activity.target}
                  {activity.resultingRevision === undefined ? "" : ` · revision ${activity.resultingRevision}`}
                  {activity.artifactId ? ` · ${activity.artifactId}` : ""}
                </p>
              </div>
            </article>
          );
        })}

        {webMcp.map((activity) => {
          const status = activity.transitions.at(-1)?.status ?? "RECEIVED";
          return (
            <article className={styles.activityItem} key={`web-${activity.id}`}>
              <span className={`${styles.activityDot} ${statusClass(status)}`} aria-hidden="true" />
              <div>
                <small>WEBMCP · {status}</small>
                <strong>{activity.toolName.replaceAll("_", " ")}</strong>
                <code>{activity.operationId ?? "read-only"}</code>
                <p>
                  {activity.argumentSummary}
                  {activity.resultingRevision === undefined ? "" : ` · revision ${activity.resultingRevision}`}
                  {activity.artifactId ? ` · ${activity.artifactId}` : ""}
                </p>
              </div>
            </article>
          );
        })}
      </div>

      <details className={styles.auditDetails}>
        <summary>Durable application audit · {audit.length}</summary>
        <ol>
          {[...audit].reverse().slice(0, 18).map((entry) => (
            <li key={entry.sequence}>
              <span>{entry.sequence.toString().padStart(2, "0")}</span>
              <div>
                <strong>{entry.action.replaceAll("_", " ")}</strong>
                <small>{entry.source} · {entry.status} · rev {entry.resultingRevision}</small>
                <code>{entry.artifactIds.join(" · ") || "NO ARTIFACT"}</code>
              </div>
            </li>
          ))}
        </ol>
      </details>
    </aside>
  );
}
