// 부트스트랩 — core + driver + ui 와이어링([224] §4). 드라이버 주입 단일 지점(P0=Mock, P1=Ollama, P2=Api는 이 줄만 교체).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Coordinator } from '../core/coordinator'
import { createMockDriver } from '../drivers/MockDriver'
import { withHardTimeout } from '../drivers/withHardTimeout'
import { newSessionId } from '../core/id'
import type { RoomSession } from '../core/types'
import { createRoomStore } from './store'
import { config, demoMockConfig, demoParticipants } from './config'
import { setLocale } from '../i18n'
import { Room } from '../ui/Room'
import '../ui/theme.css'

setLocale(config.locale)

const participants = demoParticipants()
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
// [중요] 드라이버 주입 단일 지점 — P0 = MockDriver + 하드타임아웃 안전망([222] §6). 단계 전환은 이 한 줄.
const driver = withHardTimeout(createMockDriver(demoMockConfig(config.typingMs)), config.hardTimeoutMs)
const coord = new Coordinator(room, driver, store, { whisperTimeoutMs: config.whisperTimeoutMs })

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root element not found')
createRoot(rootEl).render(
  <StrictMode>
    <Room room={room} store={store} coord={coord} />
  </StrictMode>,
)
