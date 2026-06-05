// 단계 플래그·설정([226] §7) + P0 데모 데이터. config 값은 no guess → 여기 모음([221] §6).
// [중요] 데모 데이터(참가자 이름·대사)는 시연용 한글 리터럴 — UI 한글 리터럴 게이트의 예외(여기는 app, ui 아님).
import type { Participant } from '../core/types'
import type { MockDriverConfig } from '../drivers/MockDriver'
import type { Locale } from '../i18n'
import { t } from '../i18n'

// [228 §4.3] 로비에서 런타임 선택하는 방 구성 — AppConfig(정적 플래그)와 별개. 사용자가 입장 시 만들고 localStorage에 영속.
export interface AiSlot {
  id: string // 안정 슬롯 id(seat·모델·이름 교체에도 유지). buildSession이 participants/driver map 키로 사용
  name: string // 표시 이름(defaultNameForModel 기본 + 사용자 편집 보존)
  model: string // Ollama 모델 태그(/api/tags의 name)
  think?: boolean // [228 M3] 사고모드 tri-state: undefined=미전송(비-thinking 보호) / true·false=명시 전송
}
export interface RoomConfig {
  v: 1 // [228 H3] 스키마 버전 — 영속 호환성(불일치 시 기본값 폴백). baseUrl은 optional이라 v 유지(기존 저장값 호환)
  ais: AiSlot[]
  humanName?: string // 사람 표시 이름(미지정 시 i18n 'participant.me')
  baseUrl?: string // [연결] Ollama 주소 override(비우면 config.ollama.baseUrl=/ollama proxy). list 안 보일 때 수동 지정·영속
}

export interface AppConfig {
  locale: Locale
  typingMs: number // 토큰 간격(드라이버 perTokenMs로 주입, [222] §4.1). 0 = 즉시(접근성)
  hardTimeoutMs: number // 공개 발언 무응답 안전망([222] §6) — mock 기준
  whisperTimeoutMs: number // 귓속말 무응답 안전망
  contextWindow: { maxMessages: number; maxChars: number } // [M4] 모델에 보낼 최근 맥락 상한(누적 폭증/느려짐 방지)
  auto: { delayMs: number; maxTurns: number } // [C3] 자동 대화: 턴 간 지연·최대 연속 턴(폭주 방지)
  driver: 'mock' | 'ollama' // 백엔드 선택([224] §3). 기본 mock(Ollama 없이도 앱 동작)
  ollama: {
    model: string // byParticipant에 없는 참가자의 폴백(단일 모델 모드 = 전원 이 값)
    baseUrl: string
    idleTimeoutMs: number
    byParticipant: Record<string, { model: string; think?: boolean }> // AI별 다른 모델(있으면 우선). 비우면 단일 모델
  }
}

export const config: AppConfig = {
  locale: 'ko',
  typingMs: 28, // [225] §1.2
  hardTimeoutMs: 5000, // P0 mock 기준
  whisperTimeoutMs: 30_000,
  // [M4] 최근 8개 발언 + 총 1500자까지만 모델에 전달(그 이상은 오래된 것부터 버림). 약한 HW + 3모델 동시에 맞춰 작게.
  contextWindow: { maxMessages: 8, maxChars: 1500 },
  auto: { delayMs: 3500, maxTurns: 9 }, // [C3] 나 없이 AI끼리: 3.5초 간격, 기본 9턴(Room 입력칸에서 1~99 조절) 후 자동 정지
  driver: 'ollama', // 'mock' = Ollama 없이 데모 / 'ollama' = 로컬 실 AI(Ollama 실행 + 모델 pull 필요)
  ollama: {
    model: 'exaone3.5:7.8b', // byParticipant 미지정 참가자의 폴백
    baseUrl: '/ollama',
    idleTimeoutMs: 60_000, // 첫 토큰/모델로드 지연 대비 idle 길게
    // AI별 다른 모델(테마) — 다른 계열로 진짜 다양성. 비우면(=`{}`) 전원 위 model 단일 사용.
    byParticipant: {
      exaone: { model: 'exaone3.5:7.8b' }, // LG
      phi4mini: { model: 'phi4-mini:latest' }, // Microsoft ~3.8B(경량 → 드랍↓)
      qwen3: { model: 'qwen3.5:4b', think: false }, // Alibaba Qwen3.5 4B(최신 경량) · 사고모드 끔(라이브 속도)
    },
  },
}

