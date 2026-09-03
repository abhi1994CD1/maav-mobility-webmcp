"use client";

import Image from "next/image";
import {
  Activity,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Clipboard,
  GitCompareArrows,
  RotateCcw,
  Scale,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
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
import { StressLabMap } from "./map/StressLabMap";
import {
  ReplayAutoplayQueue,
  type ReplayAutoplayRequest,
} from "./map/replay-autoplay";
import {
  isTerminalWebMcpActivityStatus,
  latestWebMcpActivityStatus,
  webMcpReplayFocusFor,
  webMcpVisualTargetFor,
  type WebMcpVisualTarget,
} from "./webmcp-visual-orchestration";
import styles from "./stress-lab.module.css";

const GOLDEN_PROMPT =
  "Configure the seed-07 A/B Stress Lab, apply the equivalent deterministic 08:42 failure to each scenario, run both, compare verified evidence, and stage a TRADE_OFF / BALANCED finding for human review.";

type WorkbenchSurface = "COMPARISON" | "FINDING" | "ACTIVITY";

const SURFACE_TITLES: Readonly<Record<WorkbenchSurface, string>> = Object.freeze({
  COMPARISON: "Trusted comparison",
  FINDING: "Finding review",
  ACTIVITY: "Authority activity",
});

function SurfaceButton({
  surface,
  activeSurface,
  icon: Icon,
  label,
  detail,
  onSelect,
}: {
  readonly surface: WorkbenchSurface;
  readonly activeSurface: WorkbenchSurface | null;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly detail: string;
  readonly onSelect: (surface: WorkbenchSurface) => void;
}) {
  const active = activeSurface === surface;
  return (
    <button
      type="button"
      className={`${styles.surfaceButton} ${active ? styles.surfaceButtonActive : ""}`}
      aria-label={`Open ${SURFACE_TITLES[surface]}`}
      aria-expanded={active}
      aria-controls="stress-lab-control-drawer"
      onClick={() => onSelect(surface)}
    >
      <span className={styles.surfaceMarker} aria-hidden="true">
        <Icon size={14} strokeWidth={1.8} />
      </span>
      <span className={styles.surfaceCopy}>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <ChevronRight className={styles.surfaceArrow} size={13} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

function StressLabLoading() {
  return (
    <main className={`${styles.labShell} ${styles.loadingShell}`} aria-busy="true">
      <div className={styles.loadingState}>
        <div className={styles.loadingContent}>
          <Image
            className={styles.loadingLogo}
            src="/brand/Logo_transparent.png"
            width={467}
            height={102}
            alt="MAAV — Mobility with Intelligence"
            preload
          />
          <span className={styles.loadingRule} aria-hidden="true" />
          <p>Preparing deterministic workspace</p>
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
  const scenarioDialog = useRef<HTMLDialogElement>(null);
  const evidenceDialog = useRef<HTMLDialogElement>(null);
  const scenarioTabA = useRef<HTMLButtonElement>(null);
  const scenarioTabB = useRef<HTMLButtonElement>(null);
  const evidenceTabA = useRef<HTMLButtonElement>(null);
  const evidenceTabB = useRef<HTMLButtonElement>(null);
  const didPrimeWebMcpVisualControl = useRef(false);
  const lastHandledWebMcpActivityId = useRef(0);
  const lastHandledWebMcpTerminalId = useRef(0);
  const lastHandledWebMcpReplayFocusId = useRef(0);
  const webMcpVisualTargetRef = useRef<WebMcpVisualTarget | null>(null);
  const replayAutoplayQueue = useRef(new ReplayAutoplayQueue());
  const revealFindingAfterReplay = useRef(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [activeSurface, setActiveSurface] = useState<WorkbenchSurface | null>(null);
  const [scenarioDialogOpen, setScenarioDialogOpen] = useState(false);
  const [evidenceDialogOpen, setEvidenceDialogOpen] = useState(false);
  const [scenarioTab, setScenarioTab] = useState<"A" | "B">("A");
  const [evidenceTab, setEvidenceTab] = useState<"A" | "B">("A");
  const [webMcpVisualTarget, setWebMcpVisualTarget] =
    useState<WebMcpVisualTarget | null>(null);
  const [autoplayRequest, setAutoplayRequest] =
    useState<ReplayAutoplayRequest | null>(null);

  const showFindingSurface = () => {
    if (scenarioDialog.current?.open) scenarioDialog.current.close();
    if (evidenceDialog.current?.open) evidenceDialog.current.close();
    setScenarioDialogOpen(false);
    setEvidenceDialogOpen(false);
    setActiveSurface("FINDING");
  };

  const enqueueReplay = (request: ReplayAutoplayRequest) => {
    const started = replayAutoplayQueue.current.enqueue(request);
    if (scenarioDialog.current?.open) scenarioDialog.current.close();
    if (evidenceDialog.current?.open) evidenceDialog.current.close();
    setScenarioDialogOpen(false);
    setEvidenceDialogOpen(false);
    setActiveSurface(null);
    if (started) setAutoplayRequest(started);
  };

  const settleReplay = (
    request: ReplayAutoplayRequest,
  ) => {
    const settlement = replayAutoplayQueue.current.settle(request.id);
    if (!settlement.settled) return;
    setAutoplayRequest(settlement.next);
    if (!settlement.idle) return;

    const current = selectStressLabPresentation(runtime.store.getState());
    if (current?.view.currentFinding?.isCurrent) {
      revealFindingAfterReplay.current = false;
      showFindingSurface();
    } else {
      revealFindingAfterReplay.current = true;
    }
  };

  useEffect(() => {
    const initialPresentation = selectStressLabPresentation(runtime.store.getState());
    const initialActivity = initialPresentation?.webMcpActivities[0];
    if (!didPrimeWebMcpVisualControl.current) {
      didPrimeWebMcpVisualControl.current = true;
      lastHandledWebMcpActivityId.current = initialActivity?.id ?? 0;
      lastHandledWebMcpTerminalId.current = initialActivity?.id ?? 0;
      lastHandledWebMcpReplayFocusId.current = initialActivity?.id ?? 0;
    }

    return runtime.store.subscribe((state) => {
      const nextPresentation = selectStressLabPresentation(state);
      const latest = nextPresentation?.webMcpActivities[0];
      if (!latest) return;

      const replayFocus = webMcpReplayFocusFor(
        latest,
        state.ui.focusedObjectId,
        state.application.currentRunIds,
      );
      if (
        replayFocus &&
        replayFocus.activityId > lastHandledWebMcpReplayFocusId.current
      ) {
        lastHandledWebMcpReplayFocusId.current = replayFocus.activityId;
        enqueueReplay({
          id: `WEBMCP_READ:${replayFocus.activityId}`,
          slot: replayFocus.slot,
          runId: replayFocus.runId,
          source: "WEBMCP",
        });
      }

      if (latest.id > lastHandledWebMcpActivityId.current) {
        lastHandledWebMcpActivityId.current = latest.id;
        const target = webMcpVisualTargetFor(latest);
        if (!target) return;
        webMcpVisualTargetRef.current = target;
        setWebMcpVisualTarget(target);

        if (
          target.kind === "SCENARIO" &&
          !(
            target.action === "run" &&
            replayAutoplayQueue.current.hasWork()
          )
        ) {
          if (evidenceDialog.current?.open) evidenceDialog.current.close();
          setEvidenceDialogOpen(false);
          setActiveSurface(null);
          setScenarioTab(target.slot);
          setScenarioDialogOpen(true);
          if (!scenarioDialog.current?.open) scenarioDialog.current?.showModal();
        } else if (
          target.kind === "SURFACE" &&
          !replayAutoplayQueue.current.hasWork()
        ) {
          if (scenarioDialog.current?.open) scenarioDialog.current.close();
          if (evidenceDialog.current?.open) evidenceDialog.current.close();
          setScenarioDialogOpen(false);
          setEvidenceDialogOpen(false);
          setActiveSurface(target.surface);
        }
      }

      const target = webMcpVisualTargetRef.current;
      if (!target) return;
      const activity = nextPresentation?.webMcpActivities.find(
        (candidate) => candidate.id === target.activityId,
      );
      if (!activity) return;
      const status = latestWebMcpActivityStatus(activity);
      if (
        !isTerminalWebMcpActivityStatus(status) ||
        activity.id <= lastHandledWebMcpTerminalId.current
      ) {
        return;
      }
      lastHandledWebMcpTerminalId.current = activity.id;
      if (status === "FAILED" || status === "CANCELLED") {
        if (target.kind === "SURFACE" && target.surface === "FINDING") {
          revealFindingAfterReplay.current = false;
        }
        if (scenarioDialog.current?.open) scenarioDialog.current.close();
        if (evidenceDialog.current?.open) evidenceDialog.current.close();
        setScenarioDialogOpen(false);
        setEvidenceDialogOpen(false);
        setActiveSurface("ACTIVITY");
        return;
      }
      if (
        status === "COMMITTED" &&
        target.kind === "SCENARIO" &&
        target.action === "run"
      ) {
        if (scenarioDialog.current?.open) scenarioDialog.current.close();
        if (evidenceDialog.current?.open) evidenceDialog.current.close();
        setScenarioDialogOpen(false);
        setEvidenceDialogOpen(false);
        setActiveSurface(null);
        const runId = nextPresentation?.application.currentRunIds[target.slot];
        if (runId) {
          enqueueReplay({
            id: `WEBMCP:${activity.id}`,
            slot: target.slot,
            runId,
            source: "WEBMCP",
          });
        }
      }
      if (
        status === "COMMITTED" &&
        target.kind === "SURFACE" &&
        target.surface === "FINDING" &&
        revealFindingAfterReplay.current &&
        !replayAutoplayQueue.current.hasWork() &&
        nextPresentation?.view.currentFinding?.isCurrent
      ) {
        revealFindingAfterReplay.current = false;
        showFindingSurface();
      }
    });
  }, [runtime]);

  useEffect(() => {
    if (
      !webMcpVisualTarget ||
      webMcpVisualTarget.kind !== "SCENARIO" ||
      !scenarioDialogOpen ||
      scenarioTab !== webMcpVisualTarget.slot
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const target = scenarioDialog.current?.querySelector<HTMLElement>(
        `[data-scenario-slot="${webMcpVisualTarget.slot}"][data-webmcp-action="${webMcpVisualTarget.action}"]`,
      );
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      target?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
        inline: "nearest",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    presentation,
    scenarioDialogOpen,
    scenarioTab,
    webMcpVisualTarget,
  ]);

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
  const drawerTitle = activeSurface ? SURFACE_TITLES[activeSurface] : "Workbench";
  const selectSurface = (surface: WorkbenchSurface) => {
    setActiveSurface((current) => current === surface ? null : surface);
  };
  const openScenarioWorkbench = (slot: "A" | "B" = "A") => {
    const dialog = scenarioDialog.current;
    if (!dialog) return;
    if (evidenceDialog.current?.open) evidenceDialog.current.close();
    setEvidenceDialogOpen(false);
    setActiveSurface(null);
    setScenarioTab(slot);
    setScenarioDialogOpen(true);
    if (!dialog.open) dialog.showModal();
  };
  const selectScenarioTab = (slot: "A" | "B") => {
    setScenarioTab(slot);
  };
  const handleScenarioTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let target: "A" | "B" | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      target = scenarioTab === "A" ? "B" : "A";
    } else if (event.key === "Home") {
      target = "A";
    } else if (event.key === "End") {
      target = "B";
    }
    if (!target) return;
    event.preventDefault();
    setScenarioTab(target);
    (target === "A" ? scenarioTabA : scenarioTabB).current?.focus();
  };
  const openEvidenceWorkbench = (slot: "A" | "B" = "A") => {
    const dialog = evidenceDialog.current;
    if (!dialog) return;
    if (scenarioDialog.current?.open) scenarioDialog.current.close();
    setScenarioDialogOpen(false);
    setActiveSurface(null);
    setEvidenceTab(slot);
    setEvidenceDialogOpen(true);
    if (!dialog.open) dialog.showModal();
  };
  const selectEvidenceTab = (slot: "A" | "B") => {
    setEvidenceTab(slot);
  };
  const handleEvidenceTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let target: "A" | "B" | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      target = evidenceTab === "A" ? "B" : "A";
    } else if (event.key === "Home") {
      target = "A";
    } else if (event.key === "End") {
      target = "B";
    }
    if (!target) return;
    event.preventDefault();
    setEvidenceTab(target);
    (target === "A" ? evidenceTabA : evidenceTabB).current?.focus();
  };
  const scenarioSummary = `A ${scenarioA ? `${scenarioA.draft.vehicleCount}×${scenarioA.draft.seatsPerVehicle}` : "—"} · B ${scenarioB ? `${scenarioB.draft.vehicleCount}×${scenarioB.draft.seatsPerVehicle}` : "—"}`;
  const evidenceSummary = `A ${view.currentRuns.A?.isCurrent ? "current" : "—"} · B ${view.currentRuns.B?.isCurrent ? "current" : "—"}`;
  const highlightedWebMcpActivity = webMcpVisualTarget
    ? presentation.webMcpActivities.find(
        (activity) => activity.id === webMcpVisualTarget.activityId,
      )
    : undefined;
  const highlightedWebMcpStatus = highlightedWebMcpActivity
    ? latestWebMcpActivityStatus(highlightedWebMcpActivity)
    : undefined;
  const terminalWebMcpAnnouncement =
    highlightedWebMcpActivity &&
    highlightedWebMcpStatus &&
    isTerminalWebMcpActivityStatus(highlightedWebMcpStatus)
      ? `WebMCP ${highlightedWebMcpActivity.toolName.replaceAll("_", " ")} ${highlightedWebMcpStatus.toLowerCase()}.`
      : "";

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
        <h1 className={styles.brandLockup}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.brandLogo}
            src="/brand/maav-logo.png"
            alt=""
            aria-hidden="true"
            width={35}
            height={26}
          />
          <span className={styles.brandDivider} aria-hidden="true" />
          <span className={styles.visuallyHidden}>MAAV Stress Lab</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={`${styles.brandLogo} ${styles.brandLogoNeo}`}
            src="/brand/neo-lab-logo.png"
            alt=""
            aria-hidden="true"
            width={1806}
            height={186}
          />
          <span className={styles.brandVersion}>v0.5</span>
        </h1>
        <div className={styles.readinessFacts} aria-label="Lab readiness">
          <span><b>REV</b> {view.revision}</span>
          <span className={presentation.webMcpStatus === "AVAILABLE" ? styles.readyFact : styles.warningFact}>
            <b>WEBMCP</b> {presentation.webMcpStatus === "AVAILABLE" ? "Available · 6 tools" : "Manual mode"}
          </span>
          <span><b>NETWORK</b> {network}</span>
          <span><b>SEED</b> {seed === undefined ? "—" : String(seed).padStart(2, "0")}</span>
          <span className={styles.readyFact}><b>ENGINE</b> Ready</span>
        </div>
      </header>

      <StressLabMap
        application={presentation.application}
        autoplayRequest={autoplayRequest}
        onAutoplaySettled={settleReplay}
        actions={(
          <button
            type="button"
            className={styles.resetButton}
            onClick={() => resetDialog.current?.showModal()}
            disabled={anyActive}
          >
            <RotateCcw size={14} aria-hidden="true" />
            <span>Reset</span>
          </button>
        )}
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

      <nav className={styles.controlRail} aria-label="Stress Lab workbench">
        <button
          type="button"
          className={`${styles.workbenchLauncher} ${scenarioDialogOpen ? styles.workbenchLauncherActive : ""}`}
          onClick={() => openScenarioWorkbench()}
          aria-haspopup="dialog"
          aria-expanded={scenarioDialogOpen}
          aria-controls="scenario-workbench-dialog"
        >
          <span className={styles.workbenchLauncherIcon} aria-hidden="true">
            <Settings2 size={15} strokeWidth={1.7} />
          </span>
          <span className={styles.workbenchLauncherCopy}>
            <small>WORKBENCH</small>
            <strong>Scenarios</strong>
            <em>{scenarioSummary}</em>
          </span>
          <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.workbenchLauncher} ${styles.evidenceLauncher} ${evidenceDialogOpen ? styles.evidenceLauncherActive : ""}`}
          onClick={() => openEvidenceWorkbench()}
          aria-haspopup="dialog"
          aria-expanded={evidenceDialogOpen}
          aria-controls="evidence-workbench-dialog"
        >
          <span className={styles.workbenchLauncherIcon} aria-hidden="true">
            <ChartNoAxesCombined size={15} strokeWidth={1.7} />
          </span>
          <span className={styles.workbenchLauncherCopy}>
            <small>COMMITTED RUNS</small>
            <strong>Evidence</strong>
            <em>{evidenceSummary}</em>
          </span>
          <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <section className={styles.surfaceGroup} aria-label="Decision surfaces">
          <SurfaceButton surface="COMPARISON" activeSurface={activeSurface} icon={GitCompareArrows} label="Compare" detail={comparison ? "Ready" : "2 runs"} onSelect={selectSurface} />
          <SurfaceButton surface="FINDING" activeSurface={activeSurface} icon={Scale} label="Finding" detail={pendingReview ? "Pending" : "Review"} onSelect={selectSurface} />
          <SurfaceButton surface="ACTIVITY" activeSurface={activeSurface} icon={Activity} label="Activity" detail={`${manual.activities.length + presentation.webMcpActivities.length} live`} onSelect={selectSurface} />
        </section>
        <button
          type="button"
          className={`${styles.workbenchLauncher} ${styles.promptLauncher}`}
          aria-label="Copy the seed-07 agent prompt"
          onClick={() => {
            void navigator.clipboard?.writeText(GOLDEN_PROMPT).then(() => {
              setPromptCopied(true);
              setTimeout(() => setPromptCopied(false), 1800);
            });
          }}
        >
          <span className={styles.workbenchLauncherIcon} aria-hidden="true">
            {promptCopied ? <Check size={15} strokeWidth={1.8} /> : <Clipboard size={15} strokeWidth={1.8} />}
          </span>
          <span className={styles.workbenchLauncherCopy} aria-live="polite">
            <small>AGENT WORKFLOW</small>
            <strong>{promptCopied ? "Prompt copied" : "Copy prompt"}</strong>
            <em>Seed-07 golden brief</em>
          </span>
        </button>
      </nav>

      <aside
        id="stress-lab-control-drawer"
        className={styles.controlDrawer}
        aria-label={drawerTitle}
        hidden={!activeSurface}
      >
        <header className={styles.drawerHeader}>
          <div>
            <span className={styles.eyebrow}>ACTIVE WORK SURFACE</span>
            <h2>{drawerTitle}</h2>
          </div>
          <button type="button" className={styles.drawerClose} onClick={() => setActiveSurface(null)} aria-label={`Close ${drawerTitle}`}>
            <X size={14} aria-hidden="true" />
            <span>Close</span>
          </button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.drawerPane} hidden={activeSurface !== "COMPARISON"}>
            <ComparisonPanel
              comparison={comparison}
              canCompare={canCompare}
              canStage={canStage}
              busy={anyActive}
              pendingReview={pendingReview}
              onCompare={() => void controller.compare()}
              onStage={() => {
                void controller.stageFinding().then((outcome) => {
                  if (!outcome.ok) return;
                  if (replayAutoplayQueue.current.hasWork()) {
                    revealFindingAfterReplay.current = true;
                    return;
                  }
                  showFindingSurface();
                });
              }}
            />
          </div>
          <div className={styles.drawerPane} hidden={activeSurface !== "FINDING"}>
            <FindingReview
              finding={finding}
              view={view.currentFinding}
              busy={anyActive}
              onAccept={() => void controller.acceptFinding()}
              onChallenge={(feedback) => void controller.challengeFinding(feedback)}
            />
          </div>
          <div className={styles.drawerPane} hidden={activeSurface !== "ACTIVITY"}>
            <ActivityRail
              manual={manual.activities}
              webMcp={presentation.webMcpActivities}
              audit={view.audit}
            />
          </div>
        </div>
      </aside>

      <dialog
        id="scenario-workbench-dialog"
        className={styles.scenarioDialog}
        ref={scenarioDialog}
        closedby="any"
        aria-labelledby="scenario-workbench-title"
        aria-describedby="scenario-workbench-description"
        onClose={() => setScenarioDialogOpen(false)}
      >
        <div className={styles.scenarioDialogShell}>
          <header className={styles.scenarioDialogHeader}>
            <div className={styles.scenarioDialogIdentity}>
              <span className={styles.scenarioDialogMark} aria-hidden="true">
                <Settings2 size={18} strokeWidth={1.6} />
              </span>
              <div>
                <span className={styles.eyebrow}>EXPERIMENT WORKBENCH</span>
                <h2 id="scenario-workbench-title">Configure scenarios</h2>
                <p id="scenario-workbench-description">
                  Edit one immutable scenario draft at a time. Configuration, disruption, and run commands remain application-authoritative.
                </p>
              </div>
            </div>
            <button
              type="button"
              className={styles.scenarioDialogClose}
              onClick={() => scenarioDialog.current?.close()}
              aria-label="Close scenario workbench"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className={styles.scenarioTabs} role="tablist" aria-label="Scenario configuration">
            {(["A", "B"] as const).map((slot) => {
              const scenario = slot === "A" ? scenarioA : scenarioB;
              const selected = scenarioTab === slot;
              return (
                <button
                  key={slot}
                  ref={slot === "A" ? scenarioTabA : scenarioTabB}
                  id={`scenario-${slot.toLowerCase()}-tab`}
                  type="button"
                  role="tab"
                  className={`${styles.scenarioTab} ${slot === "A" ? styles.scenarioTabA : styles.scenarioTabB}`}
                  aria-selected={selected}
                  aria-controls={`scenario-${slot.toLowerCase()}-tabpanel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectScenarioTab(slot)}
                  onKeyDown={handleScenarioTabKeyDown}
                >
                  <span>Scenario {slot}</span>
                  <strong>{scenario ? `${scenario.draft.vehicleCount} × ${scenario.draft.seatsPerVehicle}` : "Not initialized"}</strong>
                  <small>{scenario?.disrupted ? "08:42 failure scheduled" : scenario?.configured ? "Baseline configured" : "Golden template"}</small>
                </button>
              );
            })}
          </div>

          {webMcpVisualTarget?.kind === "SCENARIO" && highlightedWebMcpActivity ? (
            <div
              className={styles.webMcpControlStatus}
              data-status={highlightedWebMcpStatus}
              aria-label={`WebMCP ${highlightedWebMcpActivity.toolName.replaceAll("_", " ")} ${highlightedWebMcpStatus?.toLowerCase() ?? "received"}`}
            >
              <span>
                <Activity size={13} strokeWidth={1.8} aria-hidden="true" />
                WEBMCP CONTROL
              </span>
              <strong>
                {highlightedWebMcpActivity.toolName.replaceAll("_", " ")}
                <b>{highlightedWebMcpStatus ?? "RECEIVED"}</b>
              </strong>
              <code>{highlightedWebMcpActivity.operationId ?? "read-only"}</code>
            </div>
          ) : null}

          <div className={styles.scenarioDialogBody}>
            <div
              id="scenario-a-tabpanel"
              role="tabpanel"
              aria-labelledby="scenario-a-tab"
              tabIndex={0}
              hidden={scenarioTab !== "A"}
            >
              <ScenarioPanel
                key={`scenario-A-${scenarioA?.id ?? "empty"}`}
                slot="A"
                scenario={scenarioA}
                run={view.currentRuns.A}
                differenceSummary={differenceSummary}
                busy={anyActive}
                runActive={runAActive}
                highlightedWebMcpAction={
                  webMcpVisualTarget?.kind === "SCENARIO" &&
                  webMcpVisualTarget.slot === "A"
                    ? webMcpVisualTarget.action
                    : undefined
                }
                onConfigure={(draft) => void controller.configure("A", draft)}
                onInject={() => void controller.inject("A")}
                onRun={() => {
                  void controller.run("A").then((outcome) => {
                    if (!outcome.ok || !outcome.result.artifactId) return;
                    enqueueReplay({
                      id: `HUMAN_UI:${outcome.result.operationId}`,
                      slot: "A",
                      runId: outcome.result.artifactId,
                      source: "HUMAN_UI",
                    });
                  });
                }}
                onCancel={() => void controller.cancel("A")}
              />
            </div>
            <div
              id="scenario-b-tabpanel"
              role="tabpanel"
              aria-labelledby="scenario-b-tab"
              tabIndex={0}
              hidden={scenarioTab !== "B"}
            >
              <ScenarioPanel
                key={`scenario-B-${scenarioB?.id ?? "empty"}`}
                slot="B"
                scenario={scenarioB}
                run={view.currentRuns.B}
                differenceSummary={differenceSummary}
                busy={anyActive}
                runActive={runBActive}
                highlightedWebMcpAction={
                  webMcpVisualTarget?.kind === "SCENARIO" &&
                  webMcpVisualTarget.slot === "B"
                    ? webMcpVisualTarget.action
                    : undefined
                }
                onConfigure={(draft) => void controller.configure("B", draft)}
                onInject={() => void controller.inject("B")}
                onRun={() => {
                  void controller.run("B").then((outcome) => {
                    if (!outcome.ok || !outcome.result.artifactId) return;
                    enqueueReplay({
                      id: `HUMAN_UI:${outcome.result.operationId}`,
                      slot: "B",
                      runId: outcome.result.artifactId,
                      source: "HUMAN_UI",
                    });
                  });
                }}
                onCancel={() => void controller.cancel("B")}
              />
            </div>
          </div>
        </div>
      </dialog>

      <dialog
        id="evidence-workbench-dialog"
        className={`${styles.scenarioDialog} ${styles.evidenceDialog}`}
        ref={evidenceDialog}
        closedby="any"
        aria-labelledby="evidence-workbench-title"
        aria-describedby="evidence-workbench-description"
        onClose={() => setEvidenceDialogOpen(false)}
      >
        <div className={styles.scenarioDialogShell}>
          <header className={styles.scenarioDialogHeader}>
            <div className={styles.scenarioDialogIdentity}>
              <span className={`${styles.scenarioDialogMark} ${styles.evidenceDialogMark}`} aria-hidden="true">
                <ChartNoAxesCombined size={18} strokeWidth={1.6} />
              </span>
              <div>
                <span className={styles.eyebrow}>COMMITTED RUN EVIDENCE</span>
                <h2 id="evidence-workbench-title">Scenario evidence</h2>
                <p id="evidence-workbench-description">
                  Inspect verified metrics, constraints, artifact identities, and fingerprints from one current scenario run at a time.
                </p>
              </div>
            </div>
            <button
              type="button"
              className={styles.scenarioDialogClose}
              onClick={() => evidenceDialog.current?.close()}
              aria-label="Close scenario evidence"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className={styles.scenarioTabs} role="tablist" aria-label="Evidence scenario">
            {(["A", "B"] as const).map((slot) => {
              const run = view.currentRuns[slot];
              const selected = evidenceTab === slot;
              return (
                <button
                  key={slot}
                  ref={slot === "A" ? evidenceTabA : evidenceTabB}
                  id={`evidence-${slot.toLowerCase()}-tab`}
                  type="button"
                  role="tab"
                  className={`${styles.scenarioTab} ${slot === "A" ? styles.scenarioTabA : styles.scenarioTabB}`}
                  aria-selected={selected}
                  aria-controls={`evidence-${slot.toLowerCase()}-tabpanel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectEvidenceTab(slot)}
                  onKeyDown={handleEvidenceTabKeyDown}
                >
                  <span>Scenario {slot}</span>
                  <strong>{run?.isCurrent ? "Current" : run ? "Stale" : "No run"}</strong>
                  <small>{run ? "Verified artifact available" : "Awaiting committed evidence"}</small>
                </button>
              );
            })}
          </div>

          <div className={styles.scenarioDialogBody}>
            <div
              id="evidence-a-tabpanel"
              role="tabpanel"
              aria-labelledby="evidence-a-tab"
              tabIndex={0}
              hidden={evidenceTab !== "A"}
            >
              <MetricsPanel slot="A" run={view.currentRuns.A} />
            </div>
            <div
              id="evidence-b-tabpanel"
              role="tabpanel"
              aria-labelledby="evidence-b-tab"
              tabIndex={0}
              hidden={evidenceTab !== "B"}
            >
              <MetricsPanel slot="B" run={view.currentRuns.B} />
            </div>
          </div>
        </div>
      </dialog>

      <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
        {manual.error || manual.notice || terminalWebMcpAnnouncement}
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
          <h2 id="reset-dialog-title">Load the default lab?</h2>
          <p>
            This loads the default golden Scenario A and B revisions. Historical evidence remains immutable,
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
              Load default lab
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
