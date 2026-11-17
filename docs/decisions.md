# 설계 변경 기록

`context.md`와 다르게 구현한 점을 한 줄씩 남긴다. 근거는 설치본에서 직접 확인한 것이다.

| 날짜 | 단계 | context.md | 변경 | 근거 |
|---|---|---|---|---|
| 2026-11-17 | M0 | §5.3 단발 호출에 `--append-system-prompt-file` (대체 옵션은 `[검증 필요]`) | 단발 호출은 `--system-prompt-file`(기본 프롬프트 대체) + `--tools ""` + `--no-session-persistence` + `--disable-slash-commands` | claude 2.1.326 `--help`. `system/init` 이벤트에서 tools·mcp_servers·skills·slash_commands가 모두 빈 배열임을 확인 |
| 2026-11-17 | M0 | §5.3 cwd는 호출마다 `runs/<id>/` | 단발 호출은 고정 디렉터리 `runs/oneshot/` 하나를 쓴다 (직렬 큐라 충돌 없음) | cwd마다 `~/.claude/projects/<cwd>/memory/`가 새로 생긴다. 호출마다 다른 cwd를 쓰면 그 아래에 항목이 계속 쌓인다 |
| 2026-11-17 | M0 | §5.3 오류 구분 | 오류는 `result.is_error`로 판정하고 종류는 assistant 이벤트의 `error` 필드(`model_not_found`, `authentication_failed`, `rate_limit` …)로 구분. 문서화된 문구와 `rate_limit_event.status == "rejected"`를 보조로 쓴다 | 잘못된 모델로 실측: `subtype:"success"`, `is_error:true`, `api_error_status:404`, assistant `error:"model_not_found"` |
| 2026-11-17 | M0 | §2 배포: 공개하지 않음 | manifest `update_url`을 `https://localhost/…`로 둔다. scaffold의 manifest 생성 단계는 끈다 | Zotero 10은 `update_url`이 없으면 설치를 거부한다. scaffold가 GitHub 주소를 넣지 못하게 막고, 외부로 나가는 업데이트 확인도 없앤다. `package.json`의 `repository`는 scaffold가 요구하는 자리 표시용 값이다 |
| 2026-11-17 | M0 | §4 프롬프트 기본본 포함 | 원본은 `prompts/`·`vendor/`에 두고, 빌드 전에 `scripts/sync-prompts.mjs`로 `addon/content/prompts/`에 복사한다(git 제외). 사용자 폴더에는 처음 한 번만 복사하고 덮어쓰지 않는다 | 원본 위치를 유지한다(계획서). 빌드의 asset glob이 확장자 없는 파일을 건너뛰므로 `LICENSE`는 `LICENSE.txt`로 복사한다 |
| 2026-11-17 | M0 | §7·§12 `gemini.model` | 기본값 `gemini-3.5-flash-lite` | AI Studio 모델·가격 문서(2026-11) 기준 무료 티어 Flash-Lite 최신 안정판. 연결 테스트가 `GET models/{model}`로 확인한다 |
| 2026-11-17 | M1 | §6.2 하이라이트 위치는 텍스트 매칭(공백·줄끝 하이픈 제거) | 선택 영역은 리더의 `view._selectionRanges`(페이지 문자 배열의 `anchorOffset`/`headOffset`)로 정확히 찾는다. 텍스트 매칭(공백·하이픈·합자 무시)은 그 값이 없을 때의 폴백이다 | Zotero 10.0.9 `reader.js`의 `getRange`가 문자 오프셋을 반환함. 실제 리더로 두 경로를 모두 테스트(`test/zotero/m1.test.ts`) |
| 2026-11-17 | M1 | §7 문장 경계는 문자 데이터 사용 | 문단 경계(`paragraphBreakAfter`)는 문자 데이터로, 문장 경계는 `Intl.Segmenter`에 학술 약어(Fig., Eq., e.g., et al. …)·이니셜 병합 규칙을 더해 자른다 | 문자 데이터에는 문장 경계 플래그가 없다. 약어 병합 때문에 "Appendix A." 같은 문장 끝이 다음 문장과 합쳐질 수 있지만, 문맥이 조금 길어질 뿐이다 |
| 2026-11-17 | M1 | §7 단축키 (키 미지정) | `Ctrl+Shift+T`. 선택 팝업이 떠 있고 그 리더 탭이 선택된 탭일 때만 동작한다. `ev.code`로 비교해 자판 배열과 무관하다 | macOS에서 Ctrl 조합은 Zotero 단축키와 거의 겹치지 않는다 |
| 2026-11-17 | M1 | — | 번역 캐시 키에 프롬프트 본문을 포함하고 최대 200개로 제한한다 | `translate.md`를 고치면 같은 선택도 다시 번역된다 |
| 2026-11-17 | M2 | §6.1 1순위 전문 캐시(`Zotero.Fulltext.getPages`와 `\f` 조각 수 비교), 2순위 리더 | 1순위는 같지만 `getPages`는 `{indexedPages, total}`만 준다. `indexedPages == total`, `\f` 조각 수 == `total`, 캐시가 PDF보다 새것일 때만 쓴다. 2순위는 리더 대신 `Zotero.PDFWorker.getFullText(id, null)`(리더 없이 전체 페이지, 같은 `\f` 형식) | 이 라이브러리의 PDF 캐시 7개에 `\f`가 없음(동기화 텍스트로 추정). 리더를 열지 않아야 한다(M2 수용 기준) |
| 2026-11-17 | M2 | §6.1 `=== Page N ===` | N은 PDF의 물리적 페이지 번호(1부터)다. 인쇄 페이지 라벨이 아니다 | 전문 추출 결과에는 페이지 라벨이 없다. 노트의 `p.N`은 리더의 페이지 이동 번호와 맞지만 저널 인쇄 쪽수와는 다를 수 있다 |
| 2026-11-17 | M2 | §8.1 마크다운→HTML 안전 변환 | 정해진 요소(문단·제목·목록·인용·코드·수식·표·링크·hr·강조)로만 트리를 만들고 직렬화할 때 모든 텍스트·속성을 이스케이프한다. DOM 없이 동작하므로 Node에서 단위 테스트한다 | 표·hr은 컨텍스트 노트 부록(Notation, Section Map)에 쓰이고, Zotero 노트 편집기 스키마가 지원한다 |
| 2026-11-17 | M2 | §8.2 첫머리에 메타 한 줄 | `<h1>Claude 컨텍스트 노트 — {짧은 제목}</h1>` 다음에 메타 한 줄. 모델 출력의 제목은 한 단계씩 내린다 | 노트 목록에서 첫 줄이 노트 제목으로 보이므로 h1을 둔다 |
| 2026-11-17 | M2 | — | 같은 논문의 생성이 진행 중일 때 지연 생성 요청은 그 작업을 기다리고, 재생성 요청은 끝난 뒤 다시 생성한다. 편집 권한 없는 라이브러리에서는 메뉴를 비활성화한다. 생성 중 기존 노트가 휴지통으로 가면 새 노트로 저장한다 | 코드 리뷰 반영 |
| 2026-11-17 | M2 | `prompts/context-note.md` v1 | v1.1: Rule 8 추가 — 본문·목록·표·부록의 수식 기호도 모두 `$…$`/`$$…$$`로 쓴다 | 사용자 테스트: 본문의 `v_u^U` 등이 렌더링되지 않음. 원인은 모델이 `$` 없이 평문으로 쓴 것(실제 노트: 인라인 수식 1개, 디스플레이 13개). v1.1로 수식 기호가 많은 본문을 실측: 인라인 45개, 구분자 없는 수식 0개 |
| 2026-11-17 | M2 | §4 사용자 프롬프트 폴더(덮어쓰지 않음) | 사용자 사본이 이전 기본본과 바이트 단위로 같으면(=고치지 않았으면) 새 기본본으로 교체한다. 고친 사본은 그대로 둔다. 빌드 때 git 이력의 모든 기본본 md5를 `known-defaults.json`에 기록한다 | 프롬프트 개선이 사용자에게 전달되지 않는 문제. 사용자의 편집은 보존한다 |
| 2026-11-17 | M2 | — | 메뉴 `setL10nArgs`에 JSON 문자열을 넘긴다 | `MenuManager`가 인자를 그대로 `data-l10n-args`에 쓰기 때문. 객체를 넘기면 "[object Object]"가 되어 항상 "생성"으로 표시됐다(사용자 테스트에서 발견, 실제 메뉴를 여는 테스트 추가) |
| 2026-11-17 | M3 | §6.2 하이라이트 위치 = 텍스트 매칭 | 주석의 `position.rects`로 문자 범위를 찾는다(리더의 `getRangeByHighlight`와 같은 규칙: 첫 rect 안의 첫 문자 ~ 마지막 rect 안의 마지막 문자). 실패하면 같은 페이지에서 텍스트 매칭, 그것도 실패하면 ±800자 + "문맥 근사" | 같은 문장이 여러 번 나와도 정확하다. 리더가 열려 있지 않으면 백그라운드 탭으로 열고, 처리 후 직접 연 탭은 닫는다 |
| 2026-11-17 | M3 | §8.3 질문 노트 항목 형식 | `<hr/>` → Zotero가 만든 하이라이트+인용(`serializeAnnotations`, 코멘트 제외) → `Q.` 질문 → 답변 → 메타 한 줄(`<em>`). 인용 데이터는 인라인에 포함(itemData 포함)하므로 루트 `data-citation-items`를 갱신하지 않는다 | §8.3의 `[검증 필요]` 해소. 하이라이트를 클릭하면 PDF 위치로 이동한다(`data-annotation`에 attachmentURI와 annotationKey) |
| 2026-11-17 | M3 | §9.2 결과 요약 | 답변은 저장했지만 메모 줄이 바뀌어 ✓를 달지 못한 경우는 "실패"가 아니라 "확인 필요"로 따로 보여준다. 재호출 중 한도·로그인 오류가 나면 남은 호출도 중단한다 | 코드 리뷰 반영. 다시 실행하면 그 질문은 재질문으로 기록된다 |
| 2026-11-17 | M3 | §9.3 사용자 메시지 | 질문·하이라이트·주변 문단·노트 안의 `<question>`, `</q>` 같은 우리 구조 태그만 무력화(`&lt;`)한다. 다른 `<`(수식 등)는 그대로 둔다 | 논문 텍스트가 프롬프트 구조를 깨지 않게 한다 |
| 2026-11-17 | M3 | — | 그림(이미지) 주석의 `@claude` 질문은 M3에서 건너뛰고 개수만 표시한다 | M4 범위 |
