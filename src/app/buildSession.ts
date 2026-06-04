// [228 §4.4] 세션 조립 — 현 main.tsx(구) 조립을 그대로 옮기고 config로 파라미터화(H1: strip/hardTimeout/4 opts 전부 보존).
// 두 진입: buildSession(로비 선택 = ollama) / buildDemoSession(고정 demo = mock 폴백, §4.8 H2).
import { Coordinator } from '../core/coordinator'
import { createMockDriver } from '../drivers/MockDriver'
import { createOllamaDriver } from '../drivers/OllamaDriver'
import { stripLeadingSelfLabel } from '../drivers/stripLeadingSelfLabel'
import { withHardTimeout } from '../drivers/withHardTimeout'
import type { AgentDriver } from '../drivers/AgentDriver'
import { newSessionId } from '../core/id'
import type { Participant, RoomSession } from '../core/types'
import { createRoomStore, type RoomStore } from './store'
import { config, demoMockConfig, demoParticipants, normalizeBaseUrl, ollamaSystem, type RoomConfig } from './config'
import { setLocale, t } from '../i18n'

export interface Session {
  room: RoomSession
  store: RoomStore
  coord: Coordinator
}

// 공통 조립: participants + baseDriver → room/store/coord. 하드타임아웃·4 opts는 여기 단일화([222] §6 · [C3]).
function assemble(participants: Participant[], baseDriver: AgentDriver, idleMs: number): Session {
  const room: RoomSession = {
    id: newSessionId(),
    createdAt: Date.now(),
    status: 'idle',
    turnNo: 0,
    floorHolder: null,
    participants,
    history: [],
  }
  const store = createRoomStore(room)
  const driver = withHardTimeout(baseDriver, idleMs) // 하드타임아웃 안전망([222] §6)
  const coord = new Coordinator(room, driver, store, {
    whisperTimeoutMs: config.whisperTimeoutMs,
    contextLimit: config.contextWindow, // [M4] 맥락 윈도우(누적 폭증 방지)
    autoDelayMs: config.auto.delayMs, // [C3] 자동 대화
    autoMaxTurns: config.auto.maxTurns,
  })
  return { room, store, coord }
}

// [228 §4.4] 로비 선택(RoomConfig) → ollama 세션. 사람 1(humanName, L2) + AI N(슬롯), AI별 모델·think 주입.
export function buildSession(roomConfig: RoomConfig): Session {
  setLocale(config.locale)
  const map = new Map(roomConfig.ais.map((a) => [a.id, a]))
  const participants: Participant[] = [
    { id: 'me', name: roomConfig.humanName?.trim() || t('participant.me'), kind: 'human', seat: 0 }, // [L2]
    ...roomConfig.ais.map((a, i): Participant => ({ id: a.id, name: a.name, kind: 'ai', seat: i + 1 })),
  ]
  const baseDriver = stripLeadingSelfLabel( // 이름 메아리 제거
    createOllamaDriver({
      model: (p) => map.get(p.id)?.model ?? config.ollama.model, // AI별 모델(없으면 폴백)
      think: (p) => map.get(p.id)?.think, // [M3] tri-state(undefined=미전송)
      baseUrl: normalizeBaseUrl(roomConfig.baseUrl) || config.ollama.baseUrl, // [연결] 로비 지정 주소(정규화) 우선, 비우면 proxy
      system: ollamaSystem,
    }),
  )
  return assemble(participants, baseDriver, config.ollama.idleTimeoutMs)
}

// [228 §4.8 / H2] Mock 데모 — RoomConfig 우회, 고정 demo id(대사 키 일치). Ollama 미실행 시 폴백.
export function buildDemoSession(): Session {
  setLocale(config.locale)
  return assemble(demoParticipants(), createMockDriver(demoMockConfig(config.typingMs)), config.hardTimeoutMs)
}
