"use client";

import { useState, type FormEvent } from "react";
import type {
  ConfigureScenarioResult,
  ProvisionalScenarioRevision,
  StressLabScenarioSlot,
} from "@/application/stress-lab/spike-service";
import { STRESS_LAB_SPIKE_DISCLOSURE } from "@/application/stress-lab/spike-service";
import { StressLabWebMcpBridge } from "@/infrastructure/webmcp/StressLabWebMcpBridge";
import { useStressLabSpikeStore } from "@/state/stress-lab-spike-hooks";
import { configureScenarioFromManualUi } from "@/state/stress-lab-spike-runtime";
import styles from "./StressLabSpike.module.css";

interface ScenarioTemplate {
  label: string;
  vehicleCount: number;
  seatsPerVehicle: number;
}

const TEMPLATES: Record<StressLabScenarioSlot, ScenarioTemplate> = {
  A: {
    label: "Twelve compact pods",
    vehicleCount: 12,
    seatsPerVehicle: 8,
  },
  B: {
    label: "Ten higher-capacity pods",
    vehicleCount: 10,
    seatsPerVehicle: 10,
  },
};

function resultMessage(result: ConfigureScenarioResult): string {
  if (result.ok) {
    return `${result.artifactId} committed at revision ${result.stateRevision}.`;
  }
  return `${result.error.code}: ${result.error.message}`;
}

function ScenarioCard({
  slot,
  revision,
  scenario,
  selected,
}: {
  slot: StressLabScenarioSlot;
  revision: number;
  scenario: ProvisionalScenarioRevision | undefined;
  selected: boolean;
}) {
  const template = TEMPLATES[slot];
  const [label, setLabel] = useState(template.label);
  const [vehicleCount, setVehicleCount] = useState(template.vehicleCount);
  const [seatsPerVehicle, setSeatsPerVehicle] = useState(
    template.seatsPerVehicle,
  );
  const [message, setMessage] = useState(
    `Golden template ready for Scenario ${slot}.`,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = configureScenarioFromManualUi({
      operationId: `human-${slot.toLowerCase()}-${revision + 1}`,
      expectedRevision: revision,
      slot,
      mode: "REPLACE",
      configuration: {
        label,
        fleet: { vehicleCount, seatsPerVehicle },
      },
    });
    setMessage(resultMessage(result));
  }

  return (
    <article
      className={`${styles.scenarioCard} ${selected ? styles.selectedCard : ""}`}
      aria-labelledby={`scenario-${slot}-title`}
    >
      <header className={styles.scenarioHeader}>
        <div>
          <span>SCENARIO {slot}</span>
          <h2 id={`scenario-${slot}-title`}>
            {scenario?.configuration.label ?? "Not configured"}
          </h2>
        </div>
        <span className={scenario ? styles.configured : styles.pending}>
          {scenario ? "CONFIGURED" : "PENDING"}
        </span>
      </header>

      <dl className={styles.scenarioFacts}>
        <div>
          <dt>Vehicles</dt>
          <dd>{scenario?.configuration.fleet.vehicleCount ?? "—"}</dd>
        </div>
        <div>
          <dt>Seats / vehicle</dt>
          <dd>{scenario?.configuration.fleet.seatsPerVehicle ?? "—"}</dd>
        </div>
        <div>
          <dt>Total seats</dt>
          <dd>{scenario?.totalSeats ?? "—"}</dd>
        </div>
      </dl>

      <form className={styles.scenarioForm} onSubmit={submit}>
        <fieldset>
          <legend>Bounded integration-test configuration</legend>
          <label htmlFor={`scenario-${slot}-label`}>
            Scenario label
          </label>
          <input
            id={`scenario-${slot}-label`}
            name="label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            minLength={1}
            maxLength={48}
            aria-describedby={`scenario-${slot}-label-help`}
            required
          />
          <small id={`scenario-${slot}-label-help`}>
            Plain text, 1–48 characters.
          </small>

          <div className={styles.numericFields}>
            <div>
              <label htmlFor={`scenario-${slot}-vehicles`}>Vehicles</label>
              <input
                id={`scenario-${slot}-vehicles`}
                name="vehicleCount"
                type="number"
                inputMode="numeric"
                min={0}
                max={30}
                step={1}
                value={vehicleCount}
                onChange={(event) => {
                  const nextValue = event.target.valueAsNumber;
                  if (Number.isFinite(nextValue)) setVehicleCount(nextValue);
                }}
                required
              />
            </div>
            <div>
              <label htmlFor={`scenario-${slot}-seats`}>Seats / vehicle</label>
              <input
                id={`scenario-${slot}-seats`}
                name="seatsPerVehicle"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                step={1}
                value={seatsPerVehicle}
                onChange={(event) => {
                  const nextValue = event.target.valueAsNumber;
                  if (Number.isFinite(nextValue)) setSeatsPerVehicle(nextValue);
                }}
                required
              />
            </div>
          </div>

          <button type="submit">Configure Scenario {slot}</button>
        </fieldset>
      </form>
      <p className={styles.formResult} aria-live="polite">
        {message}
      </p>
    </article>
  );
}

