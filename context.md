# Zotero Claude Assist — 구현 컨텍스트 (v2)

이 문서는 claude.ai에서 사용자(Okdol)와 논의해 확정한 Zotero 플러그인 설계를 Claude Code agent에게 넘기기 위한 것이다. v1 문서의 "주석 코멘트 자동 감지" 설계는 폐기되었고, 이 문서가 그것을 완전히 대체한다.

작업 원칙:
- §2의 결정 사항은 확정된 것이다. 다시 논의하지 말고 그대로 구현한다.
- `[검증 필요]` 항목은 추측으로 구현하지 말고 실제 환경(Zotero 소스, `claude --help`, 공식 문서)에서 먼저 확인한다. 설계와 실제 API가 어긋나면 사용자에게 알리고 대안을 제시한다.
- `[확인됨]` 항목은 참고 구현(§11)의 코드로 확인한 것이다. 그래도 설치된 버전에서 한 번 더 확인한다.
- 마일스톤(§13) 단위로 진행하고, 각 단계가 끝나면 사용자가 Zotero에서 직접 테스트하게 한다.

함께 넘기는 파일:

| 경로 | 내용 |
|---|---|
| `prompts/context-note.md` | 컨텍스트 노트 생성 시스템 프롬프트 (사용자의 Paper Analysis 지침 + 참조 부록) |
| `prompts/memo-batch.md` | 메모 질문 일괄 답변 시스템 프롬프트 |
| `prompts/sidebar-chat.md` | 사이드바 채팅 시스템 프롬프트 |
| `prompts/translate.md` | 문맥 번역 시스템 프롬프트 (Gemini) |
| `prompts/humanize-digest.md` | 메모 답변·채팅에 붙이는 한국어 문체 규칙 요약본 |
| `vendor/humanize-korean/` | humanize-korean 스킬 룰북 원본 2개 + 라이선스 (노트 생성 때 전문 사용) |

---

## 1. 배경과 전체 그림

사용자는 macOS에서 Zotero로 ML 논문(주로 연합학습, data valuation)을 깊게 비판적으로 읽는 연구자다. 플러그인은 네 부분으로 이루어진다.

1. **문맥 번역**: PDF에서 선택한 텍스트를 앞뒤 문장과 함께 Gemini로 보내 문맥에 맞게 번역한다.
2. **컨텍스트 노트**: 논문마다 Paper Analysis 지침 형식의 구조화된 분석 노트를 한 번 만들어 둔다. 이후 질문에 답할 때 모델이 논문 전문 대신 이 노트를 읽는다.
3. **메모 질문 → 질문 노트**: 사용자는 읽으면서 하이라이트(또는 그림 영역 주석)의 코멘트에 `@claude 질문`을 적어 둔다. 사이드바의 버튼을 누르면 대기 중인 메모 질문을 한 번에 모아 답하고, 결과를 논문의 **질문 노트** 하나에 쌓는다.
4. **사이드바 채팅**: 논문 전체를 두고 하는 전역 질문을 대화로 처리한다. 필요한 섹션은 모델이 직접 골라 읽는다.

결과적으로 **논문 하나에 플러그인 노트가 두 개** 생긴다.

| 노트 | 태그 | 역할 |
|---|---|---|
| 컨텍스트 노트 | `claude-context` | **입력**: 모델이 읽는 논문 분석 |
| 질문 노트 | `claude-qa` | **출력**: 사용자가 남기는 질의응답 기록 |

용어: 하이라이트에 다는 **주석 코멘트(annotation comment)**를 사용자는 "메모"라 부르고, 아이템에 붙는 **자식 노트(child note)**를 "노트"라 부른다. 이 문서도 같은 구분을 쓴다.

---

## 2. 확정된 결정 사항

