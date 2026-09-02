"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { StressLabWebMcpBridge } from "@/infrastructure/webmcp/StressLabWebMcpBridge";
import {
  getBrowserStressLabRuntime,
  type StressLabRuntime,
} from "@/state/stress-lab-runtime";
import {
  getManualStressLabController,
  selectStressLabPresentation,
  useManualControllerState,
  useStressLabRuntimeState,
} from "@/state/stress-lab-hooks";
import { ActivityRail } from "./ActivityRail";
import { ComparisonPanel } from "./ComparisonPanel";
import { FindingReview } from "./FindingReview";
import { MetricsPanel } from "./MetricsPanel";
import { ScenarioPanel } from "./ScenarioPanel";
import {
  StressLabMap,
  type GoogleMapReadiness,
} from "./map/StressLabMap";
import styles from "./stress-lab.module.css";

const GOLDEN_PROMPT =
  "Configure the seed-07 A/B Stress Lab, apply the equivalent deterministic 08:42 failure to each scenario, run both, compare verified evidence, and stage a TRADE_OFF / BALANCED finding for human review.";

function StressLabLoading() {
  return (
    <main className={styles.labShell}>
      <div className={styles.loadingState} role="status">
        <span className={styles.loadingMark} aria-hidden="true">M</span>
        <div>
          <span className={styles.eyebrow}>MAAV STRESS LAB</span>
          <strong>Preparing the deterministic workspace…</strong>
        </div>
      </div>
    </main>
  );
}

