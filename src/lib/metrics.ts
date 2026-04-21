export interface MetricSample {
  name: string;
  value: number;
  labels?: Record<string, string | number | boolean>;
}

export interface MetricsFetchResponse {
  ok: boolean;
  status: number;
}

export type MetricsFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<MetricsFetchResponse>;

export interface EmitMetricsOptions {
  endpoint?: string;
  fetchImpl?: MetricsFetch;
}

export async function emitMetrics(
  samples: MetricSample[],
  options: EmitMetricsOptions = {}
): Promise<boolean> {
  const endpoint = options.endpoint ?? process.env.METRICS_ENDPOINT;
  if (!endpoint || samples.length === 0) {
    return false;
  }

  const fetchImpl = options.fetchImpl ?? (fetch as MetricsFetch);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8"
      },
      body: renderPrometheusSamples(samples)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function renderPrometheusSamples(samples: MetricSample[]): string {
  return samples.map(renderPrometheusSample).join("");
}

export function runnerRegistrationTotal(input: {
  plane: string;
  pool: string;
  status: string;
}): MetricSample {
  return {
    name: "runner_registration_total",
    value: 1,
    labels: input
  };
}

export function runnerJobCompleteTotal(input: {
  plane: string;
  pool: string;
}): MetricSample {
  return {
    name: "runner_job_complete_total",
    value: 1,
    labels: input
  };
}

export function runnerTokenFetchDurationSeconds(input: {
  plane: string;
  durationSeconds: number;
}): MetricSample {
  return {
    name: "runner_token_fetch_duration_seconds",
    value: input.durationSeconds,
    labels: {
      plane: input.plane
    }
  };
}

export function poolSlotCount(input: {
  plane: string;
  pool: string;
  count: number;
}): MetricSample {
  return {
    name: "pool_slot_count",
    value: input.count,
    labels: {
      plane: input.plane,
      pool: input.pool
    }
  };
}

export function doctorCheckResult(input: {
  check: string;
  status: string;
}): MetricSample {
  return {
    name: "doctor_check_result",
    value: 1,
    labels: input
  };
}

async function emitMetric(
  sample: MetricSample,
  options: EmitMetricsOptions = {}
): Promise<boolean> {
  return emitMetrics([sample], options);
}

export async function emitRunnerRegistrationTotal(
  input: {
    plane: string;
    pool: string;
    status: string;
  },
  options: EmitMetricsOptions = {}
): Promise<boolean> {
  return emitMetric(runnerRegistrationTotal(input), options);
}

export async function emitRunnerJobCompleteTotal(
  input: {
    plane: string;
    pool: string;
  },
  options: EmitMetricsOptions = {}
): Promise<boolean> {
  return emitMetric(runnerJobCompleteTotal(input), options);
}

export async function emitRunnerTokenFetchDurationSeconds(
  input: {
    plane: string;
    durationSeconds: number;
  },
  options: EmitMetricsOptions = {}
): Promise<boolean> {
  return emitMetric(runnerTokenFetchDurationSeconds(input), options);
}

function renderPrometheusSample(sample: MetricSample): string {
  const labels = sample.labels ? renderLabels(sample.labels) : "";
  return `${sample.name}${labels} ${sample.value}\n`;
}

function renderLabels(labels: Record<string, string | number | boolean>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return "";
  }

  return `{${entries
    .map(([key, value]) => `${key}="${escapeLabelValue(String(value))}"`)
    .join(",")}}`;
}

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}
