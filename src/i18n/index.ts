// 경량 i18n([224] §2, [226] S6) — ko/en 동시. 외부 라이브러리 없이 사전 맵 + {param} 치환.
// [중요] 모든 UI·시스템 문구는 이 사전 키로(한글 하드코딩 금지, [221] §6). 시연 데이터(참가자 대사 등)는 예외(config).
export type Locale = 'ko' | 'en'
type Dict = Record<string, string>

const ko: Dict = {
  'app.title': '■ 사랑방 ■',
  'sys.enter': '── 사랑방에 입장했습니다 ──',
  'sys.join': '* {names} 님이 입장하셨습니다',
  'status.queued': '대기',
  'status.speaking': '발언중',
  'status.done': '완료',
  'status.stopped': '중단',
  'status.here': '●',
  'roster.title': '참가자',
  'composer.placeholder': '메시지 입력…',
  'composer.hint': 'Enter 전송',
  'msg.stopped': '중단됨',
  'msg.error': '응답 오류',
  'msg.noResponse': '응답 없음',
  'whisper.title': '귓속말',
  'whisper.to': '나 → {name}',
  'whisper.banner': '이 대화는 저장되지 않습니다',
  'whisper.placeholder': '귓속말 입력… (Esc 닫기)',
  'whisper.close': '닫기',
  'save.button': '대화 저장',
  'save.note': '귓속말 제외',
  'auto.start': '자동 진행',
  'auto.stop': '멈춤',
  'participant.me': '나',
}

const en: Dict = {
  'app.title': '■ Sarangbang ■',
  'sys.enter': '── You have entered the Sarangbang ──',
  'sys.join': '* {names} joined',
  'status.queued': 'queued',
  'status.speaking': 'speaking',
  'status.done': 'done',
  'status.stopped': 'stopped',
  'status.here': '●',
  'roster.title': 'Participants',
  'composer.placeholder': 'Type a message…',
  'composer.hint': 'Enter to send',
  'msg.stopped': 'stopped',
  'msg.error': 'error',
  'msg.noResponse': 'no response',
  'whisper.title': 'Whisper',
  'whisper.to': 'You → {name}',
  'whisper.banner': 'This conversation is not saved',
  'whisper.placeholder': 'Whisper… (Esc to close)',
  'whisper.close': 'close',
  'save.button': 'Save chat',
  'save.note': 'whisper excluded',
  'auto.start': 'Auto',
  'auto.stop': 'Stop',
  'participant.me': 'Me',
}

const dicts: Record<Locale, Dict> = { ko, en }
let current: Locale = 'ko'

export function setLocale(locale: Locale): void {
  current = locale
}
export function getLocale(): Locale {
  return current
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? dicts.ko[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
  return s
}
