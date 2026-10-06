/**
 * Mem0 HTTP adapter: request and response shapes only. The shapes are the ones
 * recorded on mem0ai 2.2.1 (docs/MEM0.md), so the oracle is that record, and
 * fetch is replaced by a stub that captures what would have gone over the wire.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createMem0Backend } from '../adapters/mem0.ts'
import { searchBackend } from '../src/backend.ts'
import type { MemoryAtom } from '../src/types.ts'

interface Sent { url: string, method: string, headers: Record<string, string>, body: Record<string, unknown> }

function stubFetch(status: number, payload: unknown): { fetch: typeof fetch, sent: Sent[] } {
  const sent: Sent[] = []
  const fake = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    })
    return new Response(JSON.stringify(payload), { status })
  }
  return { fetch: fake as typeof fetch, sent }
}

// Trimmed from the recorded run: what POST /search returned for a stored fact.
const SEARCH_RESPONSE = {
  results: [
    { id: 'c04067b8-3b5e-4999-8532-5099d477e9ea', memory: 'Support is open 9-17.', score: 0.688, metadata: { amk_id: 'support.hours' }, user_id: 'amk-demo' },
    { id: '5f1d0000-0000-4000-8000-000000000001', memory: 'Extracted by the LLM, no AMK id.', score: 0.41, metadata: null, user_id: 'amk-demo' },
  ],
}

describe('createMem0Backend', () => {
  it('search posts the query with the scope inside filters, as mem0 2.2.1 requires', async () => {
    const stub = stubFetch(200, SEARCH_RESPONSE)
    const backend = createMem0Backend({ baseUrl: 'http://127.0.0.1:18888/', userId: 'amk-demo', topK: 5, fetch: stub.fetch })
    await backend.search('when is support open')
    assert.equal(stub.sent[0]?.url, 'http://127.0.0.1:18888/search')
    assert.equal(stub.sent[0]?.method, 'POST')
    assert.deepEqual(stub.sent[0]?.body, { query: 'when is support open', filters: { user_id: 'amk-demo' }, top_k: 5 })
  })

  it('maps results to candidates, preferring the AMK id stored in metadata', async () => {
    const stub = stubFetch(200, SEARCH_RESPONSE)
    const candidates = await createMem0Backend({ baseUrl: 'http://x', userId: 'u', fetch: stub.fetch }).search('q')
    assert.deepEqual(candidates, [
      { id: 'support.hours', text: 'Support is open 9-17.', score: 0.688 },
      { id: '5f1d0000-0000-4000-8000-000000000001', text: 'Extracted by the LLM, no AMK id.', score: 0.41 },
    ])
  })

  it('sends the API key as X-API-Key only when one is configured', async () => {
    const withKey = stubFetch(200, { results: [] })
    await createMem0Backend({ baseUrl: 'http://x', agentId: 'bot', apiKey: 'k', fetch: withKey.fetch }).search('q')
    assert.equal(withKey.sent[0]?.headers['X-API-Key'], 'k')
    assert.deepEqual(withKey.sent[0]?.body.filters, { agent_id: 'bot' })
    const without = stubFetch(200, { results: [] })
    await createMem0Backend({ baseUrl: 'http://x', userId: 'u', fetch: without.fetch }).search('q')
    assert.equal('X-API-Key' in (without.sent[0]?.headers ?? {}), false)
  })

  it('write posts one user message with the AMK id in metadata and inference off by default', async () => {
    const stub = stubFetch(200, { results: [{ id: 'm1', memory: 'x', event: 'ADD' }] })
    const atom = { id: 'support.hours', title: 'Support hours', category: 'support', durability: 'stable', body: 'Open 9-17.' } as MemoryAtom
    const result = await createMem0Backend({ baseUrl: 'http://x', userId: 'u', fetch: stub.fetch }).write!(atom)
    assert.equal(stub.sent[0]?.url, 'http://x/memories')
    assert.deepEqual(stub.sent[0]?.body, {
      messages: [{ role: 'user', content: 'Support hours: Open 9-17.' }],
      user_id: 'u',
      metadata: { amk_id: 'support.hours', category: 'support', durability: 'stable' },
      infer: false,
    })
    assert.deepEqual(result, { results: [{ id: 'm1', memory: 'x', event: 'ADD' }] })
  })

  it('refuses to start without a scope id, because mem0 rejects every call without one', () => {
    assert.throws(() => createMem0Backend({ baseUrl: 'http://x' }), /userId, agentId or runId/)
  })

  it('an HTTP error throws with the status and mem0 detail instead of looking like a miss', async () => {
    const stub = stubFetch(400, { detail: 'filters must contain at least one of: user_id' })
    const backend = createMem0Backend({ baseUrl: 'http://x', userId: 'u', fetch: stub.fetch })
    await assert.rejects(searchBackend(backend, 'q', { threshold: 0.5 }), /mem0 \/search 400: filters must contain/)
  })
})
