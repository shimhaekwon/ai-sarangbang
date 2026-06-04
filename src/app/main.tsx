// 부트스트랩 — App 루트만 렌더([228] §4.1). 세션 조립은 App→buildSession으로 이관(로비에서 런타임 선택).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { config } from './config'
import { setLocale } from '../i18n'
import '../ui/theme.css'

setLocale(config.locale) // 로비 렌더 전 locale 확정(buildSession도 재호출하나 무해)

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root element not found')
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
