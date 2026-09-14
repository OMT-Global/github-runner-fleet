import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
export function requireDigest(value) {
  if (!digestPattern.test(value ?? '')) throw new Error('invalid immutable digest');
  return value;
}
export function releasePlan({ image, digest, releaseExists, sha, run, attempt }) {
  if (!/^ghcr\.io\/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(image))
    throw new Error('expected a tagged GHCR image');
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^\d+$/.test(run) || !/^\d+$/.test(attempt))
    throw new Error('missing immutable source/run identity');
  if (digest) requireDigest(digest);
  if (releaseExists && !digest) throw new Error('release exists without its image; refusing publication');
  const tag = image.slice(image.lastIndexOf(':') + 1);
  const repository = image.slice(0, image.lastIndexOf(':'));
  return {
    publish_required: String(!digest),
    working_ref: digest ? `${repository}@${digest}` : `${repository}:candidate-${tag}-${sha}-${run}-${attempt}`,
    final_digest: digest ?? '',
    release_exists: String(releaseExists)
  };
}

async function request(url, headers, fetcher) {
  const response = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
  // Do not echo tokens, request headers or credential-bearing error objects.
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); } catch { json = null; }
  return { status: response.status, headers: response.headers, json };
}
export async function inspectPublication(image, releaseTag, env, fetcher = fetch) {
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('invalid repository');
  if (!env.GITHUB_TOKEN || !env.GITHUB_ACTOR) throw new Error('missing workflow authentication');
  if (!/^ghcr\.io\/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(image)) throw new Error('invalid image');
  const githubHeaders = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };
  const access = await request(`https://api.github.com/repos/${repository}`, githubHeaders, fetcher);
  if (access.status !== 200 || access.json?.full_name?.toLowerCase() !== repository.toLowerCase())
    throw new Error('repository access was not confirmed');
  const release = await request(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`, githubHeaders, fetcher);
  if (release.status !== 200 && !(release.status === 404 && release.json?.message === 'Not Found'))
    throw new Error(`release lookup inconclusive (${release.status})`);
  if (release.status === 200 && release.json?.tag_name !== releaseTag) throw new Error('release identity mismatch');

  const separator = image.lastIndexOf(':');
  const name = image.slice('ghcr.io/'.length, separator);
  const tag = image.slice(separator + 1);
  const tokenUrl = new URL('https://ghcr.io/token');
  tokenUrl.searchParams.set('service', 'ghcr.io');
  tokenUrl.searchParams.set('scope', `repository:${name}:pull`);
  const token = await request(tokenUrl, { Authorization: `Basic ${Buffer.from(`${env.GITHUB_ACTOR}:${env.GITHUB_TOKEN}`).toString('base64')}` }, fetcher);
  if (token.status !== 200 || typeof token.json?.token !== 'string' || !token.json.token)
    throw new Error('registry authentication failed');
  const manifest = await request(`https://ghcr.io/v2/${name}/manifests/${encodeURIComponent(tag)}`, {
    Authorization: `Bearer ${token.json.token}`,
    Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'
  }, fetcher);
  let digest;
  if (manifest.status === 200) digest = requireDigest(manifest.headers.get('docker-content-digest'));
  else if (!(manifest.status === 404 && Array.isArray(manifest.json?.errors) && manifest.json.errors.length > 0 &&
             manifest.json.errors.every(e => e.code === 'MANIFEST_UNKNOWN')))
    throw new Error(`registry lookup inconclusive (${manifest.status})`);
  return { digest, releaseExists: release.status === 200 };
}

// Input is exclusively stdout from a successful cosign verify-attestation, not
// unverified registry payloads. Require subject AND source in the same statement.
export function sourceMatches(verifiedEnvelopes, { digest, sha, repository }) {
  requireDigest(digest);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('invalid source commit');
  const expectedUri = `git+https://github.com/${repository}@refs/heads/main`;
  for (const envelope of verifiedEnvelopes) {
    let statement;
    try { statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString()); } catch { continue; }
    if (!Array.isArray(statement.subject) || !statement.subject.some(s => s.digest?.sha256 === digest.slice(7))) continue;
    if (statement.predicateType === 'https://slsa.dev/provenance/v1') {
      const definition = statement.predicate?.buildDefinition;
      if (definition?.buildType !== 'https://actions.github.io/buildtypes/workflow/v1') continue;
      if (definition.resolvedDependencies?.some(d => d.uri === expectedUri && d.digest?.gitCommit === sha)) return true;
    }
  }
  return false;
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'preflight') {
    const [image, tag] = args;
    const result = await inspectPublication(image, tag, process.env);
    const outputs = releasePlan({ ...result, image, sha: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT });
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k,v]) => `${k}=${v}\n`).join(''));
  } else if (mode === 'source') {
    const [filename, digest] = args;
    const raw = fs.readFileSync(filename, 'utf8').trim();
    let envelopes;
    try { envelopes = JSON.parse(raw); } catch { envelopes = raw.split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    if (!Array.isArray(envelopes)) envelopes = [envelopes];
    if (!sourceMatches(envelopes, { digest, sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY }))
      throw new Error('verified provenance does not bind this image to the reviewed source');
  } else throw new Error('expected preflight or source');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
