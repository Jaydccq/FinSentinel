import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch, ApiError } from '../client'

describe('apiFetch', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('throws a short ApiError when backend returns HTML (unreachable rewrite target)', async () => {
    // Simulates what happens when NestJS at localhost:3001 is down and
    // Next.js rewrite proxy returns its own 404 HTML page.
    const htmlBody = '<!DOCTYPE html><html><head><title>404</title></head><body>...</body></html>'
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(htmlBody, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )

    const err = await apiFetch('/portfolios').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).message).not.toContain('<!DOCTYPE')
    expect((err as ApiError).message).toMatch(/backend unreachable|http 404/i)
  })

  it('preserves JSON error.message from backend responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Portfolio not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(apiFetch('/portfolios/missing')).rejects.toThrow(
      'Portfolio not found',
    )
  })

  it('returns parsed JSON on 2xx', async () => {
    const payload = { portfolios: [{ id: '1' }] }
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(apiFetch('/portfolios')).resolves.toEqual(payload)
  })

  it('returns undefined on 204 No Content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    )

    await expect(apiFetch('/portfolios/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})
