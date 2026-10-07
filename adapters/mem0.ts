/**
 * Mem0 over HTTP — a `MemoryBackend` for src/backend.ts.
 *
 * `fetch` only, no Mem0 SDK: the shapes are the two endpoints recorded on
 * mem0ai 2.2.1 (docs/MEM0.md), `POST /search` and `POST /memories`. Mem0 stays
 * authoritative for its records; this file never updates or deletes.
 */
import type { BackendCandidate, MemoryBackend } from '../src/backend.ts'
import type { MemoryAtom } from '../src/types.ts'

export interface Mem0Options {
  /** e.g. http://127.0.0.1:8888 for the official server. */
  baseUrl: string
  /** Mem0 scopes every call; at least one of these is required. */
  userId?: string
  agentId?: string
  runId?: string
  /** Sent as `X-API-Key`. The official server requires it unless AUTH_DISABLED. */
  apiKey?: string
  topK?: number
  /**
   * Mem0's own semantic-score floor (its default is 0.1). Separate from AMK's
   * threshold: Mem0 drops below this one, AMK records a gap below its own.
   */
  mem0Threshold?: number
  /**
   * Mem0 default is true: an LLM rewrites the text into its own memories. Off
   * here, so what Mem0 stores is the text that passed validation.
   */
  infer?: boolean
  /** Injectable for tests. */
  fetch?: typeof fetch
}

interface Mem0Result { id: string, memory: string, score?: number, metadata?: Record<string, unknown> | null }

export function createMem0Backend(options: Mem0Options): MemoryBackend {
  const scope = Object.fromEntries(
    [['user_id', options.userId], ['agent_id', options.agentId], ['run_id', options.runId]].filter(([, value]) => value),
  )
  if (Object.keys(scope).length === 0) throw new Error('mem0: set userId, agentId or runId; mem0 rejects unscoped calls')
  const base = options.baseUrl.replace(/\/+$/, '')
  const doFetch = options.fetch ?? fetch

  async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (options.apiKey) headers['X-API-Key'] = options.apiKey
    const response = await doFetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await response.text()
    // A failed call must not reach searchBackend as an empty result: that would
    // be recorded as a gap in the memory when the gap is in the network.
    if (!response.ok) {
      let detail = text
      try {
        detail = JSON.parse(text).detail ?? text
      } catch { /* not JSON; keep the raw text */ }
      throw new Error(`mem0 ${path} ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    }
    return JSON.parse(text)
  }

  return {
    async search(query: string): Promise<BackendCandidate[]> {
      const payload = await post('/search', {
        query,
        filters: scope,
        ...(options.topK !== undefined ? { top_k: options.topK } : {}),
        ...(options.mem0Threshold !== undefined ? { threshold: options.mem0Threshold } : {}),
      }) as { results?: Mem0Result[] }
      return (payload.results ?? []).map((result) => ({
        // The AMK id survives a Mem0 reset; Mem0's uuid does not, and eval cases
        // must name something stable.
        id: typeof result.metadata?.amk_id === 'string' ? result.metadata.amk_id : result.id,
        text: result.memory,
        score: result.score ?? 0,
      }))
    },
    write: (atom: MemoryAtom) => post('/memories', {
      messages: [{ role: 'user', content: `${atom.title}: ${atom.body}` }],
      ...scope,
      metadata: { amk_id: atom.id, category: atom.category, durability: atom.durability },
      infer: options.infer ?? false,
    }),
  }
}
