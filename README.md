# cubetimer

3x3 큐브 타이머 웹 앱 (PWA). 아이폰 사파리에서 열고 **공유 → 홈 화면에 추가**하면 앱처럼 쓸 수 있어요. 오프라인에서도 동작하고, 기록은 기기 안에만 저장돼요.

- 길게 눌렀다 떼면 시작, 탭하면 정지 (컴퓨터에서는 스페이스바)
- 대회 방식(랜덤 상태) 3x3 스크램블 + 전개도 그림
- 15초 관찰 시간 (WCA: 15초 초과 +2, 17초 초과 DNF)
- ao5 / ao12 / ao100, 최고 기록, 그래프, 세션
- 기록 내보내기 / 가져오기 (csTimer 백업도 가져오기 가능)

## 컴퓨터용

`/pc/` (https://dbsxo1.github.io/cubetimer/pc/) — csTimer식 화면. 스페이스바 타이머, time/mo3/ao5/ao12 표, 단축키(Ctrl+1/2/3/Z, Esc), 직접 입력, 통계·분포, 라이트/다크. 같은 브라우저에서는 폰 버전과 기록을 공유하고, 기기끼리는 내보내기/가져오기로 옮겨요.

업데이트할 때는 `sw.js`의 `CACHE` 버전과 `app.js`의 `VERSION`을 올려야 기기에 새 버전이 반영돼요.

스크램블 생성: [cubejs](https://github.com/ldez/cubejs) (MIT, `vendor/cubejs/LICENSE`)
