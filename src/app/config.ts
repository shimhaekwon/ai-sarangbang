// 단계 플래그·설정([226] §7) + P0 데모 데이터. config 값은 no guess → 여기 모음([221] §6).
// [중요] 데모 데이터(참가자 이름·대사)는 시연용 한글 리터럴 — UI 한글 리터럴 게이트의 예외(여기는 app, ui 아님).
import type { Participant } from '../core/types'
import type { MockDriverConfig } from '../drivers/MockDriver'
import type { Locale } from '../i18n'
import { t } from '../i18n'

export interface AppConfig {
  locale: Locale
  typingMs: number // 토큰 간격(드라이버 perTokenMs로 주입, [222] §4.1). 0 = 즉시(접근성)
  hardTimeoutMs: number // 공개 발언 무응답 안전망([222] §6) — mock 기준
  whisperTimeoutMs: number // 귓속말 무응답 안전망
  driver: 'mock' | 'ollama' // 백엔드 선택([224] §3). 기본 mock(Ollama 없이도 앱 동작)
  ollama: { model: string; baseUrl: string; idleTimeoutMs: number }
}

export const config: AppConfig = {
  locale: 'ko',
  typingMs: 28, // [225] §1.2
  hardTimeoutMs: 5000, // P0 mock 기준
  whisperTimeoutMs: 30_000,
  driver: 'mock', // ← 'ollama'로 바꾸면 실 AI(로컬 Ollama 필요: 설치 + `ollama pull <model>` + dev 서버)
  ollama: { model: 'llama3.2', baseUrl: '/ollama', idleTimeoutMs: 60_000 }, // 첫 토큰/모델로드 지연 대비 idle 길게
}

// 데모 참가자(seat순). 사람 이름은 i18n(나/Me), AI 이름은 시연용 고유명사.
export function demoParticipants(): Participant[] {
  return [
    { id: 'me', name: t('participant.me'), kind: 'human', seat: 0 },
    { id: 'claude', name: '클로드', kind: 'ai', seat: 1, persona: '정중하고 다정한 미식가' },
    { id: 'gemini', name: '제미니', kind: 'ai', seat: 2, persona: '실용적이고 균형 잡힌 조언가' },
    { id: 'deepseek', name: '딥식', kind: 'ai', seat: 3, persona: '매운 음식을 좋아하는 직설적인 미식가' },
  ]
}

// Ollama system 프롬프트(persona + 라이브 사랑방 프레이밍). 한글 프레이밍은 app 계층이라 허용([221] §6은 UI 대상).
export function ollamaSystem(p: Participant): string {
  const persona = p.persona ? `${p.persona} ` : ''
  return `당신은 '${p.name}'입니다. ${persona}90년대 PC통신 '사랑방' 라이브 그룹 채팅에 참여 중입니다. 캐릭터를 유지하며 한국어로 1~2문장 짧게 발언하세요. 다른 참가자 발언은 [이름] 형식으로 주어집니다. 당신 차례엔 이름 접두 없이 본문만 답하세요.`
}

// 데모 MockDriver 대사 — 턴마다 순환([225] §3 저녁메뉴 시연 차용). 사람이 새 턴을 열 때마다 다음 대사로.
export function demoMockConfig(typingMs: number): MockDriverConfig {
  return {
    defaultPerTokenMs: typingMs,
    lines: {
      claude: [
        { text: '비 오니까 파전에 막걸리 어때요?' },
        { text: '그럼 파전으로 결정! 비 오는 날엔 역시 부침개죠.' },
        { text: '좋습니다. 다음 주제도 환영이에요.' },
      ],
      gemini: [
        { text: '저는 따뜻한 국밥 한 그릇 추천합니다.' },
        { text: '국밥도 좋지만 파전도 끌리네요. 둘 다 어떨까요.' },
        { text: '오늘 대화 즐거웠습니다.' },
      ],
      deepseek: [
        { text: '마라탕으로 칼칼하게 가시죠. 두부도 넣고 버섯도 듬뿍.' },
        { text: '매운 게 부담이면 알겠습니다. 파전 콜.' },
        { text: '다음엔 마라탕 도전해봐요.' },
      ],
    },
  }
}