| 항목 | 결정 |
|---|---|
| 플랫폼 | macOS. Zotero 최신 안정판은 10.x (2026-10 기준 10.0.7). 사용자의 설치 버전은 `[검증 필요]` |
| 구조 | 하나의 플러그인. windingwind/zotero-plugin-template (TypeScript) 기반 |
| 번역 백엔드 | Gemini API 무료 티어. AI Studio API 키, 결제 계정 미연결 |
| Claude 백엔드 | 로컬에 설치된 **공식 `claude` CLI를 subprocess로 실행**. 사용자의 Claude Team (Premium 시트) 로그인 사용. Agent SDK는 쓰지 않는다 (§3) |
| 메모 질문 표기 | 주석 코멘트의 줄 머리에 `@claude 질문`. 처리 후 `@claude ✓ 질문`으로 바뀐다 |
| 메모 질문 처리 시점 | **사용자가 사이드바에서 명령할 때만**. 주석 자동 감지(Notifier 감시)는 구현하지 않는다 |
| 메모 질문 처리 방식 | 플러그인이 대기 중인 메모를 모아 한 번의 호출로 보내고, 구조화된 응답을 받아 **플러그인 코드가** 질문 노트에 기록한다. 모델에게 쓰기 권한을 주지 않는다 |
| 답변 기록 위치 | 메모 코멘트에는 답변을 쓰지 않는다. 논문당 하나인 질문 노트에 덧붙인다 |
| 질문 노트 순서 | 시간순, **끝에 덧붙이기만** 한다. 기존 내용을 다시 쓰지 않는다 |
| 그림 질문 | 지원한다. 이미지(영역) 주석의 그림을 모델에게 보내고, 질문 노트에도 그림을 넣는다 |
| 컨텍스트 노트 트리거 | ① 지연 생성: 메모 일괄 처리나 사이드바 대화를 시작할 때 노트가 없으면 먼저 생성 ② 아이템 우클릭 메뉴의 수동 생성·재생성. 논문 추가 시 자동 생성, 태그·컬렉션 기반 자동화는 구현하지 않는다 |
| 모델 | 노트 생성 `opus`, 메모 답변·채팅 `sonnet` (CLI 모델 alias). 설정에서 변경 가능 |
| 노트 형식 | 사용자의 Paper Analysis 지침(5요소 + 서사 일관성 점검) + 질의응답용 참조 부록 |
| 한국어 문체 | humanize-korean 스킬의 작성 모드 규칙 적용 (§9) |
| Translate for Zotero | 지우지 않고 공존. 사용자가 그쪽 자동 번역을 끈다. 이 플러그인의 번역은 사용자가 요청할 때만 실행 |
| 배포 | 사용자 본인 전용. 공개 배포하지 않는다 |
| 구현 순서 | 메모 일괄 처리와 질문 노트를 먼저, 사이드바 채팅은 그다음 (§13) |

---

## 3. 약관·정책 제약 (반드시 지킬 것)

**Claude.** 구독 로그인(OAuth) 토큰은 Claude Code와 claude.ai 전용이며, 그 토큰을 다른 제품·도구·Agent SDK에서 쓰는 것은 허용되지 않는다고 문서에 명시되어 있다 (code.claude.com/docs/en/legal-and-compliance). 따라서:

- 플러그인은 사용자가 설치한 **공식 `claude` 바이너리를 subprocess로 실행하는 것만** 한다.
- `@anthropic-ai/claude-agent-sdk`를 쓰지 않는다. 참고: llm-for-zotero의 Claude 브리지(cc-llm4zotero-adapter)는 Agent SDK를 쓰는데, 이것이 우리가 그 구조를 따르지 않는 이유다.
- `~/.claude/` 아래 크레덴셜 파일이나 macOS Keychain의 토큰을 읽지 않는다. 그 토큰으로 `api.anthropic.com`을 직접 호출하지 않는다.
- 2026년 6월 기준 안내로는 `claude -p` 사용량이 구독 사용량 한도에서 차감된다 (support.claude.com 문서 15036540). 정책이 바뀔 수 있으므로 과금 구조를 코드에 하드코딩하지 않는다.

**Gemini.** API 키 방식만 쓴다. Gemini CLI나 Antigravity의 Google 로그인(OAuth)을 서드파티에서 쓰는 것은 Google 약관 위반이고 계정 정지 사례가 있다. 무료 티어는 결제 계정이 없으면 과금되지 않는 대신, 요청 데이터가 Google 제품 개선에 쓰일 수 있고 속도 제한이 있다. 429 응답을 정상 상황으로 처리한다.

---

## 4. 아키텍처

```
src/
  llm/
    claudeCli.ts      # 바이너리 탐지, 단발 호출, 세션형 프로세스, 직렬 큐
    gemini.ts         # Gemini generateContent 호출
  pdf/
    pageText.ts       # 페이지별 텍스트 (전문 캐시 우선, 리더 폴백)
    passage.ts        # 하이라이트 위치 찾기, 소속 문단과 앞뒤 문단 자르기
    documentMap.ts    # 섹션 지도 (책갈피 우선, 본문 제목 폴백)
    annotationImage.ts# 이미지 주석의 그림 얻기
  notes/
    noteHtml.ts       # 마크다운 → Zotero 노트 HTML (수식 포함, 안전한 변환)
    contextNote.ts    # 컨텍스트 노트 조회·생성·재생성, 아이템별 잠금
    qaNote.ts         # 질문 노트 조회·생성·덧붙이기, 중복 검사
  features/
    translate.ts      # 기능 1
    memoBatch.ts      # 메모 질문 수집 → 일괄 호출 → 질문 노트 기록 → 메모 표시 변경
    sidebar/          # 사이드바 패널 (1단계: 메모 처리 패널, 2단계: 채팅)
  prefs/
  prompts.ts          # 프롬프트 파일 로딩 (사용자 편집 가능 경로 우선)
```

프롬프트 파일은 빌드에 기본본을 포함하되, 실행 시에는 사용자 편집 가능한 디렉터리(`<Zotero 데이터 디렉터리>/zotero-claude-assist/prompts/`)를 먼저 찾는다. 처음 실행할 때 기본본을 그 디렉터리로 복사해 둔다. 사용자가 다시 빌드하지 않고 프롬프트를 고칠 수 있게 하기 위해서다.

