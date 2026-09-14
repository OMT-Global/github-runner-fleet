import { describe, expect, test } from 'vitest';
// Standalone release helper runs directly under Node, outside the CLI bundle.
// @ts-expect-error JavaScript operator script intentionally has no declaration file.
import { inspectPublication, releasePlan, sourceMatches } from '../scripts/release-guard.mjs';
const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const identity = { image: 'ghcr.io/omt-global/github-runner-fleet:0.2.3', sha, run: '123', attempt: '1' };
const env = { GITHUB_REPOSITORY: 'OMT-Global/github-runner-fleet', GITHUB_ACTOR: 'automation', GITHUB_TOKEN: 'fixture' };
function responses(...values: Array<[number, unknown, Record<string,string>?]>) {
  return async () => {
    const next = values.shift();
    if (!next) throw new Error('unexpected request');
    return new Response(JSON.stringify(next[1]), {status: next[0], headers: next[2]});
  };
}
const access: [number, unknown] = [200, {full_name: env.GITHUB_REPOSITORY}];
const absent: [number, unknown] = [404, {message: 'Not Found'}];
const token: [number, unknown] = [200, {token: 'fixture-registry'}];
describe('release state guard', () => {
  test('each retry creates a different candidate, never the final tag', () => {
    const first = releasePlan({...identity, releaseExists: false});
    const second = releasePlan({...identity, attempt: '2', releaseExists: false});
    expect(first.working_ref).not.toBe(identity.image);
    expect(first.working_ref).not.toBe(second.working_ref);
    expect(first.publish_required).toBe('true');
  });
  test('existing digest is read-only recovery and inconsistent release state is blocked', () => {
    expect(releasePlan({...identity, digest, releaseExists: true})).toMatchObject({publish_required:'false', working_ref:`ghcr.io/omt-global/github-runner-fleet@${digest}`});
    expect(() => releasePlan({...identity, releaseExists:true})).toThrow();
    expect(() => releasePlan({...identity, digest:'mutable', releaseExists:false})).toThrow();
  });
  test('publishing requires positively identified manifest absence', async () => {
    const result = await inspectPublication(identity.image, 'v0.2.3', env, responses(access, absent, token, [404,{errors:[{code:'MANIFEST_UNKNOWN'}]}]));
    expect(result).toEqual({digest:undefined,releaseExists:false});
  });
  test.each([401,403,429,500,503])('registry %i cannot authorize publication', async status => {
    await expect(inspectPublication(identity.image, 'v0.2.3', env, responses(access, absent, token, [status,{errors:[{code:'MANIFEST_UNKNOWN'}]}]))).rejects.toThrow();
  });
  test.each([{}, {errors:[{code:'DENIED'}]}, {errors:[]}, {errors:[{code:'MANIFEST_UNKNOWN'},{code:'DENIED'}]}])('ambiguous registry 404 fails closed: %j', async body => {
    await expect(inspectPublication(identity.image, 'v0.2.3', env, responses(access, absent, token, [404,body]))).rejects.toThrow();
  });
  test('existing manifest binds to response digest', async () => {
    expect(await inspectPublication(identity.image,'v0.2.3',env,responses(access, [200,{tag_name:'v0.2.3'}], token,[200,{}, {'docker-content-digest':digest}]))).toEqual({digest,releaseExists:true});
  });
  test('missing digest, failed access, failed token and inconclusive releases fail closed', async () => {
    for (const replies of [
      [[403,{}]], [access,[500,{}]], [access,absent,[401,{}]],
      [access,absent,token,[200,{}]], [access,[200,{tag_name:'wrong'}]],
    ] as Array<Array<[number,unknown]>>) {
      await expect(inspectPublication(identity.image,'v0.2.3',env,responses(...replies))).rejects.toThrow();
    }
  });
  test('network errors fail closed without an absence result', async () => {
    await expect(inspectPublication(identity.image,'v0.2.3',env,async () => {throw new Error('network');})).rejects.toThrow();
  });
});
function envelope(sourceSha = sha, subjectDigest = digest.slice(7), repository = env.GITHUB_REPOSITORY) {
  return {payload: Buffer.from(JSON.stringify({
    subject:[{digest:{sha256:subjectDigest}}], predicateType:'https://slsa.dev/provenance/v1',
    predicate:{buildDefinition:{buildType:'https://actions.github.io/buildtypes/workflow/v1', resolvedDependencies:[{uri:`git+https://github.com/${repository}@refs/heads/main`,digest:{gitCommit:sourceSha}}]}}
  })).toString('base64')};
}
describe('verified SLSA source binding', () => {
  const expected = {sha,digest,repository:env.GITHUB_REPOSITORY};
  test('accepts only matching source AND digest in a verified envelope', () => {
    expect(sourceMatches([envelope()],expected)).toBe(true);
    expect(sourceMatches([envelope('c'.repeat(40))],expected)).toBe(false);
    expect(sourceMatches([envelope(sha,'d'.repeat(64))],expected)).toBe(false);
    expect(sourceMatches([envelope(sha, digest.slice(7), 'other/repo')],expected)).toBe(false);
    expect(sourceMatches([envelope('c'.repeat(40)),envelope(sha,'d'.repeat(64))],expected)).toBe(false);
    expect(sourceMatches([{payload:'malformed'}],expected)).toBe(false);
  });
});
