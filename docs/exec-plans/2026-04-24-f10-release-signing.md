# F-10: Signed desktop release artifacts

Date: 2026-04-24
Status: **Blocked on external accounts** — workflow skeleton parked at
`if: false`.
Source: [docs/exec-plans/2026-04-24-deferred-followups.md §F-10](./2026-04-24-deferred-followups.md)

## Blocking dependencies

F-10 cannot land production-ready without:

1. **Apple Developer Program** ($99/year) — needed for the Developer ID
   Application certificate that signs macOS DMGs + the Apple ID that
   drives `notarytool`. Without it, macOS users see "unidentified
   developer" and can only install by right-clicking the `.app`.
2. **(Optional) EV code-signing certificate for Windows** — HSM-bound,
   several hundred USD/year. Without it, Windows SmartScreen shows a
   red warning on first install.
3. **Release cadence + versioning policy** — we need agreement on what
   a `v0.*` tag means (internal preview? public beta?) before wiring
   an auto-update channel.

All three are product/legal decisions, not engineering blockers.

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
