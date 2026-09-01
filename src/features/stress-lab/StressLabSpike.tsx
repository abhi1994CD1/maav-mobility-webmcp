"use client";

import { useEffect, useState } from "react";
import type { StressLabRuntimeStoreState } from "@/infrastructure/persistence/stress-lab-repository";
import { StressLabWebMcpBridge } from "@/infrastructure/webmcp/StressLabWebMcpBridge";
import { STRESS_LAB_WEBMCP_TOOL_NAMES } from "@/infrastructure/webmcp/stress-lab-tools";
import { getBrowserStressLabRuntime } from "@/state/stress-lab-runtime";
import styles from "./StressLabSpike.module.css";

const INITIAL_UI: StressLabRuntimeStoreState["ui"] = {
  webMcpStatus: "CHECKING",
  webMcpMessage: "Checking Chrome WebMCP availability…",
  observedView: null,
  activities: [],
  nextActivityId: 1,
};

export function StressLabSpike() {
  const [ui, setUi] = useState(INITIAL_UI);

  useEffect(() => {
    const runtime = getBrowserStressLabRuntime();
    const publish = (state: StressLabRuntimeStoreState) => setUi(state.ui);
    publish(runtime.store.getState());
    return runtime.store.subscribe(publish);
  }, []);

  const view = ui.observedView;

  return (
    <main className={styles.labShell}>
      <StressLabWebMcpBridge />

      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">M</span>
          <div>
            <small>MAAV / GATE 7</small>
            <h1>Stress Lab WebMCP Authority</h1>
          </div>
        </div>
        <div className={styles.revision} aria-label={`Application revision ${view?.revision ?? 0}`}>
          <span>APPLICATION REVISION</span>
          <strong>{view?.revision ?? 0}</strong>
        </div>
      </header>

      <section className={styles.truthStrip} aria-label="Prototype disclosure">
        <span aria-hidden="true" />
        <strong>SYNTHETIC SIMULATION • NO LIVE FLEET CONTROL</strong>
        <b>•</b>
        <span>DETERMINISTIC EVIDENCE • HUMAN REVIEW</span>
      </section>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>STATIC TRUSTED CAPABILITIES</span>
          <h2>Six tools, one revision-safe application authority.</h2>
          <p>
            This diagnostic surface proves browser registration, committed-state
            visibility, and transient activity. It is not the Gate 8 operator UI.
          </p>
        </div>
        <aside
          className={`${styles.webMcpStatus} ${styles[ui.webMcpStatus.toLowerCase()]}`}
          aria-live="polite"
        >
          <span aria-hidden="true" />
          <div>
            <small>WEBMCP STATUS</small>
            <strong>{ui.webMcpStatus}</strong>
            <p>{ui.webMcpMessage}</p>
          </div>
        </aside>
      </section>

      <section className={styles.workspace}>
        <section className={styles.toolCatalog} aria-labelledby="catalog-title">
          <header>
            <div>
              <small>STATIC CATALOG</small>
              <h2 id="catalog-title">Trusted lab capabilities</h2>
            </div>
            <span>6 TOOLS</span>
          </header>
          <ol>
            {STRESS_LAB_WEBMCP_TOOL_NAMES.map((name) => (
              <li key={name}>
                <code>{name}</code>
                <span>Registered for the full tab lifecycle</span>
              </li>
            ))}
          </ol>
          <p>Accept, Challenge, and Reset remain visible human-only commands.</p>
        </section>

        <aside className={styles.proofRail}>
          <section className={styles.toolCatalog} aria-labelledby="state-title">
            <header>
              <div>
                <small>COMMITTED STATE</small>
                <h2 id="state-title">Current evidence</h2>
              </div>
            </header>
            <ol>
              <li><code>Scenario A</code><span>{view?.scenarios.A?.id ?? "Not configured"}</span></li>
              <li><code>Scenario B</code><span>{view?.scenarios.B?.id ?? "Not configured"}</span></li>
              <li><code>Comparison</code><span>{view?.currentComparison?.id ?? "Not available"}</span></li>
              <li><code>Finding</code><span>{view?.currentFinding?.review ?? "Not staged"}</span></li>
            </ol>
          </section>

          <section className={styles.activityPanel} aria-labelledby="activity-title">
            <header>
              <div>
                <small>TRANSIENT WEBMCP</small>
                <h2 id="activity-title">Activity evidence</h2>
              </div>
              <span>{ui.activities.length}</span>
            </header>
            {ui.activities.length === 0 ? (
              <div className={styles.emptyActivity}>No browser-agent activity yet.</div>
            ) : (
              <ol className={styles.activityList}>
                {ui.activities.map((activity) => {
                  const status = activity.transitions.at(-1)?.status ?? "RECEIVED";
                  return (
                    <li key={activity.id}>
                      <span className={styles.activityNode} aria-hidden="true" />
                      <div>
                        <strong>{activity.toolName}</strong>
                        <code>{activity.operationId ?? "read-only"}</code>
                        <p>{activity.argumentSummary}</p>
                        <small>
                          WEBMCP • {status}
                          {activity.resultingRevision === undefined
                            ? ""
                            : ` • REV ${activity.resultingRevision}`}
                        </small>
                      </div>
                      <time dateTime={activity.startedAt}>
                        {activity.startedAt.slice(11, 19)}Z
                      </time>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </section>

      <footer className={styles.footer}>
        <span>NO GOOGLE • NO LIVE DATA • NO OPERATIONAL CONTROL</span>
        <span>WEBMCP → SHARED SERVICE → TRUSTED ARTIFACTS</span>
      </footer>
    </main>
  );
}
