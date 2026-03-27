import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const logPath = process.env.MOCK_LOG_PATH ?? "/tmp/mock-api.log";
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

server.listen(8080, "0.0.0.0", () => {
  fs.appendFileSync(
    logPath,
    `${new Date().toISOString()} listening 0.0.0.0:8080\n`,
    "utf8"
  );
});