**호출 직렬화.** 단발 호출(노트 생성, 메모 일괄 처리)은 하나의 직렬 큐로 처리한다. 같은 아이템의 노트 생성이 진행 중이면 새 생성 요청을 만들지 말고 기존 작업을 기다린다. 사이드바 채팅의 세션형 프로세스는 큐와 별개로 논문당 하나만 둔다.

---

## 5. `claude` CLI 실행

### 5.1 바이너리 탐지

Finder나 Dock에서 실행한 Zotero는 셸의 PATH를 물려받지 않는다. 다음 후보를 차례로 확인하고, 여러 개가 있으면 `--version`으로 가장 최신을 쓴다 `[확인됨: zotero-claude-code claude-process.js]`.

1. 설정값 `claude.path`
2. `~/.local/bin/claude` (네이티브 설치)
3. `~/.claude/local/claude`
4. `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `/usr/bin/claude`
5. 환경의 PATH 디렉터리들

찾지 못하면 설정 패널에서 경로를 입력하게 안내한다. 처음 실행할 때 macOS Keychain 접근 허용 창이 뜰 수 있으니 연결 테스트로 미리 확인한다.

### 5.2 subprocess

`ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs")`의 `Subprocess.call`을 쓴다 `[확인됨]`. `environment: {}`와 `environmentAppend: true`로 Zotero 프로세스의 환경을 물려받는다 `[확인됨]`. `claude`가 npm 설치본이면 node가 PATH에 있어야 하므로, 탐지한 바이너리의 디렉터리를 PATH 앞에 덧붙인다. stderr는 반드시 별도로 읽어 비워 둔다(파이프가 차서 프로세스가 멈추는 것을 막기 위해).

### 5.3 공통 플래그

| 플래그 | 목적 |
|---|---|
| `-p --input-format stream-json --output-format stream-json --verbose` | 비대화형, 입력·출력 모두 JSON 줄 단위. 이미지를 보낼 수 있다 |
| `--setting-sources local --strict-mcp-config` | 사용자의 `~/.claude` CLAUDE.md·MCP 서버·훅을 불러오지 않는다. 사용자는 Claude Code를 다른 연구 작업에도 쓰므로 그 설정이 논문 답변에 섞이면 안 된다 |
| `--append-system-prompt-file <파일>` | 우리 시스템 프롬프트 지정 |
| `--permission-mode dontAsk` | 허용 목록 밖의 도구는 확인을 기다리지 않고 거절. 응답할 사람이 없는 확인 창 때문에 멈추는 것을 막는다 |
| `--allowedTools <목록>` | 단발 호출은 빈 목록(도구 없음). 사이드바는 `Read`만 |
| `--model`, `--effort` | 모델과 추론 강도 |
| `--resume <sessionId>` | 사이드바 세션 재개 |
| `--include-partial-messages` | 사이드바 스트리밍 |

위 플래그는 모두 zotero-claude-code의 `store.js`에서 실제로 쓰고 있다 `[확인됨]`. 다만 `--append-system-prompt-file`은 Claude Code 기본 시스템 프롬프트에 **덧붙이는** 것이다. 기본 프롬프트를 **대체**하는 옵션이 있으면 단발 호출에서는 그쪽을 써서 오버헤드를 줄인다 `[검증 필요]`.

실행 디렉터리(cwd)는 호출마다 플러그인 전용 임시 디렉터리로 지정한다(`<Zotero 데이터 디렉터리>/zotero-claude-assist/runs/<id>/`). 임의 디렉터리의 CLAUDE.md가 끼어들지 않게 하고, 사이드바의 `Read` 범위를 그 안으로 한정하기 위해서다.

이미지는 stream-json 사용자 메시지의 콘텐츠 블록으로 보낸다: `{type:"image", source:{type:"base64", media_type, data}}` 뒤에 `{type:"text", text}` `[확인됨: store.js]`.

모델 목록은 프로세스를 띄워 `{"type":"control_request","request_id":"…","request":{"subtype":"initialize"}}`를 보내고 `control_response`의 `models`를 읽어 얻을 수 있다 `[확인됨: claude-process.js]`. 설정 패널의 모델 선택에 쓴다.

타임아웃: 메모 일괄 처리는 질문 수에 비례(§9.4), 노트 생성 600초 (설정 가능). 사용량 한도 초과, 로그인 만료, 타임아웃, CLI 미발견을 구분된 메시지로 보여준다.

---

## 6. PDF 텍스트와 위치

### 6.1 페이지별 텍스트 (리더를 열지 않고)

1순위는 Zotero 전문 캐시 `storage/<KEY>/.zotero-ft-cache`다. Zotero가 `PDFWorker.getFullText`로 쓰는 파일이며, **페이지 경계가 form-feed(`\f`) 문자로 구분**되어 있다. 단, `Zotero.Fulltext.getPages(itemID)`의 인덱싱된 페이지 수와 `\f`로 나눈 조각 수가 정확히 일치하고, PDF가 그 뒤로 바뀌지 않았을 때만 신뢰한다. 어긋나면 2순위로 넘어간다. (출처: llm-for-zotero의 `zoteroFulltextPageCache.ts` 설계. **AGPL이므로 코드는 가져오지 말고 동작 원리만 참고한다.**)

