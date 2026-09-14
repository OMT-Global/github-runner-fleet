import { writeAuditRecord } from "../../src/lib/audit.js";
process.once("message", (message: {filePath: string; index: number}) => {
  try {
    writeAuditRecord({ event: "runner_job_start", runner_name: `process-${message.index}`,
      pool: "synology-private", plane: "synology", org: "omt-global" },
      { filePath: message.filePath, maxSizeBytes: 10000 });
    process.disconnect?.();
  } catch (error) { console.error(error); process.exit(1); }
});
process.send?.("ready");
