# syntax=docker/dockerfile:1.7

FROM --platform=$TARGETPLATFORM python:3.12-slim-bookworm

ARG TARGETARCH
ARG RUNNER_VERSION=2.333.0
ARG NODE_VERSION=18.20.8
ARG TERRAFORM_VERSION=1.6.6

ENV DEBIAN_FRONTEND=noninteractive \
    RUNNER_SOURCE_HOME=/actions-runner \
    RUNNER_TEMP=/tmp/github-runner-temp \
    RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      docker.io \
      git \
      gosu \
      jq \
      procps \
      tar \
      tini \
      unzip \
      xz-utils \
      zstd \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --home-dir /home/runner --shell /bin/bash runner \
    && mkdir -p "${RUNNER_TOOL_CACHE}" "${RUNNER_TEMP}" /opt/node18 \
    && chown -R runner:runner /home/runner "${RUNNER_TOOL_CACHE}" "${RUNNER_TEMP}" /opt/node18

RUN case "${TARGETARCH}" in \
      amd64) node_arch="x64"; terraform_arch="amd64"; python_arch="x64" ;; \
      arm64) node_arch="arm64"; terraform_arch="arm64"; python_arch="arm64" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && python_version="$(python3 -c 'import platform; print(platform.python_version())')" \
    && python_cache_root="${RUNNER_TOOL_CACHE}/Python/${python_version}" \
    && mkdir -p "${python_cache_root}" \
    && ln -sfn /usr/local "${python_cache_root}/${python_arch}" \
    && : > "${python_cache_root}/${python_arch}.complete" \
    && chown runner:runner "${python_cache_root}" "${python_cache_root}/${python_arch}.complete" \
    && chown -h runner:runner "${python_cache_root}/${python_arch}" \
    && node_archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}" \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    && grep " ${node_archive}\$" SHASUMS256.txt | sha256sum -c - \
    && tar -xJf "${node_archive}" -C /opt/node18 --strip-components=1 --no-same-owner \
    && ln -sf /opt/node18/bin/corepack /usr/local/bin/corepack \
    && ln -sf /opt/node18/bin/node /usr/local/bin/node \
    && ln -sf /opt/node18/bin/npm /usr/local/bin/npm \
    && ln -sf /opt/node18/bin/npx /usr/local/bin/npx \
    && rm -f "${node_archive}" SHASUMS256.txt \
    && terraform_archive="terraform_${TERRAFORM_VERSION}_linux_${terraform_arch}.zip" \
    && curl -fsSLO "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/${terraform_archive}" \
    && curl -fsSLO "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_SHA256SUMS" \
    && grep " ${terraform_archive}\$" "terraform_${TERRAFORM_VERSION}_SHA256SUMS" | sha256sum -c - \
    && unzip -q "${terraform_archive}" -d /usr/local/bin \
    && rm -f "${terraform_archive}" "terraform_${TERRAFORM_VERSION}_SHA256SUMS"

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

COPY scripts/lib/github-runner-common.sh /usr/local/lib/github-runner-common.sh
COPY docker/runner-entrypoint.sh /usr/local/bin/runner-entrypoint.sh

RUN chmod 0755 /usr/local/lib/github-runner-common.sh /usr/local/bin/runner-entrypoint.sh

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "Runner.Listener" > /dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/usr/local/bin/runner-entrypoint.sh"]