2순위는 리더를 백그라운드로 열어 페이지 데이터를 읽는 것이다(§6.2).

텍스트 레이어가 없는 스캔 PDF는 지원하지 않는다. 추출 텍스트가 비정상적으로 짧으면 중단하고 알린다.

### 6.2 하이라이트의 소속 문단

리더 내부의 페이지 문자 데이터에는 문자마다 `spaceAfter`, `lineBreakAfter`, `paragraphBreakAfter`, `ignorable`이 있다 `[확인됨: zotero-claude-code bridge.js의 pageData·pageText]`. 이걸 쓰면 문단 경계를 휴리스틱 없이 정확히 자를 수 있다.

- 페이지 데이터 얻기: `reader._internalReader._primaryView`의 `_pdfPages[pageIndex]`, 없으면 `_ensureBasicPageData(pageIndex)`. 리더가 열려 있지 않으면 `Zotero.Reader.open(attachmentID, null, {openInBackground: true})` 후 대기 `[확인됨: bridge.js readerFor]`.
- 매칭: 공백을 모두 지우고 줄끝 하이픈을 제거한 문자열에서 하이라이트 텍스트를 찾는다. 리거처·줄바꿈·구두점 앞 공백 차이가 무시된다.
- 결과: 하이라이트가 속한 문단 + 앞뒤 N문단(기본 1).

주의: 이 방법은 리더의 **비공개 내부 구조**에 의존하므로 Zotero 업데이트 때 깨질 수 있다. 실패하면 §6.1의 페이지 텍스트에서 하이라이트 앞뒤 각 800자를 자르는 방식으로 대체하고, 결과에 "문맥 근사" 플래그를 남긴다.

### 6.3 문서 지도

섹션마다 한 줄: `id | 제목 | 페이지 범위 | 대략적 토큰 수`. PDF 책갈피(outline)가 있으면 그것을, 없으면 본문 제목을 쓴다. 사이드바 채팅에서 모델이 어느 섹션을 읽을지 고르는 색인이 되며, 프롬프트의 고정 앞부분에 넣어 캐시에 유리하게 한다. (아이디어 출처: llm-for-zotero의 `documentMap.ts`, `pdfBookmarks.ts`.) 컨텍스트 노트의 부록 D(Section Map)가 있으면 그것과 함께 쓴다.

### 6.4 이미지 주석의 그림

이미지(영역) 주석의 렌더링된 그림을 얻는 방법은 `[검증 필요]`. 후보: Zotero가 주석 이미지 캐시를 관리하는 API(`Zotero.Annotations` 계열), 또는 리더에서 해당 영역을 렌더링해 캡처. Zotero의 "Add Note from Annotations"가 이미지 주석을 노트에 넣는 방식이 가장 확실한 참고다.

---

## 7. 기능 1: 문맥 번역

**트리거.** 리더 텍스트 선택 팝업의 "문맥 번역" 버튼과 단축키. 팝업 확장은 `Zotero.Reader.registerEventListener("renderTextSelectionPopup", handler, pluginID)`이고, 핸들러 인자 `{reader, doc, params, append}`에서 선택 텍스트는 `params.annotation.text`다 `[확인됨: zotero-claude-code plugin.js]`. 언로드 시 `unregisterEventListener`.

**입력.** 선택 텍스트(target) + 같은 페이지에서 앞뒤 N문장(기본 2) + 논문 제목. 문장 경계는 §6.2의 문자 데이터를 쓰고, 실패하면 문맥 없이 번역하며 "문맥 미포함"을 표시한다.

**호출.**
```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
Header: x-goog-api-key: {API_KEY}
Body: { systemInstruction: {parts:[{text: <prompts/translate.md>}]},
        contents: [{role:"user", parts:[{text: <구성한 입력>}]}],
        generationConfig: { temperature: 0.2 } }
```
기본 모델은 무료 티어에서 쓸 수 있는 최신 Flash-Lite 계열 `[검증 필요: AI Studio 모델 목록]`.

**출력.** 팝업 안에 번역문과 복사 버튼. 같은 (target, context)의 결과는 세션 동안 캐시한다. 429는 "무료 티어 속도 제한, 잠시 후 다시 시도", 키 없음·오류는 설정 안내로 표시한다.

---

## 8. 노트

### 8.1 Zotero 노트 HTML 규칙

