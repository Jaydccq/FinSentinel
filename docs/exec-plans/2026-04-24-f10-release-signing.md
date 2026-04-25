# F-10: Signed desktop release artifacts

Date: 2026-04-24
Status: **Blocked on external accounts** — workflow skeleton parked at
`if: false`.
Source: [docs/exec-plans/2026-04-24-deferred-followups.md §F-10](./2026-04-24-deferred-followups.md)

## Blocking dependencies

F-10 cannot land production-ready without these _external_ inputs.
Everything on the engineering side is already written — the skeleton
workflow at `.github/workflows/desktop-release.yml` has all jobs
parked at `if: false` so it's one-line-ready to enable.

### Hard blockers (can't ship signed artifacts without these)

1. **Apple Developer Program membership** — $99/year, legally tied
   to an individual or entity. Needed for:
   - Developer ID Application certificate (macOS DMG signing)
   - Apple ID with 2FA enabled (notarytool authentication)
   - Team ID (encoded into the certificate + used by notarytool)

   Without this, macOS users see "unidentified developer" + Gatekeeper
   blocks automatic install. The only workaround (right-click →
   Open) is not acceptable for a shipped product.

2. **Windows code-signing certificate** (optional but strongly recommended)
   - EV cert: HSM-bound, ~$300-600/year, ~1 week issuance. Removes
     SmartScreen warning immediately.
   - OV cert: software-bound, cheaper/faster, but SmartScreen still
     shows a warning until Microsoft builds "reputation" (weeks of
     installs).
   - None: MSI works but SmartScreen displays a red warning on first
     install.

### Soft blockers (can ship unsigned but create friction)

3. **Release cadence + versioning policy** — what does `v0.*` mean?
   Internal preview? Public beta? Signed release? This shapes:
   - Whether the workflow auto-publishes to GH Releases (public) or
     uploads to an internal artifact store.
   - Auto-update channel design (Tauri's updater needs a signing key
     rotation story).

4. **Release notes process** — who writes them, where they live,
   whether the workflow assembles them from commits or expects a
   pre-written file.

## Pre-flight checklist (when unblockers arrive)

Copy into the release-kickoff ticket; every box must be checked
before removing the `if: false` guards.

- [ ] Apple Developer account active; team ID captured.
- [ ] Developer ID Application certificate issued, exported as `.p12`,
      base64-encoded for GH secrets.
- [ ] Apple ID app-specific password generated for notarytool.
- [ ] GitHub Actions repository secrets populated:
  - [ ] `APPLE_CERTIFICATE` (base64 `.p12`)
  - [ ] `APPLE_CERTIFICATE_PASSWORD`
  - [ ] `APPLE_SIGNING_IDENTITY` (e.g. `"Developer ID Application: Your Name (TEAM_ID)"`)
  - [ ] `APPLE_ID` (email)
  - [ ] `APPLE_PASSWORD` (app-specific password)
  - [ ] `APPLE_TEAM_ID`
- [ ] Windows decision made: EV cert purchased / OV cert purchased /
      unsigned accepted.
- [ ] Production API base URL confirmed and updated in
      `.github/workflows/desktop-release.yml` (currently placeholder
      `https://api.finsentinel.example`).
- [ ] Release-notes template + source-of-truth agreed.
- [ ] First release tag format agreed: `v0.1.0-internal-preview` vs
      `v0.1.0` etc.
- [ ] Rollback plan: if the first signed build breaks installers,
      who reverts, and how long do we keep the unsigned fallback
      available?

## What landed this session

1. **`.github/workflows/desktop-release.yml` skeleton** — complete
   workflow definition (macOS / Windows / Linux jobs, Tauri build,
   signing steps, GH Release upload), parked at `if: false` on every
   job. The file documents exactly which secrets to add and how.
2. **Unblocker checklist** embedded in the workflow comment so
   whoever does F-10 later has a step-by-step list.

## What's left to do (after accounts are sorted)

1. Add GitHub Actions secrets:
   - `APPLE_CERTIFICATE` (base64-encoded `.p12`)
   - `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_SIGNING_IDENTITY` (e.g. `"Developer ID Application: Your Name (TEAM_ID)"`)
   - `APPLE_ID`
   - `APPLE_PASSWORD` (app-specific password for notarytool)
   - `APPLE_TEAM_ID`
2. Remove the `if: false` guards in `desktop-release.yml`.
3. Push a `v0.*` tag: `git tag v0.1.0 && git push origin v0.1.0`.
4. On first run, confirm the DMG survives notarytool staple + Gatekeeper.
5. (Separately, once stable) wire a Tauri updater endpoint — that's
   its own follow-up with an auth story.

## Related configuration

- `apps/desktop/src-tauri/tauri.conf.json` already has
  `bundle.active=true` and `bundle.targets: "all"`. No changes needed
  when the workflow unlocks.
- The web build during release uses `NEXT_PUBLIC_API_BASE_URL=
https://api.finsentinel.example` (placeholder). Swap for the real
  prod origin before first signed release.

## Progress log

- 2026-04-24: Skeleton + unblocker checklist + exec plan added. No
  secrets yet; no actual artifact produced.
- 2026-04-24: Expanded blocker docs with pre-flight checklist (hard
  blockers vs soft blockers explicitly separated). Repeat the
  analysis: **the remaining work is 100% external procurement +
  policy, not engineering.** No code change from this repo can
  unblock it; enabling `if: false` → `if: true` in the release
  workflow is the whole final code diff once the checklist is
  green. Any attempt to hand-roll signing keys locally would create
  a secret-sprawl hazard rather than fix the block.