function StressLabWorkbench({ runtime }: { readonly runtime: StressLabRuntime }) {
  const runtimeState = useStressLabRuntimeState(runtime);
  const presentation = selectStressLabPresentation(runtimeState);
  const controller = useMemo(() => getManualStressLabController(runtime), [runtime]);
  const manual = useManualControllerState(controller);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [mapReadiness, setMapReadiness] = useState<GoogleMapReadiness>(
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY &&
      process.env.NEXT_PUBLIC_GOOGLE_MAP_ID
      ? "LOADING"
      : "CONFIG_ERROR",
  );

  if (!presentation) return <StressLabLoading />;

  const { view, scenarios, comparison, finding } = presentation;
  const pendingReview = view.currentFinding?.review === "PENDING_REVIEW";
  const anyActive = manual.activeActions.length > 0 || view.activeOperations.length > 0;
  const runAActive = view.activeOperations.some((operation) => operation.target === "RUN:A");
  const runBActive = view.activeOperations.some((operation) => operation.target === "RUN:B");
  const canCompare = Boolean(
    view.currentRuns.A?.isCurrent &&
      view.currentRuns.B?.isCurrent &&
      !pendingReview,
  );
  const canStage = Boolean(view.currentComparison?.isCurrent);
  const scenarioA = scenarios.A;
  const scenarioB = scenarios.B;
  const differenceSummary = scenarioA && scenarioB
    ? `${scenarioA.draft.vehicleCount}×${scenarioA.draft.seatsPerVehicle} vs ${scenarioB.draft.vehicleCount}×${scenarioB.draft.seatsPerVehicle}`
    : "Initialize both scenarios";
  const firstScenarioId = presentation.application.currentScenarioRevisionIds.A;
  const firstScenario = firstScenarioId
    ? presentation.application.scenarioRevisions[firstScenarioId]
    : undefined;
  const network = firstScenario?.preparedInput.input.network.networkVersion ?? "Not initialized";
  const seed = firstScenario?.preparedInput.input.seed;
  const progress = view.progress[0];
  const progressBasisPoints = progress && progress.totalUnits > 0
    ? Math.floor((progress.completedUnits * 10_000) / progress.totalUnits)
    : 0;

  return (
    <main className={styles.labShell}>
      <StressLabWebMcpBridge />
      <div className={styles.heroPlane} aria-hidden="true">
        <span className={styles.heroAxisOne} />
        <span className={styles.heroAxisTwo} />
        <span className={styles.heroNodeOne} />
        <span className={styles.heroNodeTwo} />
        <span className={styles.heroNodeThree} />
      </div>

      <header className={styles.readinessHeader}>
        <div className={styles.brandLockup}>
          <span className={styles.brandMark} aria-hidden="true">M</span>
          <div>
            <span className={styles.eyebrow}>DESIGN IT · BREAK IT · MAKE IT RESILIENT</span>
            <h1>MAAV Stress Lab</h1>
          </div>
        </div>
        <div className={styles.readinessFacts} aria-label="Lab readiness">
          <span><b>REV</b> {view.revision}</span>
          <span className={presentation.webMcpStatus === "AVAILABLE" ? styles.readyFact : styles.warningFact}>
            <b>WEBMCP</b> {presentation.webMcpStatus === "AVAILABLE" ? "Available · 6 tools" : "Manual mode"}
          </span>
          <span><b>NETWORK</b> {network}</span>
          <span><b>SEED</b> {seed === undefined ? "—" : String(seed).padStart(2, "0")}</span>
          <span className={styles.readyFact}><b>ENGINE</b> Ready</span>
          <span className={mapReadiness === "READY" ? styles.readyFact : styles.warningFact}>
            <b>MAP</b> {mapReadiness === "READY" ? "Google presentation ready" : `${mapReadiness.replace("_", " ")} · evidence valid`}
          </span>
        </div>
        <button
          type="button"
          className={styles.resetButton}
          onClick={() => resetDialog.current?.showModal()}
          disabled={anyActive}
        >
          Reset lab
        </button>
      </header>

      <div className={styles.truthStrip} role="note">
        <strong>SYNTHETIC SIMULATION</strong>
        <span aria-hidden="true">•</span>
        <strong>NO LIVE FLEET CONTROL</strong>
        <span aria-hidden="true">•</span>
        <span>Deterministic evidence · visible human authority</span>
      </div>

      <section className={styles.heroIntro} aria-labelledby="experiment-title">
        <div>
          <span className={styles.eyebrow}>H0 MORNING-PEAK RESILIENCE EXPERIMENT</span>
          <h2 id="experiment-title">One corridor. One failure. Two accountable decisions.</h2>
          <p>
            Configure both immutable revisions, apply the equivalent 08:42 vehicle failure,
            and review only evidence committed by the trusted application authority.
          </p>
        </div>
        <div className={styles.experimentFacts}>
          <span><b>120</b> synthetic requests</span>
          <span><b>30 s</b> engine tick</span>
          <span><b>08:30–09:00</b> intake window</span>
          <span><b>08:42</b> equivalent failure</span>
        </div>
        <button
          type="button"
          className={styles.promptPill}
          onClick={() => {
            void navigator.clipboard?.writeText(GOLDEN_PROMPT).then(() => setPromptCopied(true));
          }}
        >
          <span>{promptCopied ? "Golden prompt copied" : "Copy browser-agent golden prompt"}</span>
          <small>PROVENANCE-SAFE · NO CHAT UI</small>
        </button>
      </section>

      <StressLabMap
        application={presentation.application}
        onReadinessChange={setMapReadiness}
      />

      {progress ? (
        <section className={styles.progressStrip} aria-live="polite" aria-label={`${progress.target} progress`}>
          <div>
            <span>{progress.target}</span>
            <strong>{progress.completedUnits} / {progress.totalUnits} deterministic units</strong>
          </div>
          <progress value={progressBasisPoints} max={10_000} />
        </section>
      ) : null}

      <div className={styles.workspace}>
        <div className={styles.evidenceCanvas}>
          <section className={styles.scenarioWorkbench} aria-label="Scenario workbench">
            <ScenarioPanel
              key={`scenario-A-${scenarioA?.id ?? "empty"}`}
              slot="A"
              scenario={scenarioA}
              run={view.currentRuns.A}
              differenceSummary={differenceSummary}
              busy={anyActive}
              runActive={runAActive}
              onConfigure={(draft) => void controller.configure("A", draft)}
              onInject={() => void controller.inject("A")}
              onRun={() => void controller.run("A")}
              onCancel={() => void controller.cancel("A")}
            />
            <ScenarioPanel
              key={`scenario-B-${scenarioB?.id ?? "empty"}`}
              slot="B"
              scenario={scenarioB}
              run={view.currentRuns.B}
              differenceSummary={differenceSummary}
              busy={anyActive}
              runActive={runBActive}
              onConfigure={(draft) => void controller.configure("B", draft)}
              onInject={() => void controller.inject("B")}
              onRun={() => void controller.run("B")}
              onCancel={() => void controller.cancel("B")}
            />
          </section>

          <section className={styles.metricsWorkbench} aria-label="Scenario evidence">
            <MetricsPanel slot="A" run={view.currentRuns.A} />
            <MetricsPanel slot="B" run={view.currentRuns.B} />
          </section>

          <ComparisonPanel
            comparison={comparison}
            canCompare={canCompare}
            canStage={canStage}
            busy={anyActive}
            pendingReview={pendingReview}
            onCompare={() => void controller.compare()}
            onStage={() => void controller.stageFinding()}
          />

          <FindingReview
            finding={finding}
            view={view.currentFinding}
            busy={anyActive}
            onAccept={() => void controller.acceptFinding()}
            onChallenge={(feedback) => void controller.challengeFinding(feedback)}
          />
        </div>

        <ActivityRail
          manual={manual.activities}
          webMcp={presentation.webMcpActivities}
          audit={view.audit}
        />
      </div>

      <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
        {manual.error || manual.notice}
      </div>

      {manual.lastInvalidatedArtifactIds.length > 0 ? (
        <div className={styles.invalidationNotice} role="status">
          <strong>Evidence invalidated by application authority</strong>
          <span>{manual.lastInvalidatedArtifactIds.join(" · ")}</span>
        </div>
      ) : null}

      <dialog className={styles.dialog} ref={resetDialog} aria-labelledby="reset-dialog-title">
        <form method="dialog">
          <span className={styles.eyebrow}>HUMAN-ONLY COMMAND</span>
          <h2 id="reset-dialog-title">Reset the Stress Lab?</h2>
          <p>
            This creates fresh golden Scenario A and B revisions. Historical evidence remains immutable,
            while current runs, comparison, and finding pointers are cleared.
          </p>
          <div className={styles.dialogActions}>
            <button type="submit" className={styles.secondaryButton}>Keep current lab</button>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => {
                resetDialog.current?.close();
                void controller.reset();
              }}
            >
              Confirm reset
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}

export function StressLab() {
  const runtime = useSyncExternalStore(
    () => () => undefined,
    () => getBrowserStressLabRuntime(),
    () => null,
  );

  return runtime ? <StressLabWorkbench runtime={runtime} /> : <StressLabLoading />;
}