- 노트 루트는 `<div data-schema-version="…">`로 감싼다. 인용 데이터는 루트의 `data-citation-items`에 둔다. 정확한 스키마 버전과 형식은 Zotero의 `EditorInstanceUtilities`(`chrome/content/zotero/xpcom/editorInstance.js`)를 기준으로 한다 `[검증 필요]`.
- 디스플레이 수식은 `<pre class="math">$$…$$</pre>`로 저장된다 (출처: llm-for-zotero `noteRendering.ts`). 인라인 수식의 저장 형식은 `[검증 필요]` (Zotero 노트 편집기에서 인라인 수식을 하나 넣고 저장된 HTML을 확인한다).
- **모델 출력은 신뢰하지 않는다.** 마크다운을 HTML 문자열로 이어 붙이지 말고, 지원하는 요소(문단, 제목, 목록, 강조, 코드, 수식, 인용, 링크)만 만들어 텍스트를 이스케이프해 넣는다. 링크는 `http(s)`와 `zotero://`만 허용한다. (원칙 출처: zotero-claude-code `markdown.js`.)
- 노트 저장: `new Zotero.Item("note")`, `libraryID`, `parentID`, `setNote(html)`, `saveTx()` `[확인됨: bridge.js saveNote]`. 태그는 `addTag`.
- **기존 노트를 텍스트로 변환했다가 다시 쓰지 않는다.** 하이라이트 인용(`data-annotation`), 인용 칩(`data-citation`), 이미지(`data-attachment-key`)는 숨은 속성에 의미가 있어서 텍스트 왕복 시 망가진다. 질문 노트는 덧붙이기만 한다.

### 8.2 컨텍스트 노트

- **식별**: 부모 아이템의 자식 노트 중 태그 `claude-context`. 여러 개면 가장 최근 것을 쓰고 로그에 경고.
- **생성 트리거**: 메모 일괄 처리나 사이드바 대화 시작 시 없으면 먼저 생성(지연 생성), 그리고 아이템 우클릭 메뉴 "Claude 컨텍스트 노트 생성/재생성"(재생성은 확인 창 후 덮어쓰기). 그 외 자동 트리거 없음.
- **입력**: 시스템 = `prompts/context-note.md` + `vendor/humanize-korean/quick-rules.md` + `vendor/humanize-korean/discourse-patterns.md`. 사용자 메시지 = 메타데이터(제목, 저자, 연도, 학회/저널) + 전문, 페이지마다 `=== Page N ===` 표시(§6.1). v1은 전문을 그대로 보낸다.
- **호출**: 단발, 도구 없음, 모델 `opus`.
- **저장**: 모델 출력(마크다운)을 §8.1 규칙으로 변환. 첫머리에 한 줄 메타(생성 모델, 날짜, 프롬프트 버전). 사용자가 노트를 직접 고칠 수 있고, 이후 질문 처리에는 고친 내용을 그대로 쓴다.

### 8.3 질문 노트

- **식별·생성**: 태그 `claude-qa`, 제목 `Claude Q&A — {짧은 논문 제목}`. 처음 기록할 때 만든다.
- **항목 형식** (시간순, 노트 끝에 덧붙임):
  1. **원문**: 하이라이트를 Zotero 네이티브 인용 형식으로 넣는다. 노트에서 클릭하면 PDF 해당 위치로 이동해야 한다. 이미지 주석이면 그림을 넣는다. Zotero의 "Add Note from Annotations"와 같은 결과가 목표이므로, 그 기능의 구현(`Zotero.EditorInstance`의 주석 직렬화와 이미지 가져오기)을 기준으로 한다 `[검증 필요]`.
  2. **질문**: 메모의 `@claude` 뒤 텍스트
  3. **답변**: §8.1 규칙으로 변환 (수식 렌더링)
  4. **메타 한 줄**: `p.{페이지} · {날짜} · {모델} · ann:{주석 키}#{줄 번호}`
- **처리 여부의 기준은 메모의 `✓` 표시다.** 질문 노트 쪽에서 중복을 걸러내지 않는다. 기록 순서는 항상 "질문 노트에 덧붙이기 → 성공하면 메모를 `✓`로 변경"이다. 두 단계 사이에 중단되면 다음 실행에서 같은 항목이 한 번 더 기록될 수 있는데, 답변을 잃는 것보다 낫다고 보고 허용한다. 메타의 `ann:` 키는 추적용이다. 같은 `ann:키#줄`이 노트에 이미 있으면 메타 끝에 `(재질문)`을 붙인다.
- **덧붙이기 구현**: 기존 노트 HTML의 루트 `div` 닫는 태그 앞에 새 항목 HTML을 삽입한다. 문자열 조작은 이 지점에만 하고 기존 내용은 건드리지 않는다. 인용 데이터 레지스트리(`data-citation-items`)를 갱신해야 하는지는 `[검증 필요]`.
- **동시 편집 테스트 (사용자 합의 사항)**: 질문 노트를 편집기로 열어둔 상태에서 덧붙이기를 실행해 (a) 편집기에 반영되는지 (b) 사용자가 편집 중이던 내용이 사라지지 않는지 확인한다. 문제가 있으면 노트가 열려 있을 때 기록을 미루고 사이드바에 알리는 방식 등 대안을 사용자에게 제시한다.

---

## 9. 메모 질문 일괄 처리

### 9.1 메모 문법

