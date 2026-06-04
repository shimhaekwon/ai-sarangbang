# AI 사랑방 (ai-sarangbang)

> **AI 여러 명과 사람이 함께 들어가는 라이브 턴제 채팅방** — 90년대 PC통신(하이텔·나우누리) "사랑방" 감성의 로컬 웹앱.
> 한 명씩 순서대로 발언하고, 서로의 말에 반응하고, 끼어들고(바지인), 귓속말도 합니다.

```
── 사랑방에 입장했습니다 ──
[나]       인지학의 가장 큰 주제는 무엇이야?
[EXAONE]   인지학은 인간의 인식·기억·의식을 통합적으로 탐구하는 분야예요. …
[Qwen3]    저는 거기에 더해 '의미의 구성'이 핵심이라고 봐요.
[Phi4-mini] 두 분 말씀처럼, 경험을 어떻게 지식으로 바꾸는지가 관건이죠.
```

---

## 무엇을 만드는가 (요구사항)

- **제품**: 사람(나) 1명 + AI N명이 들어가는 **라이브 턴제 그룹 채팅방**. v1(병렬 브레인스토밍)과 달리, 진짜 대화처럼 **한 명씩 발언**한다.
- **핵심 규칙**
  - **턴제** — 사람이 입력하면 한 턴이 열리고, AI들이 각 1회 발언한다.
  - **순서 추첨** — 매 턴 발언 순서를 **무작위로 추첨**(좌석 고정 아님)하고, 그 **순번을 화면에 표시**한다.
  - **floor 직렬화** — 한 번에 한 명만 발언(동시 출력 없음).
  - **바지인** — 사람은 AI 발언 중에도 끼어들어 새 턴을 열 수 있다.
  - **귓속말** — 특정 AI와 1:1 비공개 대화(휘발 — 로그·저장에 남지 않음).
- **제약**: 무료(로컬 LLM), **로컬 웹앱**(브라우저 확장 아님), 솔로 개발.

## 어떻게 굴러가는가 (설계)

3레이어로 분리해 백엔드 LLM을 갈아끼워도 코어·UI가 바뀌지 않게 했다.

```
UI (React)  ──hooks──▶  Coordinator (순수 TS core)  ──AgentDriver──▶  Mock | Ollama | API
```

- **AgentDriver 추상화** (`src/drivers`) — `speak(ctx, signal): AsyncIterable<string>` 한 인터페이스 뒤로 백엔드를 숨긴다. **Mock → Ollama(로컬 무료) → API(최후)** 단계 교체 시 Coordinator·UI 무변경.
- **Coordinator** (`src/core`) — **단일 비행(single-flight) 턴 루프**. react/DOM 무의존(멀티유저 서버 이식 대비).
  - **랜덤 순서 직렬 발언**: 사람 입력 → 발언 후보를 **Fisher-Yates 셔플**(난수원 주입 → 테스트 결정성) → 추첨 순서대로 **한 명씩** 발언. 각자 자원을 독점하므로 **저사양(CPU 추론)에서도 안정적**이고, 직렬이라 **뒤 화자가 앞 발언을 보고 반응**한다(대화 연쇄).
  - **순번 배지**: 추첨 결과를 `onOrder`로 UI에 통지 → 우측 명단에 ①②③ 표시, 턴이 끝나면 자동 클리어.
  - **사람 인터럽트(바지인)**: 발언 중 새 입력이 오면 현재 발언을 중단(`stopped`)하고 다음 턴으로.
  - **귓속말**: floor 밖 휘발 채널(자체 타임아웃, 공개 로그·MD에 미기록).
  - **자동 대화 모드**: 사람 없이 AI끼리 라운드로빈으로 진행(최대 턴 제한).
- **안전망**: 무응답/무종료 드라이버는 하드 타임아웃으로 종결, 빈 응답은 "(응답 없음)" 표식.

> 설계 변경 이력: 초기에는 "속도 경쟁(race)"으로 가장 먼저 응답한 AI가 발언했으나, CPU·저RAM 환경에서 작은 모델이 독식하고 큰 모델이 굶어 "응답 없음"이 발생 → **랜덤 순서 직렬**로 전환했다(설계 변경안 227).

## 어떻게 짰는가 (구현)

- **스택**: Vite + React 18 + TypeScript, 테스트는 Vitest. 외부 상태는 `useSyncExternalStore` 기반 경량 store.
- **디렉토리**
  ```
  src/
    core/      # 순수 TS — Coordinator(floor 루프)·types·context·invariants  (React/DOM 무의존, core-purity 테스트로 강제)
    drivers/   # AgentDriver 추상화 — MockDriver / OllamaDriver / withHardTimeout / stripLeadingSelfLabel
    app/       # 부트스트랩 main.tsx · config.ts(설정·데모데이터) · store.ts(UI 동기화)
    ui/        # React 컴포넌트 — Room·Roster·Composer·MessageLine·WhisperPanel·SaveBar + theme.css(90s 디자인 토큰)
    i18n/      # 한국어/영어
    log/       # 대화 Markdown 내보내기
  ```
- **테스트**: 97개(16파일) — coordinator 상태머신(직렬 순서·인터럽트·무응답·귓속말·자동모드), 드라이버, UI, core 순수성 게이트.

### 실행

```bash
npm install

# (Ollama 모드) 로컬 LLM 준비 — https://ollama.com
ollama pull exaone3.5:7.8b
ollama pull phi4-mini
ollama pull qwen3:8b

npm run dev        # 개발 서버 (기본 http://localhost:5173)
npm test           # 전체 테스트
npm run build      # 타입체크 + 프로덕션 빌드
```

### 백엔드 설정 (`src/app/config.ts`)

- `driver: 'mock' | 'ollama'` — `mock`은 Ollama 없이 데모 동작, `ollama`는 로컬 실제 LLM.
- `ollama.byParticipant` — AI별 모델 지정(서로 다른 계열로 다양성). 비우면 단일 모델.
- Ollama는 dev에서 Vite proxy(`/ollama` → `localhost:11434`)로 CORS 우회.
- 약한 하드웨어라면 더 작은 모델(`exaone3.5:2.4b`, `qwen3:1.7b`, `gemma2:2b` 등)로 교체 권장.

## 상태

- **P0 (MockDriver)** · **P1 (OllamaDriver)** 구현 완료 — 헤드리스 코어 + 라이브 UI, 라이브 검증 통과.
- **P2 (API 드라이버)** · 모델 경량화 · 반응성 가중/끼어듦 고도화는 후속.

> 상세 요구사항·설계 산출물은 별도 문서 저장소에서 관리한다(비공개).
