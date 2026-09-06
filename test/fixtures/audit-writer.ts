import { writeAuditRecord } from "../../src/lib/audit.js";

const [filePath, index] = process.argv.slice(2);

process.once("message", (message) => {
  if (message !== "write") throw new Error("expected audit write command");
  writeAuditRecord({
    event: "runner_job_start",
    runner_name: `process-${index}`,
    pool: "synology-private",
    plane: "synology",
    org: "omt-global"
  }, { filePath, maxSizeBytes: 10_000 });
  process.disconnect();
});

process.send!("ready");