- 주석 코멘트에서 **줄 머리가 `@claude` + 공백**이고 바로 뒤가 `✓`가 아닌 줄 하나가 질문 하나다. 한 코멘트에 여러 줄이 있으면 각각 별개의 질문이다.
- 처리가 끝나면 그 줄만 `@claude ✓ 질문`으로 바꾼다. 코멘트의 다른 내용과 서식은 건드리지 않는다. 주석 코멘트가 평문인지 일부 서식(HTML)을 허용하는지 `[검증 필요]`.
- 다시 묻고 싶으면 사용자가 `✓`를 지운다. 새 항목으로 기록되고 메타에 `(재질문)`이 붙는다(§8.3).
- 대상 주석: highlight, underline, image. ink와 note(스티키) 주석은 제외.
- 실패하면 표시를 바꾸지 않고 `@claude` 상태로 둔다. 다시 버튼을 누르면 재시도된다. 진행 중 표시(`⏳`)는 쓰지 않는다. 대신 사이드바 UI가 실행 중 버튼을 잠근다.

### 9.2 실행 흐름

1. 사이드바의 "메모 질문 답변" 버튼(또는 채팅 입력의 `/memos`)을 누른다. 대상은 현재 논문(부모 아이템)의 모든 PDF 첨부.
2. 대기 중인 메모 질문을 수집한다. `attachment.getAnnotations()`를 `annotationSortIndex`로 정렬해 논문 순서로 모은다 `[확인됨: bridge.js listAnnotations]`. 없으면 "대기 중인 질문 없음"을 표시하고 끝낸다.
3. 컨텍스트 노트를 확인하고, 없으면 먼저 생성한다(§8.2).
4. 질문마다 하이라이트 텍스트, 페이지, 소속 문단과 앞뒤 문단(§6.2), 이미지 주석이면 그림(§6.4)을 준비한다.
5. 대기 중인 질문을 **가능하면 한 번의 호출로** 보낸다. 호출을 나누는 기준은 문항 수가 아니라 예산이다: 한 호출의 질문이 `memo.maxQuestionsPerCall`(기본 30)을 넘거나, 이미지가 `memo.maxImagesPerCall`(기본 6)을 넘으면 논문 순서를 유지한 채 나눈다. 호출을 나누면 매번 컨텍스트 노트와 이전 질의응답을 다시 보내야 하므로, 상한은 드물게만 걸리는 안전장치로 둔다. 이미지는 stream-json 이미지 블록으로 함께 보낸다.
6. 응답을 파싱해 질문 노트에 항목을 덧붙이고(§8.3), 성공한 줄만 `@claude ✓`로 바꾼다.
7. 사이드바에 결과를 요약한다: 처리 n건, 실패 m건(사유), 질문 노트 열기 링크.

### 9.3 프롬프트

- 시스템: `prompts/memo-batch.md` + `prompts/humanize-digest.md`
- 사용자 메시지:
  - `<paper_meta>` 제목, 저자, 연도
  - `<context_note>` 컨텍스트 노트 전문 (HTML → 마크다운/평문)
  - `<previous_qa>` 질문 노트의 이전 질의응답(질문과 답변 텍스트만, 최근 것부터 일정 길이까지). 같은 내용을 반복하지 않게 하기 위함
  - `<questions>` 질문마다 `<q id="…" page="N" kind="highlight|image">` 안에 `<highlight>`, `<surrounding>`, `<question>`. 이미지 질문은 해당 이미지 블록의 순서를 id로 연결한다

### 9.4 응답 형식과 파싱

모델은 **JSON Lines**로 출력한다. 한 줄에 질문 하나, 각 줄은 완결된 JSON 객체 `{"id": "…", "answer": "마크다운"}`이다. 줄 단위로 바꾼 이유는 실패의 피해 범위를 줄이기 위해서다. 배열 하나로 받으면 출력이 중간에 끊기거나 이스케이프 하나만 틀려도 모든 답을 잃지만, 줄 단위면 완성된 줄은 살릴 수 있다. 그래서 묶음을 작게 나눌 필요가 없어진다.

**줄 단위 처리.**
- `--include-partial-messages`로 받은 텍스트 조각을 버퍼에 모으고, 줄바꿈이 나올 때마다 그 줄을 파싱한다 `[확인됨: 플래그 존재는 zotero-claude-code store.js]`.
- 파싱에 성공하고 id가 이번 호출의 질문이면 **그 즉시** 질문 노트에 덧붙이고 메모를 `✓`로 바꾼다(§8.3의 순서). 사이드바 진행 표시(n/N)도 이때 갱신한다.
- 코드 펜스 줄, 빈 줄, JSON이 아닌 줄은 무시한다. 줄 하나가 파싱에 실패하면 그 줄만 버린다.
- 프롬프트에 없는 id는 무시한다. 같은 id가 두 번 나오면 첫 번째만 쓴다.
- 프로세스가 끝나면 버퍼에 남은 마지막 줄도 한 번 파싱해 본다(마지막 줄바꿈이 빠진 경우). 끊긴 줄이면 버린다.