export function StressLabSpike() {
  const domain = useStressLabSpikeStore((state) => state.domain);
  const ui = useStressLabSpikeStore((state) => state.ui);

  return (
    <main className={styles.labShell}>
      <StressLabWebMcpBridge />

      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">M</span>
          <div>
            <small>MAAV / GATE 2</small>
            <h1>Stress Lab Agency Proof</h1>
          </div>
        </div>
        <div className={styles.revision} aria-label={`Workspace revision ${domain.revision}`}>
          <span>WORKSPACE REVISION</span>
          <strong>{domain.revision}</strong>
        </div>
      </header>

      <section className={styles.truthStrip} aria-label="Prototype disclosure">
        <span aria-hidden="true" />
        <strong>{STRESS_LAB_SPIKE_DISCLOSURE}</strong>
        <b>•</b>
        <span>SYNTHETIC SIMULATION • NO LIVE FLEET CONTROL</span>
      </section>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>BROWSER-NATIVE CONTROL PATH</span>
          <h2>Can an independent agent operate the same state as a human?</h2>
          <p>
            This isolated proof registers two real WebMCP tools. It validates
            shared state, revisions, provenance, and UI synchronization before
            any mobility simulator is built.
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
        <div className={styles.scenarioGrid} aria-label="Provisional scenarios">
          <ScenarioCard
            slot="A"
            revision={domain.revision}
            scenario={domain.scenarios.A}
            selected={ui.selectedSlot === "A"}
          />
          <ScenarioCard
            slot="B"
            revision={domain.revision}
            scenario={domain.scenarios.B}
            selected={ui.selectedSlot === "B"}
          />
        </div>

        <aside className={styles.proofRail}>
          <section className={styles.toolCatalog}>
            <header>
              <div>
                <small>STATIC CATALOG</small>
                <h2>Gate 2 tools</h2>
              </div>
              <span>2 TOOLS</span>
            </header>
            <ol>
              <li>
                <code>read_lab_state</code>
                <span>Read-only inspection</span>
              </li>
              <li>
                <code>configure_scenario</code>
                <span>Revision-safe mutation</span>
              </li>
            </ol>
            <p>
              Catalog names describe the intended static contract. Registration
              status above reports whether this browser actually exposed them.
            </p>
          </section>

          <section className={styles.activityPanel} aria-labelledby="activity-title">
            <header>
              <div>
                <small>ATTRIBUTABLE OPERATIONS</small>
                <h2 id="activity-title">Activity evidence</h2>
              </div>
              <span>{ui.activities.length}</span>
            </header>
            {ui.activities.length === 0 ? (
              <div className={styles.emptyActivity}>
                No actions yet. Use a manual control or invoke a registered
                WebMCP tool.
              </div>
            ) : (
              <ol className={styles.activityList}>
                {ui.activities.map((activity) => (
                  <li key={activity.id}>
                    <span
                      className={`${styles.activityNode} ${styles[activity.status.toLowerCase()]}`}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{activity.title}</strong>
                      <code>{activity.actionName}</code>
                      <p>{activity.summary}</p>
                      <small>
                        {activity.source} • {activity.status}
                        {activity.resultingRevision === undefined
                          ? ""
                          : ` • REV ${activity.resultingRevision}`}
                        {activity.detailCode ? ` • ${activity.detailCode}` : ""}
                      </small>
                    </div>
                    <time dateTime={activity.startedAt}>
                      {activity.startedAt.slice(11, 19)}Z
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </section>

      <footer className={styles.footer}>
        <span>NO GOOGLE • NO EXTERNAL API • NO SIMULATION ENGINE</span>
        <span>MANUAL UI → SHARED SERVICE ← WEBMCP</span>
      </footer>
    </main>
  );
}
