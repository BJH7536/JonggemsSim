/* 배포 설정 — 심사 배포에서 채울 것은 PROXY_URL 하나다.
 *
 * PROXY_URL이 비어 있으면 AI 시청자는 완전 오프라인 규칙 기반 모드로 동작한다.
 * 이것은 기능 저하가 아니라 설계된 폴백이다 — 프록시가 죽어도, 키가 소진되어도,
 * 네트워크가 없어도 방송은 똑같이 돌아간다 (proxy/README.md 3절).
 *
 * 채우는 법: proxy/README.md 절차대로 Vercel에 배포한 뒤 나온 URL을 붙여넣는다.
 *   예: PROXY_URL: 'https://jonggems-proxy.vercel.app'
 * 프록시 쪽 ALLOWED_ORIGINS에 이 페이지의 오리진(https://bjh7536.github.io)이
 * 포함되어 있어야 한다 — 기본값에 이미 들어 있다.
 */
window.JONGGEMS_CONFIG = {
  PROXY_URL: 'https://proxy-pi-taupe.vercel.app',
};