**누락 처리.**
- 호출이 끝난 뒤 답을 받지 못한 질문(누락, 파싱 실패, 출력 중단)만 모아 **한 번** 재호출한다. 재호출에는 그 질문들만 넣는다.
- 재호출 후에도 남은 질문은 `@claude` 그대로 두고 사이드바에 사유와 함께 실패로 표시한다.
- 사용량 한도 초과·로그인 만료로 끝난 경우는 재호출하지 않는다. 그때까지 받은 답은 이미 기록되어 있다.

**타임아웃.** 한 호출의 질문 수에 비례한다: `timeout.memoBaseSec`(기본 60) + 질문당 `timeout.memoPerQuestionSec`(기본 30), 최대 900초. 타임아웃이면 프로세스를 종료하고, 그때까지 완성된 줄은 이미 기록된 상태로 둔다. 나머지는 재호출하지 않고 실패로 표시한다(같은 원인으로 다시 시간 초과될 가능성이 높기 때문).

---

## 10. 사이드바 채팅 (2단계)

### 10.1 패널

`Zotero.ItemPaneManager.registerSection`으로 아이템 패널 섹션을 등록하고, 리더 탭의 사이드바 모드에서 보이게 한다 `[확인됨: zotero-claude-code plugin.js]`. 1단계에서는 이 패널에 **메모 처리 UI만** 둔다(버튼, 진행 상황, 결과 요약). 2단계에서 같은 패널에 채팅을 붙인다.

### 10.2 세션

- 논문당 하나의 대화. stream-json 입출력으로 `claude` 프로세스를 살려두고, 유휴 15분(설정 가능) 후 종료한다. 다음 메시지에서 `--resume <sessionId>`로 재개한다 `[확인됨: zotero-claude-code 동작 방식]`. 세션 ID와 대화 기록은 플러그인 데이터 디렉터리에 저장한다.
- 응답은 `--include-partial-messages`로 스트리밍해 보여준다. 마크다운은 §8.1의 안전 원칙으로 렌더링한다(채팅 화면은 `textContent`로만 삽입). 채팅 화면의 수식 조판은 범위 밖이다. 수식이 중요한 답은 질문 노트에 저장해서 보면 된다.

### 10.3 컨텍스트와 섹션 읽기

- 대화 첫 메시지 앞에 고정 블록: 논문 메타, 컨텍스트 노트, 문서 지도(§6.3), 질문 노트의 이전 질의응답.
- 섹션 원문 읽기: 대화 시작 시 실행 디렉터리에 섹션별 텍스트 파일을 만든다(`sections/s3_Method_p4-6.md` 등). `--allowedTools Read`, cwd를 그 디렉터리로 두고, 모델이 필요할 때 해당 파일을 읽게 한다. 다른 경로를 읽으려는 시도는 `dontAsk`로 거절된다. 실제로 경로 밖 읽기가 차단되는지 테스트한다 `[검증 필요]`.
- 사이드바 대화의 시스템 프롬프트: `prompts/sidebar-chat.md` + `prompts/humanize-digest.md`.

### 10.4 질문 노트로 저장

채팅 답변마다 "질문 노트에 저장" 버튼을 둔다. 저장 형식은 §8.3과 같되, 원문 칸에는 하이라이트 대신 `전역 질문`이라고 적는다.

---

## 11. 참고 구현

| 저장소 | 라이선스 | 활용 범위 |
|---|---|---|
| YufeiXIA/zotero-claude-code | MIT | 코드를 참고하거나 가져와도 된다(출처 표기). 핵심 파일: `addon/content/claude-process.js`(바이너리 탐지, 모델 목록), `store.js`(실행 플래그, 세션, 이미지 전송), `bridge.js`(`pageData`·`pageText`·`readerFor`·`saveNote`·`listAnnotations`), `markdown.js`(안전한 렌더링), `plugin.js`(선택 팝업, 아이템 패널 섹션) |
| yilewang/llm-for-zotero | AGPL-3.0 | **코드를 가져오지 않는다.** 설계 아이디어만: 전문 캐시의 페이지 구분(`services/pdf/zoteroFulltextPageCache.ts`), 노트 HTML·수식 형식(`services/notes/noteRendering.ts`, `utils/noteCitations.ts`, `utils/noteEmbeds.ts`), 문서 지도(`services/paperContent/documentMap.ts`, `pdfBookmarks.ts`) |
| Zotero 소스 (zotero/zotero) | AGPL-3.0 | API 확인용. 주석 직렬화·노트 생성은 `chrome/content/zotero/xpcom/editorInstance.js` |

zotero-claude-code는 Windows에서만 테스트되었고 macOS 경로는 미검증이라고 명시되어 있다. 가져온 코드는 macOS에서 따로 확인한다.

---

## 12. 설정 항목

