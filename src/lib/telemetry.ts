import { z } from "zod";

export interface TelemetryConfig {
  enabled: boolean;
  endpoint: string;
  protocol?: "grpc" | "http/protobuf";
  serviceName?: string;
  headers?: string;
  tracesExporter: "otlp" | "none";
  metricsExporter: "otlp" | "none";
  logsExporter: "otlp" | "none";
  resourceAttributes: Record<string, string>;
}

export const telemetrySchema = z
  .object({
    enabled: z.boolean().default(false),
    endpoint: z.string().url().optional(),
    protocol: z.enum(["grpc", "http/protobuf"]).optional(),
    serviceName: z.string().min(1).optional(),
    headers: z.string().min(1).optional(),
    tracesExporter: z.enum(["otlp", "none"]).default("otlp"),
    metricsExporter: z.enum(["otlp", "none"]).default("otlp"),
    logsExporter: z.enum(["otlp", "none"]).default("otlp"),
    resourceAttributes: z.record(z.string(), z.string()).default({})
  })
  .default({
    enabled: false,
    tracesExporter: "otlp",
    metricsExporter: "otlp",
    logsExporter: "otlp",
    resourceAttributes: {}
  })
  .superRefine((telemetry, ctx) => {
    if (telemetry.enabled && !telemetry.endpoint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endpoint is required when telemetry.enabled is true",
        path: ["endpoint"]
      });
    }
  })
  .transform((telemetry): TelemetryConfig => ({
    enabled: telemetry.enabled,
    endpoint: telemetry.endpoint ?? "",
    protocol: telemetry.protocol,
    serviceName: telemetry.serviceName,
    headers: telemetry.headers,
    tracesExporter: telemetry.tracesExporter,
    metricsExporter: telemetry.metricsExporter,
    logsExporter: telemetry.logsExporter,
    resourceAttributes: telemetry.resourceAttributes
  }));

export function renderTelemetryEnvironment(
  telemetry: TelemetryConfig | undefined,
  defaults: {
    serviceName: string;
    resourceAttributes: Record<string, string>;
  }
): Record<string, string> {
  if (!telemetry?.enabled) {
    return {};
  }

  const resourceAttributes = {
    ...defaults.resourceAttributes,
    ...telemetry.resourceAttributes
  };
  const environment: Record<string, string> = {
    OTEL_EXPORTER_OTLP_ENDPOINT: telemetry.endpoint,
    OTEL_SERVICE_NAME: telemetry.serviceName ?? defaults.serviceName,
    OTEL_TRACES_EXPORTER: telemetry.tracesExporter,
    OTEL_METRICS_EXPORTER: telemetry.metricsExporter,
    OTEL_LOGS_EXPORTER: telemetry.logsExporter,
    OTEL_RESOURCE_ATTRIBUTES: Object.entries(resourceAttributes)
      .map(([key, value]) => `${key}=${value}`)
      .join(",")
  };

  if (telemetry.protocol) {
    environment.OTEL_EXPORTER_OTLP_PROTOCOL = telemetry.protocol;
  }

  if (telemetry.headers) {
    environment.OTEL_EXPORTER_OTLP_HEADERS = telemetry.headers;
  }

  return environment;
}
