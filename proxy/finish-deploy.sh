#!/usr/bin/env bash
# 프록시 배포 마무리 — Vercel 로그인이 되어 있다는 전제 하나로 나머지 전부를 자동화한다:
#   배포 → 프로덕션 URL 획득 → games/shell/config.js의 PROXY_URL 삽입 → 헬스체크 → 커밋·푸시
# 재실행해도 안전하다(멱등): 같은 URL이면 config.js 변경이 없어 커밋이 생기지 않는다.
# 사용법: 레포 루트에서  bash proxy/finish-deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/4 Vercel 프로덕션 배포 =="
URL=$(npx -y vercel deploy --prod --yes 2>&1 | grep -Eo 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)
if [ -z "$URL" ]; then echo "배포 URL을 얻지 못했다 — vercel 출력 확인 필요"; exit 1; fi
echo "   배포됨: $URL"

echo "== 2/4 PROXY_URL 삽입 =="
CFG="../games/shell/config.js"
sed -i "s|PROXY_URL: '[^']*'|PROXY_URL: '$URL'|" "$CFG"
grep -n "PROXY_URL" "$CFG"

echo "== 3/4 헬스체크 =="
# 키를 아직 안 넣었으면 live:false — 정상(클라이언트는 규칙 기반 유지). ok:true만 확인한다.
curl -sf "$URL/api/chat" || { echo "헬스체크 실패"; exit 1; }
echo

echo "== 4/4 커밋·푸시 =="
cd ..
if git diff --quiet games/shell/config.js; then
  echo "   config.js 변경 없음 (이미 같은 URL) — 커밋 생략"
else
  git add games/shell/config.js
  git commit -m "chore(shell): PROXY_URL 삽입 — $URL

프록시 배포 완료에 따라 config.js에 프로덕션 URL을 채운다. ALLOWED의 Pages
오리진은 프록시 코드 기본값에 이미 포함. ANTHROPIC_API_KEY는 별도로
'npx vercel env add ANTHROPIC_API_KEY production' 후 재배포해야 LLM이 켜진다
(전까지는 설계된 규칙 기반 폴백 — proxy/README.md 3절).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
  git push origin SHJ
fi
echo "완료. 다음(선택): cd proxy && npx vercel env add ANTHROPIC_API_KEY production && npx vercel --prod --yes"
