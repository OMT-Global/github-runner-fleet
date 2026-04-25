# Tier A Rollout Ledger

Use this ledger as the central coordination artifact for multi-repo rollout work.

| Repo | Cluster | Current class | Target class | Exception needed | Status | Blocker | Required checks target | Runner target | Security workflow | Release workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bootstrap | A | Bootstrap-aligned split CI | Control-plane reference | No | In progress | Define reusable workflow contract | `CI Gate` | `rg-ci` + hosted | Add reusable caller examples | Add reusable release caller example | Source of truth for default contract |
| github-runner-fleet | A | Bootstrap-aligned split CI with release specialization | Control-plane reference | No | In progress | Finalize runner-group policy docs | `CI Gate` | `rg-ci` + hosted release | Consume shared security contract selectively | Keep hosted release-image until `rg-release` is ready | Source of truth for runner classes |
| lattice | B | Split CI plus bespoke Swift CI | Split CI with repo-specific app hooks | Yes | Planned | Overlapping CI surfaces | `CI Gate` | `rg-ci` + private macOS | Planned | Planned | macOS/Xcode exception |
| mypersonalbanker | B | Split CI plus bespoke backend/mobile CI | Split CI with repo-specific app hooks | Yes | Planned | Overlapping CI surfaces | `CI Gate` | `rg-ci` + private macOS | Planned | Planned | mixed backend + Apple app |
| Why-fi | C | Legacy hosted single workflow | Hosted split CI | Yes | In progress | Shared bootstrap security caller not published yet | `CI Gate` | hosted macOS | Pending control-plane publish | N/A | split CI added locally; keep hosted |
| fix-your-life-app | C | Legacy hosted single workflow | Hosted split CI | Yes | Planned | No split gate yet | `CI Gate` | hosted macOS | Planned | N/A | hosted is safer default |
| openclaw-ouro | D | Custom trust-aware routing | Custom exception on shared contract | Yes | Planned | Preserve repo-specific routing | `CI Gate` | custom private routing | Planned | Planned | reference exception repo |
| axiom | D | Custom hybrid public/private CI | Hybrid exception on shared contract | Yes | Planned | Preserve matrix + stage1 flow | `CI Gate` or repo-specific gate | `rg-ci` + hosted matrix | Planned | N/A | language-specific exception |
| homenet | D | Hosted special-case CI/release/docs | Hosted split CI with special automation lanes | Yes | Planned | CI and release/report mixed together | `CI Gate` | hosted | Planned | Planned | hosted special-case repo |
| fireworks-game | E | No CI confirmed | Minimum viable hosted baseline | Yes | In progress | Shared bootstrap security caller not published yet | `CI Gate` | hosted macOS | Pending control-plane publish | N/A | local inventory confirmed; baseline CI added |
| home-tv-channel-list | E | Unconfirmed | Minimum viable repo-specific baseline | Unknown | Needs inventory | Confirm workflow set | TBD | TBD | TBD | TBD | no confirmed CI in audit pass |
| omt-corner-cave | E | Unconfirmed | Minimum viable infra baseline | Unknown | Needs inventory | Confirm workflow set | TBD | TBD | TBD | TBD | infra repo |
| mac-cksum | E | Unconfirmed | Minimum viable repo-specific baseline | Unknown | Needs inventory | Confirm workflow set | TBD | TBD | TBD | TBD | utility repo |
| gh-attest | E | Unconfirmed | Hosted release/security baseline | Unknown | Needs inventory | Confirm workflow set | TBD | TBD | TBD | TBD | security-sensitive reusable repo |
| acme-aws | E | Unconfirmed | Hosted infra baseline | Unknown | Needs inventory | Confirm workflow set | TBD | TBD | TBD | TBD | Terraform/security-sensitive repo |
