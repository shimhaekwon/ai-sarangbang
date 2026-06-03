import { describe, it, expect, vi } from 'vitest'
import { createRoomStore } from './store'
import { message, participant, room } from '../core/test-helpers'

const baseRoom = () => room([participant({ id: 'a1', kind: 'ai', seat: 1 })], [])

describe('createRoomStore — UI↔core 동기화([226] S2.5)', () => {
  it('publish: 새 id는 append', () => {
    const store = createRoomStore(baseRoom())
    store.publish(message({ id: 'm1', by: 'a1', text: 'hi', status: 'streaming' }))
    expect(store.getSnapshot().history.map((m) => m.id)).toEqual(['m1'])
  })

  it('publish: 같은 id는 in-place 갱신(길이 유지·텍스트/상태 갱신·새 배열 ref)', () => {
    const store = createRoomStore(baseRoom())
    store.publish(message({ id: 'm1', by: 'a1', text: 'h', status: 'streaming' }))
    const before = store.getSnapshot().history
    store.publish(message({ id: 'm1', by: 'a1', text: 'hello', status: 'done' }))
    const after = store.getSnapshot().history
    expect(after).toHaveLength(1)
    expect(after[0].text).toBe('hello')
    expect(after[0].status).toBe('done')
    expect(after).not.toBe(before) // 새 배열 ref → React 리렌더
  })

  it('onState: turnState Map 갱신', () => {
    const store = createRoomStore(baseRoom())
    store.onState('a1', 'speaking')
    expect(store.getSnapshot().turnState.get('a1')).toBe('speaking')
    store.onState('a1', 'done')
    expect(store.getSnapshot().turnState.get('a1')).toBe('done')
  })

  it('onWhisper: whispers thread 복사본으로 갱신(원본과 분리)', () => {
    const store = createRoomStore(baseRoom())
    const thread: Parameters<typeof store.onWhisper>[1] = { target: 'a1', messages: [{ by: 'human', text: 'q' }] }
    store.onWhisper('a1', thread)
    const got = store.getSnapshot().whispers.get('a1')!
    expect(got.messages).toEqual([{ by: 'human', text: 'q' }])
    expect(got).not.toBe(thread) // 복사본(휘발 격리)
  })

  it('onRoom: room 메타 재독(status/turnNo/floorHolder)', () => {
    const r = baseRoom()
    const store = createRoomStore(r)
    r.status = 'turn_active'
    r.turnNo = 3
    r.floorHolder = 'a1'
    store.onRoom()
    const s = store.getSnapshot()
    expect(s.status).toBe('turn_active')
    expect(s.turnNo).toBe(3)
    expect(s.floorHolder).toBe('a1')
  })

  it('subscribe: emit 시 listener 호출, unsubscribe 후 미호출', () => {
    const store = createRoomStore(baseRoom())
    const fn = vi.fn()
    const un = store.subscribe(fn)
    store.publish(message({ id: 'm1', by: 'a1' }))
    expect(fn).toHaveBeenCalledTimes(1)
    un()
    store.publish(message({ id: 'm2', by: 'a1' }))
    expect(fn).toHaveBeenCalledTimes(1) // 해지 후 미호출
  })

  it('getSnapshot: emit 사이엔 stable ref(useSyncExternalStore 무한루프 방지)', () => {
    const store = createRoomStore(baseRoom())
    const s1 = store.getSnapshot()
    expect(store.getSnapshot()).toBe(s1) // emit 없으면 동일 ref
    store.publish(message({ id: 'm1', by: 'a1' }))
    expect(store.getSnapshot()).not.toBe(s1) // emit 후 새 ref
  })

  it('[C3] onAuto: autoActive 갱신', () => {
    const store = createRoomStore(baseRoom())
    expect(store.getSnapshot().autoActive).toBe(false)
    store.onAuto(true)
    expect(store.getSnapshot().autoActive).toBe(true)
    store.onAuto(false)
    expect(store.getSnapshot().autoActive).toBe(false)
  })
})
