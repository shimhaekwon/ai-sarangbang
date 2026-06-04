// 핵심 도메인 타입 — Coordinator가 프레임워크 무관 순수 모듈이라 UI/드라이버와 분리([223] §1, [221] §6).
// [222] §8의 Message/Participant/SpeakContext/AgentDriver가 모두 여기서 파생.
// [중요] 이 파일은 react/react-dom/DOM을 import하지 않는다(core 순수성, [224] §1).

export type ParticipantId = string
export type MessageId = string
export type RoomSessionId = string // "YYYYMMDD-HHmm-xxxxxx" ([223] §1.3)

// 방 상태([222] §3). idle = 입력 대기 / turn_active = 턴 진행 중(큐 처리).
export type RoomStatus = 'idle' | 'turn_active'

// 참가자 — 사람·AI 일반화(v1 Slot 계승·확장, [223] §1).
export interface Participant {
  id: ParticipantId
  name: string
  kind: 'human' | 'ai'
  seat: number // [H4] 좌석 순서(0-based). [227] 발언 순서는 매 턴 랜덤 셔플 — seat은 AI 후보 수집·roster 표시 순서용
  persona?: string // AI 캐릭터 프롬프트(목/Ollama/API 공통). human은 미사용
  color?: string // 90s 감성 발화 색([221] §1). 미지정 시 UI 기본 팔레트
}

// 공개 발언 상태([223] §1). [H1] [222] Participant turn-state의 부분집합 아님:
// error=Message 전용(드라이버 실패), idle/queued=Participant 전용. 대응은 [222] §3 표.
export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error'

// 발언(턴-)상태([222] §3) — Participant 단위. speaking↔streaming, done↔done, stopped↔stopped.
export type TurnState = 'idle' | 'queued' | 'speaking' | 'done' | 'stopped'

// 공개 발언 1건([223] §1).
export interface Message {
  id: MessageId
  turnNo: number // 이 발언이 속한 턴(1-based). 사람 입력이 턴을 연다([221] D1)
  by: ParticipantId // 발화자
  role: 'human' | 'ai' // by.kind 미러. [M-3] beginMessage가 단독 채움(외부 설정 금지) → 동기화 책임 단일화
  text: string // 원문 전체(요약·절삭 없음, [223] §3)
  status: MessageStatus // [C-1] 사람 메시지는 생성 즉시 'done'(스트리밍 없음) → context done 필터에 포함되어 AI가 봄
  ts: number // 발언 시작 시각(epoch ms)
}

// 방 세션 — 라이브 턴제 1회분(v1 RoundSession 계승, [223] §1).
export interface RoomSession {
  id: RoomSessionId
  createdAt: number
  status: RoomStatus // [222] §3
  turnNo: number // 현재/최근 턴(1-based). idle 직전 값 유지
  floorHolder: ParticipantId | null // [L3] 현재 출력 중 참가자(UI 하이라이트, [222] §3). idle이면 null
  participants: Participant[] // 사람 1 + AI N (seat 순)
  history: Message[] // 공개 대화 누적(whisper 미포함, [223] §2)
}

// 귓속말 — 휘발(저장·MD로그·스냅샷 어디에도 미포함, [223] §2 · [221] R4).
// [중요] RoomSession·스냅샷에 필드로 달지 말 것 — 달면 직렬화에 새어 들어간다([223] §2). 별도 보관(coordinator Map)이 불변식의 구조적 보증.
export interface Whisper {
  target: ParticipantId // 1:1 상대(AI)
  messages: { by: 'human' | ParticipantId; text: string }[] // by='human' 또는 target
}

// 발화 컨텍스트 — 드라이버 주입용([223] §4, [222] §8). 공개 발언·귓속말 모두 이 타입으로 정규화.
// [DAG] 타입은 여기(S1)에 두어 AgentDriver(S1)가 S2(context 빌더)에 역의존하지 않게 함([226] §3). 빌더는 core/context.ts.
export interface SpeakContext {
  participant: Participant // 발화자(드라이버가 "당신은 [participant.name]"로 프레이밍)
  publicHistory: Message[] // 공개 대화(자기 포함·done만, [C-2]). 드라이버가 [이름] 라벨로 자타 구분
  roster: { id: ParticipantId; name: string }[] // 화자 id→이름 해석용(드라이버 prompt 라벨링). seam 자기완결 → 멀티유저 이식 대비([224] §6)
}
