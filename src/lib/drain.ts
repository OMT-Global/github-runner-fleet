import {
  deleteOrganizationRunner,
  fetchOrganizationRunnerGroups,
  fetchOrganizationRunners,
  type FetchLike
} from "./github.js";

export interface DrainRunnerPoolOptions {
  apiUrl: string;
  token: string;
  organization: string;
  runnerGroup: string;
  poolKey: string;
  runnerNames: string[];
  timeoutSeconds: number;
  intervalSeconds: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  fetchImpl?: FetchLike;
  onQuiesce?: (runner: { id: number; name: string }) => Promise<void>;
  onProgress?: (progress: DrainProgress) => void;
}

export interface DrainProgress {
  poolKey: string;
  iteration: number;
  status: "waiting" | "drained" | "timeout";
  total: number;
  cordoned: string[];
  busy: string[];
  missing: string[];
}

export interface DrainReport extends DrainProgress {
  organization: string;
  runnerGroup: string;
  timeoutSeconds: number;
  intervalSeconds: number;
}

export async function drainRunnerPool(
  options: DrainRunnerPoolOptions
): Promise<DrainReport> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const fetchImpl = options.fetchImpl;
  const runnerNames = [...new Set(options.runnerNames)];
  const runnerNameSet = new Set(runnerNames);
  const cordoned = new Set<string>();
  const deletedIds = new Set<number>();
  const absentObservations = new Map<string, number>();
  const deadline = now() + options.timeoutSeconds * 1000;
  let iteration = 0;
  let lastProgress: DrainProgress = {
    poolKey: options.poolKey,
    iteration: 0,
    status: "waiting",
    total: runnerNames.length,
    cordoned: [],
    busy: [],
    missing: [...runnerNames].sort()
  };

  const groups = await fetchOrganizationRunnerGroups(
    options.apiUrl,
    options.organization,
    options.token,
    fetchImpl,
    { deadlineMs: deadline, now, sleep }
  );
  const group = groups.find((entry) => entry.name === options.runnerGroup);
  if (!group) {
    throw new Error(
      `runner group ${options.runnerGroup} was not found in ${options.organization}`
    );
  }

  while (true) {
    if (iteration > 0 && now() >= deadline) {
      const report = toReport(options, { ...lastProgress, status: "timeout" });
      options.onProgress?.(report);
      return report;
    }
    iteration += 1;
    const runners = (
      await fetchOrganizationRunners(
        options.apiUrl,
        options.organization,
        options.token,
        fetchImpl,
        { deadlineMs: deadline, now, sleep }
      )
    ).filter(
      (runner) =>
        runner.runnerGroupId === group.id && runnerNameSet.has(runner.name)
    );

    const busy = runners
      .filter((runner) => runner.busy)
      .map((runner) => runner.name)
      .sort();

    for (const runner of runners.filter((entry) => !entry.busy)) {
      absentObservations.set(runner.name, 0);
      if (deletedIds.has(runner.id)) {
        continue;
      }

      await options.onQuiesce?.({ id: runner.id, name: runner.name });
      await deleteOrganizationRunner(
        options.apiUrl,
        options.organization,
        options.token,
        runner.id,
        fetchImpl,
        { deadlineMs: deadline, now, sleep }
      );
      deletedIds.add(runner.id);
      cordoned.add(runner.name);
    }

    const visibleRunnerNames = new Set(runners.map((runner) => runner.name));
    for (const name of runnerNames) {
      if (!visibleRunnerNames.has(name)) {
        absentObservations.set(name, (absentObservations.get(name) ?? 0) + 1);
      }
    }
    const missing = runnerNames
      .filter((name) => !visibleRunnerNames.has(name) && !cordoned.has(name))
      .sort();
    const stableAbsence = runnerNames.every(
      (name) => (absentObservations.get(name) ?? 0) >= 2
    );
    const progress: DrainProgress = {
      poolKey: options.poolKey,
      iteration,
      status: busy.length === 0 && stableAbsence ? "drained" : "waiting",
      total: runnerNames.length,
      cordoned: [...cordoned].sort(),
      busy,
      missing
    };
    lastProgress = progress;

    if (busy.length === 0 && stableAbsence) {
      const report = toReport(options, progress);
      options.onProgress?.(report);
      return report;
    }

    if (now() >= deadline) {
      const report = toReport(options, { ...progress, status: "timeout" });
      options.onProgress?.(report);
      return report;
    }

    options.onProgress?.(progress);
    await sleep(Math.min(options.intervalSeconds * 1000, Math.max(0, deadline - now())));
  }
}

function toReport(
  options: DrainRunnerPoolOptions,
  progress: DrainProgress
): DrainReport {
  return {
    ...progress,
    organization: options.organization,
    runnerGroup: options.runnerGroup,
    timeoutSeconds: options.timeoutSeconds,
    intervalSeconds: options.intervalSeconds
  };
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
