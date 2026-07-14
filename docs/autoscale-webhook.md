# Event-driven autoscaling

The `workflow_job` receiver complements the polling `pnpm scale` controller. It provides low-latency scale-up while polling remains the convergence safety net for missed or delayed webhook deliveries.

## Runtime contract

Configure a GitHub App or organization webhook for the `workflow_job` event. Provide `AUTOSCALE_WEBHOOK_SECRET`, a durable `AUTOSCALE_WEBHOOK_STATE_FILE`, and `AUTOSCALE_POLL_INTERVAL_SECONDS` in the protected runtime environment.

Start the receiver with the same protected environment and Synology configuration used by the poller:

```bash
pnpm autoscale-webhook -- \
  --listen 127.0.0.1:8080 \
  --config config/pools.yaml \
  --env /etc/github-runner-fleet/runner.env
```

Put the listener behind an authenticated TLS reverse proxy. Do not expose the Node listener directly to the internet. GitHub deliveries must include a valid `X-Hub-Signature-256`; invalid signatures return `401` before payload processing.

## Controller behavior

- Pool routes are derived from `config/pools.yaml`; operator-supplied label lists cannot bypass the configured fleet boundary.
- `queued` immediately enters the same min/max/threshold decision primitive used by polling and applies the updated Synology project.
- `completed` re-queries GitHub queue depth and observes the configured cooldown before scale-down. It drains removed slots before applying the smaller project.
- Actuations are serialized so concurrent webhook deliveries cannot overwrite pool size changes.
- Delivery IDs are persisted atomically with a 24-hour TTL and a 2,048-entry bound. The `(job ID, action)` tuple is the fallback when a delivery header is absent, so `queued`, `in_progress`, and `completed` for one job remain distinct.
- A delivery is recorded only after successful actuation. GitHub can safely retry a `500` response.

Run `pnpm scale` on the normal polling schedule even when the receiver is healthy. `pnpm doctor` reads the state file and warns when the last accepted event is older than `AUTOSCALE_POLL_INTERVAL_SECONDS` (300 seconds by default).

## Deployment options

The receiver can run as a supervised Node process beside the Synology controller, with its state path on durable host storage. A function deployment is also possible if it provides durable state, serialized actuation, access to the protected deployment environment, and network reachability to the Synology control plane. Stateless functions must not discard the delivery ledger.
