import {
  createInitialStressLabSpikeState,
  type ConfigureScenarioCommand,
  type ConfigureScenarioResult,
  StressLabSpikeService,
} from "@/application/stress-lab/spike-service";
import {
  createStressLabSpikeStore,
  setStressLabWebMcpStatus,
  ZustandStressLabActivityReporter,
  ZustandStressLabSpikeRepository,
  type StressLabWebMcpStatus,
} from "@/infrastructure/persistence/stress-lab-spike-repository";

function createStressLabSpikeRuntime() {
  const store = createStressLabSpikeStore(createInitialStressLabSpikeState());
  const repository = new ZustandStressLabSpikeRepository(store);
  const service = new StressLabSpikeService(repository);
  const activity = new ZustandStressLabActivityReporter(store);
  return { store, repository, service, activity };
}

type StressLabSpikeRuntime = ReturnType<typeof createStressLabSpikeRuntime>;

interface StressLabSpikeRuntimeGlobal {
  __maavStressLabSpikeRuntimeV1?: StressLabSpikeRuntime;
}

const globalScope = globalThis as typeof globalThis &
  StressLabSpikeRuntimeGlobal;

const runtime =
  (globalScope.__maavStressLabSpikeRuntimeV1 ??=
    createStressLabSpikeRuntime());

export const stressLabSpikeStore = runtime.store;
export const stressLabSpikeRepository = runtime.repository;
export const stressLabSpikeService = runtime.service;
export const stressLabSpikeActivity = runtime.activity;

export function updateStressLabWebMcpStatus(
  status: StressLabWebMcpStatus,
  message: string,
): void {
  setStressLabWebMcpStatus(stressLabSpikeStore, status, message);
}

export function configureScenarioFromManualUi(
  command: ConfigureScenarioCommand,
): ConfigureScenarioResult {
  const activityId = stressLabSpikeActivity.begin({
    source: "HUMAN_UI",
    actionName: "configure_scenario",
    title: `Configure Scenario ${command.slot}`,
    summary: `Manual bounded replacement for Scenario ${command.slot}`,
  });

  const result = stressLabSpikeService.configureScenario(command, "HUMAN_UI");
  stressLabSpikeActivity.finish(activityId, {
    status: result.ok ? "SUCCEEDED" : "REJECTED",
    resultingRevision: result.stateRevision,
    detailCode: result.ok ? result.artifactId : result.error.code,
  });
  if (result.ok) stressLabSpikeActivity.selectSlot(command.slot);
  return result;
}
