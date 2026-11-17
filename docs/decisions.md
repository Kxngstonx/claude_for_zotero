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
