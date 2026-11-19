# syntax=docker/dockerfile:1.7

FROM --platform=$TARGETPLATFORM python:3.15-slim-trixie

ARG TARGETARCH
ARG NODE_VERSION=26.13.1
# Node.js 25+ no longer bundles corepack; install it from npm, pinned.
ARG COREPACK_VERSION=0.36.0
ARG TERRAFORM_VERSION=1.17.2
ARG GO_VERSION=1.27.4
# Pinned digests from go.dev/dl for GO_VERSION; override all three together.
ARG GO_SHA256_AMD64=7226736c2339719cda28fbf3a54d71aa63bcefe376e98cef00034268dab24840
ARG GO_SHA256_ARM64=3392582988a273a87ab5043ee1b2c9c17a2c3c00580bf9326c47a2e0aaaeac92

COPY .runner-version .runner-checksums /

ENV DEBIAN_FRONTEND=noninteractive \
    SHELL=/bin/bash \
    RUNNER_SOURCE_HOME=/actions-runner \
    RUNNER_TEMP=/tmp/github-runner-temp \
    RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      ca-certificates \
      curl \
      gettext-base \
      git \
      gosu \
      jq \
      libsqlite3-dev \
      pkg-config \
      procps \
      tar \
      tini \
      unzip \
      xz-utils \
      zstd \
    && rm -rf /var/lib/apt/lists/*

RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --home-dir /home/runner --shell /bin/bash runner \
    && mkdir -p "${RUNNER_TOOL_CACHE}" "${RUNNER_TEMP}" /opt/node \
    && chown -R runner:runner /home/runner "${RUNNER_TOOL_CACHE}" "${RUNNER_TEMP}" /opt/node

RUN case "${TARGETARCH}" in \
      amd64) node_arch="x64"; terraform_arch="amd64"; python_arch="x64"; go_arch="amd64"; go_sha256="${GO_SHA256_AMD64}" ;; \
      arm64) node_arch="arm64"; terraform_arch="arm64"; python_arch="arm64"; go_arch="arm64"; go_sha256="${GO_SHA256_ARM64}" ;; \
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
    && tar -xJf "${node_archive}" -C /opt/node --strip-components=1 --no-same-owner \
    && ln -sf /opt/node/bin/corepack /usr/local/bin/corepack \
    && ln -sf /opt/node/bin/node /usr/local/bin/node \
    && ln -sf /opt/node/bin/npm /usr/local/bin/npm \
    && ln -sf /opt/node/bin/npx /usr/local/bin/npx \
    && npm install --global --no-fund --no-audit --no-update-notifier "corepack@${COREPACK_VERSION}" \
    && corepack --version \
    && rm -f "${node_archive}" SHASUMS256.txt \
    && terraform_archive="terraform_${TERRAFORM_VERSION}_linux_${terraform_arch}.zip" \
    && curl -fsSLO "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/${terraform_archive}" \
    && curl -fsSLO "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_SHA256SUMS" \
    && grep " ${terraform_archive}\$" "terraform_${TERRAFORM_VERSION}_SHA256SUMS" | sha256sum -c - \
    && unzip -q "${terraform_archive}" -d /usr/local/bin \
    && rm -f "${terraform_archive}" "terraform_${TERRAFORM_VERSION}_SHA256SUMS" \
    && go_archive="go${GO_VERSION}.linux-${go_arch}.tar.gz" \
    && curl -fsSLO "https://dl.google.com/go/${go_archive}" \
    && printf '%s  %s\n' "${go_sha256}" "${go_archive}" | sha256sum -c - \
    && tar -xzf "${go_archive}" -C /usr/local --no-same-owner \
    && ln -sf /usr/local/go/bin/go /usr/local/bin/go \
    && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
    && rm -f "${go_archive}"

WORKDIR ${RUNNER_SOURCE_HOME}

RUN case "${TARGETARCH}" in \
      amd64) runner_arch="x64" ;; \
      arm64) runner_arch="arm64" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && runner_version="$(cat /.runner-version)" \
    && runner_asset="actions-runner-linux-${runner_arch}-${runner_version}.tar.gz" \
    && curl -fsSL \
      -o "${runner_asset}" \
      "https://github.com/actions/runner/releases/download/v${runner_version}/${runner_asset}" \
    && awk -v asset="${runner_asset}" '$2 == asset' /.runner-checksums > runner.sha256 \
    && test "$(wc -l < runner.sha256)" -eq 1 \
    && sha256sum -c runner.sha256 \
    && tar -xzf "${runner_asset}" \
    && rm "${runner_asset}" runner.sha256 \
    && ./bin/installdependencies.sh \
    && chown -R runner:runner ${RUNNER_SOURCE_HOME} /home/runner

COPY scripts/lib/github-runner-common.sh /usr/local/lib/github-runner-common.sh
COPY docker/runner-entrypoint.sh /usr/local/bin/runner-entrypoint.sh

RUN chmod 0755 /usr/local/lib/github-runner-common.sh /usr/local/bin/runner-entrypoint.sh

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "Runner.Listener" > /dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/usr/local/bin/runner-entrypoint.sh"]
