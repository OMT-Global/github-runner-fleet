# syntax=docker/dockerfile:1.7

FROM --platform=$TARGETPLATFORM debian:bookworm-slim

ARG TARGETARCH
ARG RUNNER_VERSION=2.333.0

ENV DEBIAN_FRONTEND=noninteractive \
    RUNNER_SOURCE_HOME=/actions-runner

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gosu \
      jq \
      procps \
      tini \
      unzip \
      xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --home-dir /home/runner --shell /bin/bash runner

WORKDIR ${RUNNER_SOURCE_HOME}

RUN case "${TARGETARCH}" in \
      amd64) runner_arch="x64" ;; \
      arm64) runner_arch="arm64" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL \
      -o runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${runner_arch}-${RUNNER_VERSION}.tar.gz" \
    && tar -xzf runner.tar.gz \
    && rm runner.tar.gz \
    && ./bin/installdependencies.sh \
    && chown -R runner:runner ${RUNNER_SOURCE_HOME} /home/runner

COPY docker/runner-entrypoint.sh /usr/local/bin/runner-entrypoint.sh

RUN chmod 0755 /usr/local/bin/runner-entrypoint.sh

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "Runner.Listener" > /dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/usr/local/bin/runner-entrypoint.sh"]