| 키 | 기본값 | 설명 |
|---|---|---|
| `gemini.apiKey` | (빈 값) | AI Studio API 키 |
| `gemini.model` | 최신 Flash-Lite ID | `[검증 필요]` |
| `translate.contextSentences` | 2 | 앞뒤 문장 수 |
| `claude.path` | 자동 탐지 | §5.1 |
| `claude.modelNote` | `opus` | 노트 생성 |
| `claude.modelAnswer` | `sonnet` | 메모 답변·채팅 |
| `memo.maxQuestionsPerCall` | 30 | 한 호출의 질문 수 상한 (안전장치) |
| `memo.maxImagesPerCall` | 6 | 한 호출의 이미지 수 상한 |
| `memo.surroundingParagraphs` | 1 | 소속 문단 앞뒤 문단 수 |
| `qa.previousQaChars` | 6000 | 프롬프트에 넣을 이전 질의응답 최대 길이 |
| `chat.idleMinutes` | 15 | 세션 프로세스 유휴 종료 |
| `timeout.memoBaseSec` / `timeout.memoPerQuestionSec` | 60 / 30 | 메모 호출 타임아웃 = 기본 + 질문당, 최대 900초 |
| `timeout.noteSec` | 600 | 노트 생성 |
| `prompts.dir` | Zotero 데이터 디렉터리 하위 | 편집 가능한 프롬프트 위치 |

설정 패널에 "Gemini 연결 테스트"와 "Claude CLI 연결 테스트" 버튼을 둔다. 후자는 짧은 프롬프트로 실행해 경로, 로그인, JSON 파싱을 한 번에 확인하고, `initialize`로 받은 모델 목록을 보여준다.

---

## 13. 마일스톤과 수용 기준

| 단계 | 내용 | 수용 기준 |
|---|---|---|
| M0 | 템플릿 세팅, 설정 패널, 연결 테스트 2종 | 두 테스트가 성공·실패 사유를 정확히 표시. `~/.claude` 설정이 로드되지 않음을 확인 |
| M1 | 문맥 번역 | 선택 → 버튼·단축키 → 번역 표시. 프롬프트 로그에 앞뒤 문장 포함. 매칭 실패 시 "문맥 미포함" |
| M2 | 컨텍스트 노트 (수동 생성) | 우클릭 → 생성, 태그 `claude-context`, 위치 태그에 페이지 포함, 수식 렌더링. 재생성 시 확인 창. 리더를 열지 않은 상태에서도 동작 |
| M3 | 메모 일괄 처리 + 질문 노트 (텍스트 주석) | 사이드바 패널 버튼 → 대기 메모 수집 → 줄 단위로 답을 받는 즉시 질문 노트 덧붙이기 → 메모 `✓`. 출력을 중간에 강제로 끊었을 때 완성된 답은 남고 나머지만 재호출되는지 확인. 노트의 하이라이트 클릭 시 PDF 위치로 이동. 노트 없을 때 지연 생성. 실패 항목은 `@claude`로 남음. **동시 편집 테스트 결과를 사용자에게 보고** |
| M4 | 그림 질문 | 이미지 주석의 `@claude` 질문 → 모델이 그림을 보고 답변 → 질문 노트에 그림 포함 |
| M5 | 사이드바 채팅 | 스트리밍, 세션 재개, 문서 지도 기반 섹션 읽기(경로 밖 읽기 차단 확인), 질문 노트에 저장 |
| M6 | 정리 | 로그, 오류 메시지, 프롬프트 파일 편집 반영 확인 |

## 14. 범위 밖

- 주석 코멘트 자동 감지 (사용자 결정으로 제거)
- 채팅 화면 안의 수식 조판
- 텍스트 레이어 없는 스캔 PDF(OCR)
- 여러 논문을 넘나드는 질문
- 노트 생성 입력에서 참고문헌 목록 제거 (참고문헌 뒤에 부록이 오는 논문이 많아 주의 필요)

## 15. 먼저 확인할 것 (작업 시작 시)

1. 설치된 Zotero 버전과 template의 지원 범위 (`strict_max_version`)
2. 설치된 `claude --help`: §5.3 플래그 존재 여부, 기본 시스템 프롬프트 대체 옵션
3. `Zotero.Fulltext.getPages`와 `.zotero-ft-cache` 형식 (§6.1)
4. 주석 코멘트의 저장 형식 (평문/HTML)
5. 노트 HTML: 스키마 버전, 인라인 수식 형식, 하이라이트 인용 직렬화 API, `data-citation-items` 갱신 필요 여부 (§8)
6. 이미지 주석의 그림 얻는 방법 (§6.4)
7. Gemini 무료 티어 Flash-Lite 모델 ID

## 16. 운영 메모 (사용자용)

- Gemini 무료 티어 요청은 Google 제품 개선에 쓰일 수 있다. 학회 리뷰 원고처럼 기밀 유지 의무가 있는 문서에서는 문맥 번역을 쓰지 않는다. Claude 쪽(Team)은 상업 약관이 적용된다.
- Team 시트는 연구실 조직 계정이므로 조직의 정책과 사용량 집계가 적용된다.
- 사이드바 채팅과 메모 처리는 같은 Claude 구독 사용량을 쓰며, 다른 Claude Code 작업과도 한도를 공유한다.
