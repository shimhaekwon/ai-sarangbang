// [228 §4.5/4.6/4.8/4.9] 진입 로비 — 로컬 모델 목록(/api/tags) → AI별 모델·이름·사고모드·인원 선택 후 입장.
// [중요] 모든 표시 문자열은 i18n 경유(ui-no-korean 게이트). 영속 복원(D-7: 자동입장 아님 — 모델 검증 위해 로비 재노출).
import { useCallback, useEffect, useState } from 'react'
import { listModels, type OllamaModel } from '../drivers/ollamaApi'
import { loadConfig, reconcileModels, saveConfig } from '../app/persist'
import { defaultNameForModel, guessThinking, type AiSlot, type RoomConfig } from '../app/config'
import { newId } from '../core/id'
import { t } from '../i18n'

export interface LobbyProps {
  onEnter: (config: RoomConfig) => void // ollama 세션(선택 모델)
  onDemo: () => void // [H2] Mock 데모(고정 demo id)
}

const MAX_AIS = 6 // [D-2] 최대 AI 수

// 모델 태그 → 새 슬롯. think는 tri-state(§4.9): 사고모델이면 기본 false(끔), 아니면 undefined(미전송).
function makeSlot(model: string): AiSlot {
  return { id: newId(), name: defaultNameForModel(model), model, think: guessThinking(model) ? false : undefined }
}

type LoadState = 'loading' | 'ready' | 'error'

export function Lobby({ onEnter, onDemo }: LobbyProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [models, setModels] = useState<OllamaModel[]>([])
  const [slots, setSlots] = useState<AiSlot[]>([])
  const [humanName, setHumanName] = useState('')

  const load = useCallback(async () => {
    setLoadState('loading')
    try {
      const ms = await listModels()
      setModels(ms)
      const saved = loadConfig()
      if (saved && saved.ais.length > 0) {
        // 슬롯 그대로 복원(사라진 모델도 유지 — 사용자가 교체 결정). [L-C] think는 재유도(regex drift/손상 대비: 비-thinking → undefined 보장)
        setSlots(saved.ais.map((a) => ({ ...a, think: guessThinking(a.model) ? a.think ?? false : undefined })))
        setHumanName(saved.humanName ?? '')
      } else {
        setSlots(ms.length > 0 ? [makeSlot(ms[0].name)] : []) // 기본 1슬롯(첫 모델)
      }
      setLoadState('ready')
    } catch {
      setLoadState('error') // §4.8 Ollama 미실행/접근 불가
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // ===== 슬롯 조작 =====
  const addSlot = () => {
    if (slots.length >= MAX_AIS || models.length === 0) return
    setSlots((s) => [...s, makeSlot(models[0].name)])
  }
  const removeSlot = (id: string) => setSlots((s) => s.filter((x) => x.id !== id))
  const changeModel = (id: string, model: string) =>
    setSlots((s) =>
      s.map((x) => {
        if (x.id !== id) return x
        const wasAuto = !x.name.trim() || x.name === defaultNameForModel(x.model) // [§4.6] 자동값이면 갱신, 편집은 보존
        const name = wasAuto ? defaultNameForModel(model) : x.name
        const think = guessThinking(model) ? x.think ?? false : undefined // [§4.9] 비-thinking → undefined
        return { ...x, model, name, think }
      }),
    )
  const changeName = (id: string, name: string) => setSlots((s) => s.map((x) => (x.id === id ? { ...x, name } : x)))
  const toggleThink = (id: string, value: boolean) => setSlots((s) => s.map((x) => (x.id === id ? { ...x, think: value } : x)))

  // [L-A/L-B/R1] 사라진 모델 = slots 기준 매 렌더 derive(고정 저장 아님) — 모델 교체/삭제 시 배너 즉시 갱신. dedup은 reconcileModels.
  const missing = models.length > 0 ? reconcileModels({ v: 1, ais: slots }, models.map((m) => m.name)) : []
  // [M1] AI ≥ 1 하드 게이트(0명이면 빈 턴). + 모델 목록이 있어야 입장.
  const canEnter = loadState === 'ready' && models.length > 0 && slots.length >= 1
  const enter = () => {
    if (!canEnter) return
    const ais = slots.map((s) => ({ ...s, name: s.name.trim() || defaultNameForModel(s.model) })) // [R2] 빈 이름 보정
    const cfg: RoomConfig = { v: 1, ais, humanName: humanName.trim() || undefined }
    saveConfig(cfg) // [D-5] 전체 config 영속
    onEnter(cfg)
  }

  return (
    <div className="lobby">
      <div className="lb-card">
        <h1>{t('lobby.title')}</h1>
        <p className="lb-sub">{t('lobby.subtitle')}</p>

        {loadState === 'loading' && <div className="lb-status">{t('lobby.loading')}</div>}

        {loadState === 'error' && (
          <div className="lb-error">
            <div>{t('lobby.error')}</div>
            <div className="lb-actions">
              <button onClick={() => void load()}>{t('lobby.retry')}</button>
              <button onClick={onDemo}>{t('lobby.demo')}</button>
            </div>
          </div>
        )}

        {loadState === 'ready' && models.length === 0 && (
          <div className="lb-error">
            <div>{t('lobby.empty')}</div>
            <div className="lb-hint">{t('lobby.emptyHint')}</div>
            <div className="lb-actions">
              <button onClick={() => void load()}>{t('lobby.retry')}</button>
              <button onClick={onDemo}>{t('lobby.demo')}</button>
            </div>
          </div>
        )}

        {loadState === 'ready' && models.length > 0 && (
          <>
            {missing.length > 0 && <div className="lb-warn">{t('lobby.missing', { models: missing.join(', ') })}</div>}

            <label className="lb-human">
              <span className="lb-label">{t('lobby.human')}</span>
              <input
                className="lb-name"
                value={humanName}
                onChange={(e) => setHumanName(e.target.value)}
                placeholder={t('participant.me')}
                aria-label={t('lobby.human')}
              />
            </label>

            <div className="lb-slots">
              {slots.map((slot) => {
                const gone = !models.some((m) => m.name === slot.model) // 복원됐으나 사라진 모델
                return (
                  <div className={gone ? 'lb-slot lb-gone' : 'lb-slot'} key={slot.id}>
                    <select value={slot.model} onChange={(e) => changeModel(slot.id, e.target.value)} aria-label={t('lobby.model')}>
                      {gone && <option value={slot.model}>{slot.model}</option>}
                      {models.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.parameterSize ? `${m.name} (${m.parameterSize})` : m.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="lb-name"
                      value={slot.name}
                      onChange={(e) => changeName(slot.id, e.target.value)}
                      placeholder={t('lobby.name')}
                      aria-label={t('lobby.name')}
                    />
                    {slot.think !== undefined && (
                      <label className="lb-think" title={t('lobby.thinkHint')}>
                        <input type="checkbox" checked={slot.think} onChange={(e) => toggleThink(slot.id, e.target.checked)} />
                        {t('lobby.think')}
                      </label>
                    )}
                    <button className="lb-x" onClick={() => removeSlot(slot.id)} aria-label={t('lobby.remove')}>
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>

            {slots.length === 0 && <div className="lb-hint">{t('lobby.gate')}</div>}

            <div className="lb-actions">
              <button onClick={addSlot} disabled={slots.length >= MAX_AIS}>
                {t('lobby.addAi')}
              </button>
              <button className="lb-enter" onClick={enter} disabled={!canEnter}>
                {t('lobby.enter')}
              </button>
            </div>

            <button className="lb-demo-link" onClick={onDemo}>
              {t('lobby.demo')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
