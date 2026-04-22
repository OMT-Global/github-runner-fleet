# AWS Account Bootstrap

Use this checklist when a new AWS account needs to join the runner-fleet workflow.

The goal is to get the account to a safe, repeatable baseline before any repository starts deploying into it.

## 1. Establish the AWS-side baseline

Create or confirm these account-level foundations outside this repo first:

- AWS Organizations placement, billing owner, and account alias
- Break-glass admin access with MFA
- IAM Identity Center or the intended federated access path
- CloudTrail, Config, GuardDuty, Security Hub, and budget/alerting according to your platform baseline
- Target regions and naming conventions for shared resources

This repo does not create that baseline for you. It assumes the account already exists and is ready for workload-specific access.

## 2. Decide the deployment trust model

Pick one trust path per account and keep it explicit:

- **GitHub OIDC preferred** for production-style deployments
- **Static cloud credentials only as a temporary bridge** while an account is being brought up

Document which GitHub repositories may deploy to the account, which environments gate that access, and which IAM roles they are allowed to assume.

## 3. Wire the GitHub-side environment gates

For each repo that will target the new account:

1. Create or update the matching GitHub environment (`dev`, `stage`, `prod`, or account-specific equivalents).
2. Require the correct reviewers before deployments are allowed.
3. Add the minimum needed secrets or variables for that account.
4. Keep account IDs, role ARNs, and region defaults aligned with the environment name used by workflows.

This repo's bootstrap policy expects environment review gates to be part of the rollout, not an afterthought.

## 4. Keep runner selection boring

Use the runner plane that matches the workload instead of stretching a shell-only runner into cloud automation it should not own:

- **Synology shell-only** for bash, docs, Terraform validate/plan, and light CLI jobs
- **Linux Docker** for container builds, service containers, and heavier integration work
- **Lume macOS** only when the deployment or validation is truly macOS-specific
- **GitHub-hosted** when the workflow does not need private network reachability or private runners

Do not grant a new AWS account broader runner reachability than the workload actually needs.

## 5. Validate before the first deploy

Before the first real deployment from GitHub:

1. Confirm the repo is configured with the intended environment protections.
2. Confirm the runner group and `runs-on` labels match the plane you expect.
3. Confirm the workflow can assume the intended AWS role or read the required credentials.
4. Run the cheapest non-destructive validation first (for example `terraform validate`, `terraform plan`, or a read-only identity check).
5. Only then allow the account into normal deployment flow.

## 6. Record the account contract

Capture the durable contract somewhere reviewable:

- AWS account purpose and owner
- GitHub repos allowed to target it
- environment names and reviewer expectations
- IAM role names or trust mapping
- runner plane expectations
- rollback or disable path if the account should be cut off quickly

## Suggested first-pass checklist

- [ ] AWS account exists in the correct organization/OU
- [ ] MFA + break-glass admin path confirmed
- [ ] Security baseline enabled for the account
- [ ] Deployment trust model chosen (OIDC preferred)
- [ ] GitHub environments created with reviewers
- [ ] Required secrets/variables installed
- [ ] Runner plane selected and documented
- [ ] First non-destructive validation completed

Once this checklist is done, the account is ready for repo-specific deployment docs and workflow rollout.
