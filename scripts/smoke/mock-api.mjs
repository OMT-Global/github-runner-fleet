import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const logPath = process.env.MOCK_LOG_PATH ?? "/tmp/mock-api.log";
const port = Number(process.env.MOCK_PORT ?? "8080");
const host = process.env.MOCK_HOST ?? "0.0.0.0";
fs.mkdirSync(path.dirname(logPath), { recursive: true });

const server = http.createServer((req, res) => {
  fs.appendFileSync(
    logPath,
    `${new Date().toISOString()} ${req.method} ${req.url}\n`,
    "utf8"
  );

  if (req.method === "POST" && req.url === "/orgs/test-org/actions/runners/registration-token") {
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ token: "registration-token" }));
    return;
  }

  if (req.method === "POST" && req.url === "/orgs/test-org/actions/runners/remove-token") {
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ token: "remove-token" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, host, () => {
  fs.appendFileSync(
    logPath,
    `${new Date().toISOString()} listening ${host}:${port}\n`,
    "utf8"
  );
  // Deterministic readiness signal: consumers wait on this stdout line
  // instead of polling the log file, so startup is event-driven.
  process.stdout.write(`ready ${host}:${port}\n`);
});
