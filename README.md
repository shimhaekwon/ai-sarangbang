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
  - **자동 대화 모드**: 사람 없이 AI끼리 진행. **바퀴 로테이션**(전원이 한 바퀴씩, 순서는 매 바퀴 랜덤·직전 화자 연속 회피)으로 균등 발언하며, 한 바퀴가 끝날 때마다 **"라운드 종료" 구분선**을 표시. 최대 턴 수 1~99 조절.
- **진입 로비**: 방에 들어가기 전 **로컬 Ollama 모델 목록을 받아 AI별 모델·이름·사고모드·인원을 고르고 입장**(localStorage 영속). 모델 목록이 안 보일 때를 대비해 **주소 직접 지정·로딩 타임아웃·연결 진단·재연결** 제공.
- **안전망**: 무응답/무종료 드라이버는 하드 타임아웃으로 종결, 빈 응답은 "(응답 없음)" 표식.

> 설계 변경 이력: 초기에는 "속도 경쟁(race)"으로 가장 먼저 응답한 AI가 발언했으나, CPU·저RAM 환경에서 작은 모델이 독식하고 큰 모델이 굶어 "응답 없음"이 발생 → **랜덤 순서 직렬**로 전환(227). 이후 진입 **로비**(런타임 모델 선택·228), 자동 대화 **바퀴 로테이션 + 라운드 종료선**, **Ollama 연결 보강**(주소 지정·타임아웃·진단·재연결)을 추가했다.

## 어떻게 짰는가 (구현)

- **스택**: Vite + React 18 + TypeScript, 테스트는 Vitest. 외부 상태는 `useSyncExternalStore` 기반 경량 store.
- **디렉토리**
  ```
  src/
    core/      # 순수 TS — Coordinator(floor 루프·dispose)·types·context·invariants  (React/DOM 무의존, core-purity 테스트로 강제)
    drivers/   # AgentDriver 추상화 — MockDriver / OllamaDriver / ollamaApi(모델 목록) / withHardTimeout / stripLeadingSelfLabel
    app/       # 부트스트랩 main.tsx · App(로비↔방 전환) · buildSession · config · store(UI 동기화) · persist(영속)
    ui/        # React 컴포넌트 — Lobby(진입)·Room·Roster·Composer·MessageLine·WhisperPanel·SaveBar·roundMarks + theme.css(90s 디자인 토큰)
    i18n/      # 한국어/영어
    log/       # 대화 Markdown 내보내기
  ```
- **테스트**: 150개(23파일) — coordinator 상태머신(랜덤 직렬·바퀴 로테이션·인터럽트·무응답·귓속말·dispose), 드라이버·연결(타임아웃·URL 정규화), 로비·라운드 종료선, UI, core 순수성·UI 한글 리터럴 게이트.

### 실행

```bash
npm install

# (Ollama 모드) 로컬 LLM 준비 — https://ollama.com (설치된 모델은 진입 로비에서 선택)
ollama pull exaone3.5:7.8b
ollama pull phi4-mini
ollama pull qwen3.5:4b

npm run dev        # 개발 서버 (기본 http://localhost:5173)
npm test           # 전체 테스트
npm run build      # 타입체크 + 프로덕션 빌드
```

### 모델·연결 설정

- **진입 로비**(권장) — 앱을 열면 로컬 Ollama 모델 목록에서 **AI별 모델·이름·사고모드·인원을 골라 입장**(선택은 localStorage에 영속).
- **Ollama 주소** — 로비의 "Ollama 주소" 칸. 비우면 자동(dev/preview는 Vite proxy `/ollama` → `localhost:11434`로 CORS 우회), 다른 PC·포트면 `http://호스트:11434` 직접 지정(scheme 없이 입력해도 자동 보충). 단 직접 지정 시 그 **Ollama에 `OLLAMA_ORIGINS` 허용 필요**(예: `OLLAMA_ORIGINS=* ollama serve`). 모델이 안 보이면 **재연결**·**8초 타임아웃**·"연결 시도한 주소" 진단으로 원인 파악.
- **데모** — Ollama 없이 "Mock 데모로 시작"으로 동작 확인.
- 정적 기본값은 `src/app/config.ts`(`driver`·`ollama.byParticipant` = 데모/폴백). 약한 하드웨어라면 더 작은 모델(`exaone3.5:2.4b`, `qwen3.5:4b`, `gemma2:2b` 등) 권장.

## 상태

- **P0 (MockDriver)** · **P1 (OllamaDriver)** 구현 완료 — 헤드리스 코어 + 라이브 UI, 라이브 검증 통과.
- **랜덤 순서 직렬 floor**(227) · **진입 로비/런타임 모델 선택**(228) · 자동 대화 **바퀴 로테이션 + 라운드 종료선** · **Ollama 연결 보강**(주소 지정·타임아웃·진단·재연결) 반영 완료.
- **P2 (API 드라이버)** · 모델 경량화 · 반응성 가중/끼어듦 고도화 · **대화 중 모델 교체**는 후속.

> 상세 요구사항·설계 산출물은 별도 문서 저장소에서 관리한다(비공개).
