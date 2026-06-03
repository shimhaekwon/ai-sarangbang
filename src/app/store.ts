// UI↔core 동기화 store([226] S2.5) — 경량 외부 store(useSyncExternalStore + 자작 emitter).
// core(coordinator)는 React를 모르고, 이 store가 CoordinatorHooks sink를 구현해 불변 스냅샷으로 UI에 노출.
import { useSyncExternalStore } from 'react'
import type { CoordinatorHooks } from '../core/coordinator'
import type { Message, ParticipantId, RoomSession, RoomStatus, TurnState, Whisper } from '../core/types'

// UI가 구독하는 불변 뷰. coordinator의 room.history(가변·canonical)와 별도 미러 — in-place 토큰 갱신에도 새 ref를 줘 React 리렌더.
export interface RoomView {
  history: Message[]
  status: RoomStatus
  turnNo: number
  floorHolder: ParticipantId | null
  turnState: ReadonlyMap<ParticipantId, TurnState>
  whispers: ReadonlyMap<ParticipantId, Whisper>
  autoActive: boolean // [C3] 자동 대화 모드 on/off
}

export interface RoomStore extends CoordinatorHooks {
  onRoom: () => void // createRoomStore가 항상 제공(CoordinatorHooks의 optional을 필수로 좁힘)
  onAuto: (active: boolean) => void // [C3] 자동 모드 통지
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => RoomView
}

export function createRoomStore(room: RoomSession): RoomStore {
  const listeners = new Set<() => void>()
  let snapshot: RoomView = {
    history: room.history.map((m) => ({ ...m })),
    status: room.status,
    turnNo: room.turnNo,
    floorHolder: room.floorHolder,
    turnState: new Map(),
    whispers: new Map(),
    autoActive: false,
  }
  const emit = () => {
    for (const l of listeners) l()
  }

  // append(새 id) 또는 in-place 갱신(기존 id). 항상 새 배열 ref → React가 변경 감지.
  const publish = (m: Message) => {
    const idx = snapshot.history.findIndex((x) => x.id === m.id)
    const history = snapshot.history.slice()
    if (idx === -1) history.push({ ...m })
    else history[idx] = { ...m }
    snapshot = { ...snapshot, history }
    emit()
  }
  const onState = (id: ParticipantId, s: TurnState) => {
    const turnState = new Map(snapshot.turnState)
    turnState.set(id, s)
    snapshot = { ...snapshot, turnState }
    emit()
  }
  // [C1] 휘발 — 스냅샷 복사본으로만 노출(공개 history/MD/스냅샷 미오염은 core가 보장).
  const onWhisper = (target: ParticipantId, thread: Whisper) => {
    const whispers = new Map(snapshot.whispers)
    whispers.set(target, { target: thread.target, messages: thread.messages.map((x) => ({ ...x })) })
    snapshot = { ...snapshot, whispers }
    emit()
  }
  // room 메타 재독 — coordinator가 room을 직접 변경하므로 reference로 최신값을 읽는다([226] S2.5).
  const onRoom = () => {
    snapshot = { ...snapshot, status: room.status, turnNo: room.turnNo, floorHolder: room.floorHolder }
    emit()
  }
  const onAuto = (active: boolean) => {
    snapshot = { ...snapshot, autoActive: active }
    emit()
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const getSnapshot = () => snapshot

  return { publish, onState, onWhisper, onRoom, onAuto, subscribe, getSnapshot }
}

// React 훅 — 컴포넌트가 RoomView 전체를 구독(스냅샷 ref는 emit 시에만 교체 → 안전, 무한루프 없음).
export function useRoomView(store: RoomStore): RoomView {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
