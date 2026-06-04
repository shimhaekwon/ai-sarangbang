// [228 §4.1] 앱 루트 — phase(lobby↔room) + 세션 보관 + 전환마다 dispose(C2/M4).
// [중요] 세션은 사용자 클릭(입장/Mock)으로만 생성 → mount 시 0 인스턴스 = StrictMode 이중 mount에 안전.
// 전환·재진입 시 이전 세션 coord.dispose()로 orphaned stream/타이머 정리(R6). useRef로 직전 세션 추적.
import { useRef, useState } from 'react'
import { Lobby } from '../ui/Lobby'
import { Room } from '../ui/Room'
import { buildDemoSession, buildSession, type Session } from './buildSession'
import type { RoomConfig } from './config'

type Phase = { name: 'lobby' } | { name: 'room'; session: Session }

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'lobby' })
  const sessionRef = useRef<Session | null>(null) // [C2] 직전 세션 — 전환 시 dispose 대상

  const enter = (build: () => Session) => {
    sessionRef.current?.coord.dispose() // 이전 세션(있다면) 정리 후 교체
    const session = build()
    sessionRef.current = session
    setPhase({ name: 'room', session })
  }

  const leave = () => {
    sessionRef.current?.coord.dispose() // [§8] 방 [설정] → dispose 후 로비
    sessionRef.current = null
    setPhase({ name: 'lobby' })
  }

  if (phase.name === 'lobby') {
    return <Lobby onEnter={(cfg: RoomConfig) => enter(() => buildSession(cfg))} onDemo={() => enter(buildDemoSession)} />
  }
  return <Room room={phase.session.room} store={phase.session.store} coord={phase.session.coord} onLeave={leave} />
}
