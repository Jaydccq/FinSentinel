import { isTauri } from './is-tauri'

/**
 * Desktop runtime smoke helper. Calls the Rust `ping` command and expects
 * `"pong"` back. Returns `null` outside a Tauri context so non-desktop
 * builds can no-op without throwing.
 *
 * Used by the F-9 runtime smoke harness when one is wired up. For now it
 * gives integration tests a one-liner to prove the Rust↔JS boundary is
 * live.
 */
export async function pingDesktop(): Promise<string | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('ping')
}
