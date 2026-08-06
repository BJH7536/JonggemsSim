# 프로토타입 공통 규약 — AI 관람객 10종

> 대상: `../10-ideas.md`의 아이디어 10개를 각각 단일 HTML 파일로 프로토타이핑.
> 이 문서는 10개 파일이 공유하는 기술 규약이다. 게임별 사양은 `10-ideas.md`의 해당 항목이 진실.

## 파일 규약

- **단일 HTML 파일** — 인라인 `<style>`·`<script>`, 외부 리소스·CDN·네트워크 요청 금지.
  `file://`로 열어도 동작해야 한다.
- 언어: UI·발화 전부 한국어. 코드 식별자는 영어.
- 분량 목표: 400~700줄. 프로토타입이다 — 코어 루프 1회전의 완결이 목표이지 완성도가 아니다.
- localStorage 키 접두사: `aispec-proto-{NN}-` (게임 번호 2자리). 판간 기억이 필요한 게임만 사용.
- 파일 하단에 주석으로 원본 아이디어 번호·제목을 남긴다.

## AI 관람객 목업 (전 게임 공통)

실제 제품에서는 LLM API 호출이 될 부분을 로컬 목업으로 대체한다. 단, **10-ideas.md 공통
원칙의 구조는 목업에서도 그대로 지킨다**:

1. **검증 게이트**: 룰이 넘긴 사실 슬롯(수치·좌표·턴 번호)이 발화 본문에 실제 포함됐는지 검사
2. **비반복성**: 직전 N회 발화와의 유사도 상한 — 같은 템플릿이 연속되지 않도록 무드별 템플릿을 6개 이상 준비
3. **비동기**: 호출 지연(300~900ms)을 시뮬레이션. 조작 타이밍과 분리된 시점에만 발화 도착
4. **실패 처리**: 검증 재실패 시 발화 폐기 — C1-약 게임은 게이지 미커밋(6번은 이월), C1-강 게임은 발화 불채택
5. LLM 교체 지점에 `// [LLM-INTEGRATION-POINT]` 주석 명시
6. 화면에 `AI 관람객 — 로컬 시뮬레이션` 배지를 표시 (목업임을 정직하게 라벨링)

### 참조 구현 (복사해 게임에 맞게 변형)

```js
// [LLM-INTEGRATION-POINT] generate()가 실제 LLM 호출로 교체된다.
const Spectator = {
  history: [], N: 3, SIM_MAX: 0.72,
  async speak(facts, mood, templates) {
    await new Promise(r => setTimeout(r, 300 + Math.random() * 600)); // 호출 지연 시뮬레이션
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = this.generate(facts, mood, templates);
      if (this.verify(text, facts)) {
        this.history.push(text);
        if (this.history.length > 8) this.history.shift();
        return { ok: true, text };
      }
    }
    return { ok: false, text: null }; // 폐기 — 호출부가 미커밋/이월 처리
  },
  generate(facts, mood, templates) {
    const pool = templates[mood] || templates.default;
    const t = pool[Math.floor(Math.random() * pool.length)];
    return t.replace(/\{(\w+)\}/g, (_, k) => String(facts[k] ?? ''));
  },
  verify(text, facts) {
    const factsIn = Object.values(facts).every(v => text.includes(String(v)));
    const sim = (a, b) => {
      const A = new Set(a.split(/\s+/)), B = new Set(b.split(/\s+/));
      let i = 0; A.forEach(w => B.has(w) && i++);
      return i / Math.max(A.size, B.size);
    };
    const fresh = this.history.slice(-this.N).every(h => sim(text, h) < this.SIM_MAX);
    return factsIn && fresh;
  }
};
```

- 템플릿의 `{slot}`은 facts 키와 일치해야 검증을 통과한다 (모든 fact 값이 본문에 포함될 것).
- C1-강 게임(4·7·8·9·10)의 "LLM 결정"(베팅 방향, 앙코르 선택, 별명, 순위 배분, 클라이맥스
  지목)도 목업으로: 휴리스틱 + 변동성으로 흉내 내되, 결정 자체가 룰과 분리된 함수로 존재해야
  하고 그 함수에 `[LLM-INTEGRATION-POINT]`를 단다.

## UI 공통

- 다크 배경 + 게임별 포인트 색 1개. 시스템 폰트. 캔버스 또는 DOM 자유.
- 상단: 게임 제목 + 한 줄 컨셉 + `AI 관람객 — 로컬 시뮬레이션` 배지
- 발화 표시 영역(말풍선 또는 피드)은 항상 보이게 — 이 게임들의 주인공은 관람객의 목소리다
- 조작법을 화면에 상시 또는 시작 화면에 표시
- 다시 시작 버튼
- **3분 데모 완결**: 심사위원이 열어서 3분 안에 코어 루프 1회전(플레이 → 관람객 반응 →
  보상/변화 → 다시 플레이)을 체감할 수 있어야 한다. 방치·오프라인류(2·9)는 시간 배속
  버튼 필수.

## 하지 말 것

- git 커밋 (절대 금지 — 세션 제약)
- 이 디렉터리 밖 파일 수정
- 외부 라이브러리·폰트·이미지 로드 (이모지·CSS·캔버스 드로잉으로 해결)
- 관람객이 난이도·규칙·상대를 조작하는 구현 (C3 위반 — 10-ideas.md 공통 원칙)
