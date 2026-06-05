// 경량 i18n([224] §2, [226] S6) — ko/en 동시. 외부 라이브러리 없이 사전 맵 + {param} 치환.
// [중요] 모든 UI·시스템 문구는 이 사전 키로(한글 하드코딩 금지, [221] §6). 시연 데이터(참가자 대사 등)는 예외(config).
export type Locale = 'ko' | 'en'
type Dict = Record<string, string>

const ko: Dict = {
  'app.title': '■ AI들과 수다방 ■',
  'sys.enter': '── AI들과 수다방에 입장했습니다 ──',
  'sys.join': '* {names} 님이 입장하셨습니다',
  'sys.roundEnd': '── 라운드 {n} 종료 ──',
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
  'auto.turns': '대화 턴',
  'auto.turnsHint': '자동 대화 최대 턴 (1~99)',
  'participant.me': '나',
  // [228] 로비(진입 모델 선택)
  'lobby.title': '■ AI들과 수다방 — 입장 ■',
  'lobby.subtitle': '로컬 AI를 골라 대화를 시작하세요',
  'lobby.loading': '모델 목록 불러오는 중…',
  'lobby.error': 'Ollama에 연결할 수 없습니다. 실행 중인지 확인하세요.',
  'lobby.retry': '다시 시도',
  'lobby.demo': 'Mock 데모로 시작',
  'lobby.empty': 'Ollama는 연결됐으나 설치된 모델이 0개입니다',
  'lobby.emptyHint': '터미널에서 모델을 받은 뒤(ollama pull) 다시 시도하세요',
  'lobby.missing': '저장된 모델이 목록에 없습니다: {models}',
  'lobby.human': '내 이름',
  'lobby.model': '모델',
  'lobby.name': '이름',
  'lobby.think': '사고',
  'lobby.thinkHint': '사고모드(thinking) 모델 — 켜면 추론 과정을 거칩니다(느려질 수 있음)',
  'lobby.remove': '삭제',
  'lobby.addAi': '+ AI 추가',
  'lobby.enter': '입장',
  'lobby.gate': 'AI를 1명 이상 추가하세요',
  'lobby.ollamaUrl': 'Ollama 주소',
  'lobby.ollamaProxy': '자동 (localhost:11434)',
  'lobby.ollamaUrlHint': '비우면 자동. 다른 PC·포트면 http://주소:11434 (그 Ollama에 OLLAMA_ORIGINS 허용 필요)',
  'lobby.reconnect': '재연결',
  'lobby.connTried': '연결 시도한 주소: {url}',
  'lobby.timeout': '응답 시간 초과(8초). 주소를 확인하거나 재연결하세요',
  'room.settings': '⚙ 설정',
}

const en: Dict = {
  'app.title': '■ Chat with AIs ■',
  'sys.enter': '── You have entered Chat with AIs ──',
  'sys.join': '* {names} joined',
  'sys.roundEnd': '── Round {n} ended ──',
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
  'auto.turns': 'Chat turns',
  'auto.turnsHint': 'Max auto-chat turns (1-99)',
  'participant.me': 'Me',
  // [228] lobby (entry model selection)
  'lobby.title': '■ Chat with AIs — Enter ■',
  'lobby.subtitle': 'Pick local AIs and start chatting',
  'lobby.loading': 'Loading model list…',
  'lobby.error': 'Cannot reach Ollama. Make sure it is running.',
  'lobby.retry': 'Retry',
  'lobby.demo': 'Start Mock demo',
  'lobby.empty': 'Ollama connected, but no models installed',
  'lobby.emptyHint': 'Pull a model (ollama pull) then retry',
  'lobby.missing': 'Saved models not in list: {models}',
  'lobby.human': 'My name',
  'lobby.model': 'Model',
  'lobby.name': 'Name',
  'lobby.think': 'Think',
  'lobby.thinkHint': 'Thinking model — enabling adds a reasoning pass (may be slower)',
  'lobby.remove': 'Remove',
  'lobby.addAi': '+ Add AI',
  'lobby.enter': 'Enter',
  'lobby.gate': 'Add at least one AI',
  'lobby.ollamaUrl': 'Ollama URL',
  'lobby.ollamaProxy': 'auto (localhost:11434)',
  'lobby.ollamaUrlHint': 'Empty = auto. For another PC/port use http://host:11434 (that Ollama needs OLLAMA_ORIGINS)',
  'lobby.reconnect': 'Reconnect',
  'lobby.connTried': 'Tried address: {url}',
  'lobby.timeout': 'Timed out (8s). Check the address or reconnect',
  'room.settings': '⚙ Settings',
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