// 데모 참가자(seat순). 사람 이름은 i18n(나/Me), AI 이름은 시연용 고유명사.
export function demoParticipants(): Participant[] {
  return [
    { id: 'me', name: t('participant.me'), kind: 'human', seat: 0 },
    // 봇 이름 = 각자 백엔드 모델명(persona 미지정 — 모델 기본 voice). byParticipant 키와 동일.
    { id: 'exaone', name: 'EXAONE', kind: 'ai', seat: 1 },
    { id: 'phi4mini', name: 'Phi4-mini', kind: 'ai', seat: 2 },
    { id: 'qwen3', name: 'Qwen3', kind: 'ai', seat: 3 },
  ]
}

// Ollama system 프롬프트(persona + 최소 채팅 프레이밍). 한글 프레이밍은 app 계층이라 허용([221] §6은 UI 대상).
export function ollamaSystem(p: Participant): string {
  const persona = p.persona ? `${p.persona}. ` : '' // persona 미지정 시 모델 기본 voice(최소 프레이밍만)
  const keepChar = p.persona ? '캐릭터를 유지하며 ' : ''
  return `당신은 '${p.name}'입니다. ${persona}${keepChar}한국어로 1~2문장 짧게 발언하세요. 다른 참가자 발언은 [이름] 형식으로 주어집니다. 당신 차례엔 이름 접두 없이 본문만 답하세요.`
}

// 데모 MockDriver 대사 — 턴마다 순환([225] §3 저녁메뉴 시연 차용). 사람이 새 턴을 열 때마다 다음 대사로.
export function demoMockConfig(typingMs: number): MockDriverConfig {
  return {
    defaultPerTokenMs: typingMs,
    lines: {
      exaone: [
        { text: '비 오니까 파전에 막걸리 어때요?' },
        { text: '그럼 파전으로 결정! 비 오는 날엔 역시 부침개죠.' },
        { text: '좋습니다. 다음 주제도 환영이에요.' },
      ],
      phi4mini: [
        { text: '저는 따뜻한 국밥 한 그릇 추천합니다.' },
        { text: '국밥도 좋지만 파전도 끌리네요. 둘 다 어떨까요.' },
        { text: '오늘 대화 즐거웠습니다.' },
      ],
      qwen3: [
        { text: '마라탕으로 칼칼하게 가시죠. 두부도 넣고 버섯도 듬뿍.' },
        { text: '매운 게 부담이면 알겠습니다. 파전 콜.' },
        { text: '다음엔 마라탕 도전해봐요.' },
      ],
    },
  }
}

// [228 §4.6] 모델 태그 → 기본 봇 이름(단일 규칙: org 제거 → 태그(`:` 앞) → 첫 글자 Title-case).
// 예: exaone3.5:7.8b→Exaone3.5 · qwen3.5:4b→Qwen3.5 · phi4-mini:latest→Phi4-mini · ingu627/exaone4.0:latest→Exaone4.0.
// 사용자가 칸을 비웠거나 자동값과 같을 때만 Lobby가 이 값으로 동기화(사용자 입력은 보존).
export function defaultNameForModel(model: string): string {
  const repo = model.split('/').pop() ?? model // org/repo → repo
  const tag = repo.split(':')[0] || repo // 이름:버전 → 이름
  return tag.charAt(0).toUpperCase() + tag.slice(1)
}

// [228 §4.9] 사고모드(thinking/reasoning) 모델 추정 — 패턴 매칭. 추정값은 Lobby tri-state 토글 기본값일 뿐(사용자가 보정).
export function guessThinking(model: string): boolean {
  return /qwen3|exaone.*4|deepseek-r1|think|reason/i.test(model)
}

// [연결] 사용자 입력 Ollama 주소 정규화 — scheme 없으면 http:// 보충, trailing / 제거. 빈/공백 → '' (= proxy 폴백).
// 'host:11434' 같은 입력이 fetch에서 상대경로로 오인되는 것을 방지(진단 주소도 실제 호출과 일치).
export function normalizeBaseUrl(url: string | undefined): string {
  const u = (url ?? '').trim()
  if (!u) return ''
  const withScheme = /^https?:\/\//i.test(u) ? u : `http://${u}`
  return withScheme.replace(/\/+$/, '') // trailing slash 제거(// 이중 경로 방지)
}
