// P1 OllamaDriver — 로컬 무료 LLM([221] §2 · [224] §3). MockDriver를 이 드라이버로 "교체만" 하면 실 AI 발화.
// Ollama /api/chat(stream=true) NDJSON을 AsyncIterable<string>으로 어댑트. signal→fetch abort로 생성 취소([222] §8).
// [중요] core/UI 무의존 — AgentDriver 인터페이스 뒤. prompt 합성(라벨링)은 드라이버 책임([222] §8).
import type { AgentDriver } from './AgentDriver'
import type { Participant, SpeakContext } from '../core/types'

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OllamaDriverConfig {
  model: string
  baseUrl?: string // 기본 '/ollama'(dev Vite proxy, [224] §3 CORS 우회). 직접 호출 시 'http://localhost:11434'
  system?: (speaker: Participant) => string // system 프롬프트(persona+프레이밍). 한글 프레이밍은 app/config에서 주입
  fetchImpl?: typeof fetch // 테스트 주입(기본 전역 fetch)
}

const DEFAULT_BASE_URL = '/ollama'
const defaultSystem = (p: Participant): string => p.persona ?? `You are ${p.name}.`

// SpeakContext → Ollama chat messages. 자기 발언=assistant·타자=user, 모두 [이름] 라벨로 화자 구분(roster로 id→이름).
export function buildOllamaMessages(ctx: SpeakContext, system: (p: Participant) => string): OllamaMessage[] {
  const nameOf = (id: string) => ctx.roster.find((r) => r.id === id)?.name ?? id
  const messages: OllamaMessage[] = [{ role: 'system', content: system(ctx.participant) }]
  for (const m of ctx.publicHistory) {
    messages.push({
      role: m.by === ctx.participant.id ? 'assistant' : 'user',
      content: `[${nameOf(m.by)}] ${m.text}`,
    })
  }
  return messages
}

function parseLine(line: string): { content: string; done: boolean } {
  try {
    const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
    return { content: obj.message?.content ?? '', done: obj.done === true }
  } catch {
    return { content: '', done: false } // 비-JSON 라인 무시(견고)
  }
}

export function createOllamaDriver(config: OllamaDriverConfig): AgentDriver {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  const system = config.system ?? defaultSystem
  const doFetch = config.fetchImpl ?? fetch

  return {
    async *speak(ctx, signal) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const body = { model: config.model, messages: buildOllamaMessages(ctx, system), stream: true }
      const res = await doFetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
      if (!res.body) throw new Error('Ollama: empty response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let nl = buf.indexOf('\n')
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (line) {
              const tok = parseLine(line)
              if (tok.content) yield tok.content
              if (tok.done) return
            }
            if (signal.aborted) throw new DOMException('aborted', 'AbortError')
            nl = buf.indexOf('\n')
          }
        }
        const last = buf.trim() // 개행 없이 끝난 마지막 라인
        if (last) {
          const tok = parseLine(last)
          if (tok.content) yield tok.content
        }
      } finally {
        try {
          await reader.cancel() // 조기 종료(바지인 등) 시 HTTP 스트림 정리
        } catch {
          /* 이미 종료/취소됨 */
        }
      }
    },
  }
}
