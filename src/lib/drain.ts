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
  const deadline = now() + options.timeoutSeconds * 1000;
  let iteration = 0;

  while (true) {
    iteration += 1;
    const groups = await fetchOrganizationRunnerGroups(
      options.apiUrl,
      options.organization,
      options.token,
      fetchImpl
    );
    const group = groups.find((entry) => entry.name === options.runnerGroup);
    if (!group) {
      throw new Error(
        `runner group ${options.runnerGroup} was not found in ${options.organization}`
      );
    }

    const runners = (
      await fetchOrganizationRunners(
        options.apiUrl,
        options.organization,
        options.token,
        fetchImpl
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
      if (cordoned.has(runner.name)) {
        continue;
      }

      await deleteOrganizationRunner(
        options.apiUrl,
        options.organization,
        options.token,
        runner.id,
        fetchImpl
      );
      cordoned.add(runner.name);
    }

    const visibleRunnerNames = new Set(runners.map((runner) => runner.name));
    const missing = runnerNames
      .filter((name) => !visibleRunnerNames.has(name) && !cordoned.has(name))
      .sort();
    const progress: DrainProgress = {
      poolKey: options.poolKey,
      iteration,
      status: busy.length === 0 ? "drained" : "waiting",
      total: runnerNames.length,
      cordoned: [...cordoned].sort(),
      busy,
      missing
    };

    if (busy.length === 0) {
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
    await sleep(options.intervalSeconds * 1000);
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
