# AetherAI 생성 이미지를 배포 크기로 줄인다. aether-gen.js 다음에 한 번 돌린다.
#
# 왜 필요한가: 생성물은 1024~1536px 원본이라 바탕화면 하나가 1.1MB다. 배포 payload에는
# 예산 가드(selftest.html)가 있고, 제출 요건이 "링크 클릭만으로 바로 플레이"다.
# 화면 실사용 크기는 바탕화면 ~1000x340 · 아이콘 56px · 몬스터 ≤134px · VFX 프레임 ~170px.
#
# 포맷 규칙:
#   바탕화면·VFX → JPEG (알파 불필요 — VFX는 검은 배경 시트를 'screen' 블렌드로 얹는다)
#   아이콘·몬스터 → PNG (또렷한 가장자리·알파 필요)
#   몬스터는 저장 전 마젠타 크로마키를 거친다 (아래 Chroma 클래스 주석 참고)
#
# 사용: powershell -ExecutionPolicy Bypass -File tools/optimize-images.ps1
#      (원본을 덮어쓰므로, 다시 뽑고 싶으면 aether-gen.js --force)

Add-Type -AssemblyName System.Drawing

# 마젠타 크로마키 — 몬스터 스프라이트용. 생성 모델이 "투명 배경" 지시를 무시하고
# 발광 배경을 깔았다(me-fire 1차 실측). 그래서 프롬프트를 "순수 마젠타 단색 배경"으로
# 바꾸고 여기서 키잉한다. PS 픽셀 루프는 분 단위로 느려서 C#으로 컴파일해 돌린다.
# 디스필(excess = min(R,B) − G)은 주황/파랑/초록 팔레트의 본색을 건드리지 않는다 —
# 세 색 모두 excess ≤ 0 이거나 미미하다. 보라 몬스터가 생기면 재검토할 것.
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class Chroma {
  public static void KeyMagenta(Bitmap bmp) {
    var r = new Rectangle(0, 0, bmp.Width, bmp.Height);
    var d = bmp.LockBits(r, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    int n = Math.Abs(d.Stride) * bmp.Height;
    byte[] px = new byte[n];
    Marshal.Copy(d.Scan0, px, 0, n);
    for (int i = 0; i < n; i += 4) {
      int B = px[i], G = px[i + 1], R = px[i + 2];
      double dist = Math.Sqrt((R - 255) * (R - 255) + (double)G * G + (B - 255) * (B - 255));
      double a = (dist - 70.0) / 90.0;              // 70 이내 = 배경, 160 밖 = 전경
      if (a < 0) a = 0; if (a > 1) a = 1;
      if (a < 1.0) {
        int excess = Math.Min(R, B) - G;            // 반투명 가장자리의 마젠타 번짐 제거
        if (excess > 0) { R -= excess; B -= excess; px[i + 2] = (byte)R; px[i] = (byte)B; }
      }
      px[i + 3] = (byte)(px[i + 3] * a);
    }
    Marshal.Copy(px, 0, d.Scan0, n);
    bmp.UnlockBits(d);
  }
  // VFX 시트용 — 생성 모델이 "검은 배경" 지시를 무시하고 흰 배경으로 준다(실측).
  // 흰색일수록 투명(a = 1 − min(R,G,B)/255)으로 보고 검정 위에 눕힌다: out = C × a.
  // 게임이 'screen' 블렌드로 얹으므로 검정은 0 기여 — 결과적으로 이펙트 선만 떠오른다.
  public static void WhiteToBlack(Bitmap bmp) {
    var r = new Rectangle(0, 0, bmp.Width, bmp.Height);
    var d = bmp.LockBits(r, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    int n = Math.Abs(d.Stride) * bmp.Height;
    byte[] px = new byte[n];
    Marshal.Copy(d.Scan0, px, 0, n);
    for (int i = 0; i < n; i += 4) {
      int B = px[i], G = px[i + 1], R = px[i + 2];
      double a = 1.0 - Math.Min(R, Math.Min(G, B)) / 255.0;
      a = Math.Min(1.0, a * 1.25);              // 얇은 선이 죽지 않게 살짝 증폭
      px[i]     = (byte)(B * a);
      px[i + 1] = (byte)(G * a);
      px[i + 2] = (byte)(R * a);
      px[i + 3] = 255;
    }
    Marshal.Copy(px, 0, d.Scan0, n);
    bmp.UnlockBits(d);
  }
}
'@

$root = Join-Path $PSScriptRoot ".."

function Resize-Image {
  param([string]$Src, [string]$Dst, [int]$W, [int]$H, [string]$Fmt, [int]$Quality = 80, [bool]$Key = $false, [bool]$WhiteKey = $false)

  # 주의: 파라미터가 [string]$Src 이고 PowerShell은 변수명 대소문자를 구분하지 않는다.
  # $src 에 Image를 대입하면 선언 타입에 맞춰 문자열로 변환된다. 반드시 다른 이름을 쓸 것.
  $orig = [System.Drawing.Image]::FromFile($Src)
  # 비율 유지 cover. 소스가 전부 정사각(1024/1536x1024 → 목표와 동일 비율)이라 잘림 없음 —
  # 비율이 다른 소스를 추가하면 몬스터는 contain으로 바꿀 것 (cover는 머리를 자른다).
  $scale = [Math]::Max($W / $orig.Width, $H / $orig.Height)
  $sw = [int][Math]::Round($orig.Width * $scale)
  $sh = [int][Math]::Round($orig.Height * $scale)
  $ox = [int](($W - $sw) / 2)
  $oy = [int](($H - $sh) / 2)

  $bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($orig, $ox, $oy, $sw, $sh)

  # 키잉은 축소 후에 한다 — 원본(1024²)보다 25배 적은 픽셀이고, 축소 보간이 만든
  # 마젠타 반투명 띠까지 같은 패스에서 디스필된다.
  if ($Key) { [Chroma]::KeyMagenta($bmp) }
  if ($WhiteKey) { [Chroma]::WhiteToBlack($bmp) }

  if ($Fmt -eq 'jpg') {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
      [System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
    # JPEG는 알파가 없다 — 투명 배경이 검게 나오지 않도록 셸 배경색을 깔아준다.
    # (VFX는 어차피 검은 배경 시트라 영향 없음)
    $flat = New-Object System.Drawing.Bitmap($W, $H)
    $fg = [System.Drawing.Graphics]::FromImage($flat)
    $fg.Clear([System.Drawing.ColorTranslator]::FromHtml('#0b0910'))
    $fg.DrawImage($bmp, 0, 0)
    $flat.Save($Dst, $codec, $ep)
    $fg.Dispose(); $flat.Dispose()
  } else {
    $bmp.Save($Dst, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $g.Dispose(); $bmp.Dispose(); $orig.Dispose()
}

$jobs = @(
  # ── 셸 (데스크탑 허브) ──
  @{ Dir = 'games\shell\img'; In = 'desktop-wallpaper.png'; Out = 'desktop-wallpaper.jpg'; W = 1280; H = 480; Fmt = 'jpg'; Q = 78 },
  @{ Dir = 'games\shell\img'; In = 'icon-hwaryeok.png';  Out = 'icon-hwaryeok.png';  W = 96; H = 96; Fmt = 'png' },
  @{ Dir = 'games\shell\img'; In = 'icon-giving-up.png'; Out = 'icon-giving-up.png'; W = 96; H = 96; Fmt = 'png' },
  @{ Dir = 'games\shell\img'; In = 'icon-pocket.png';    Out = 'icon-pocket.png';    W = 96; H = 96; Fmt = 'png' },
  @{ Dir = 'games\shell\img'; In = 'icon-fishing.png';   Out = 'icon-fishing.png';   W = 96; H = 96; Fmt = 'png' },
  @{ Dir = 'games\shell\img'; In = 'icon-bomb.png';      Out = 'icon-bomb.png';      W = 96; H = 96; Fmt = 'png' },
  # ── 상점 (데스크탑 앱 아이콘 + 상품 아이콘 — 표시 56px) ──
  @{ Dir = 'games\shell\img'; In = 'icon-shop.png';      Out = 'icon-shop.png';      W = 96; H = 96; Fmt = 'png' },
  @{ Dir = 'games\shell\img'; In = 'shop-camgold.png';   Out = 'shop-camgold.png';   W = 96; H = 96; Fmt = 'png' },
  @{ Dir = 'games\shell\img'; In = 'shop-neonsign.png';  Out = 'shop-neonsign.png';  W = 96; H = 96; Fmt = 'png' },
  @{ Dir = 'games\shell\img'; In = 'shop-fanfare.png';   Out = 'shop-fanfare.png';   W = 96; H = 96; Fmt = 'png' },
  @{ Dir = 'games\shell\img'; In = 'shop-tallyplat.png'; Out = 'shop-tallyplat.png'; W = 96; H = 96; Fmt = 'png' },
  @{ Dir = 'games\shell\img'; In = 'shop-holobadge.png'; Out = 'shop-holobadge.png'; W = 96; H = 96; Fmt = 'png' },
  # ── 주머니 괴수: 몬스터 (마젠타 키잉 → 알파 PNG). 화면 최대 134px → 192px이면 레티나까지 충분 ──
  @{ Dir = 'games\pocket\img'; In = 'me-fire.png';   Out = 'me-fire.png';   W = 192; H = 192; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\pocket\img'; In = 'me-water.png';  Out = 'me-water.png';  W = 192; H = 192; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\pocket\img'; In = 'me-grass.png';  Out = 'me-grass.png';  W = 192; H = 192; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\pocket\img'; In = 'foe-fire.png';  Out = 'foe-fire.png';  W = 192; H = 192; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\pocket\img'; In = 'foe-water.png'; Out = 'foe-water.png'; W = 192; H = 192; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\pocket\img'; In = 'foe-grass.png'; Out = 'foe-grass.png'; W = 192; H = 192; Fmt = 'png'; Key = $true },
  # ── 주머니 괴수: VFX 4x4 시트 (검은 배경 → 'screen' 블렌드라 JPEG로 충분) ──
  @{ Dir = 'games\pocket\img'; In = 'vfx-tackle.png';    Out = 'vfx-tackle.jpg';    W = 512; H = 512; Fmt = 'jpg'; Q = 80; WhiteKey = $true },
  @{ Dir = 'games\pocket\img'; In = 'vfx-fire.png';      Out = 'vfx-fire.jpg';      W = 512; H = 512; Fmt = 'jpg'; Q = 80; WhiteKey = $true },
  @{ Dir = 'games\pocket\img'; In = 'vfx-water.png';     Out = 'vfx-water.jpg';     W = 512; H = 512; Fmt = 'jpg'; Q = 80; WhiteKey = $true },
  @{ Dir = 'games\pocket\img'; In = 'vfx-grass.png';     Out = 'vfx-grass.jpg';     W = 512; H = 512; Fmt = 'jpg'; Q = 80; WhiteKey = $true },
  @{ Dir = 'games\pocket\img'; In = 'vfx-ult-fire.png';  Out = 'vfx-ult-fire.jpg';  W = 512; H = 512; Fmt = 'jpg'; Q = 80; WhiteKey = $true },
  @{ Dir = 'games\pocket\img'; In = 'vfx-ult-water.png'; Out = 'vfx-ult-water.jpg'; W = 512; H = 512; Fmt = 'jpg'; Q = 80; WhiteKey = $true },
  @{ Dir = 'games\pocket\img'; In = 'vfx-ult-grass.png'; Out = 'vfx-ult-grass.jpg'; W = 512; H = 512; Fmt = 'jpg'; Q = 80; WhiteKey = $true },
  # ── 스트리머 캠 얼굴 (AetherAI 초상 — 어두운 배경 포함이라 키잉 불필요). 표시 74px → 148px 레티나 ──
  @{ Dir = 'games\shell\faces'; In = 'adventurer_silence.png';   Out = 'adventurer_silence.png';   W = 148; H = 148; Fmt = 'png' },
  @{ Dir = 'games\shell\faces'; In = 'adventurer_surprise.png';  Out = 'adventurer_surprise.png';  W = 148; H = 148; Fmt = 'png' },
  @{ Dir = 'games\shell\faces'; In = 'adventurer_panic.png';     Out = 'adventurer_panic.png';     W = 148; H = 148; Fmt = 'png' },
  @{ Dir = 'games\shell\faces'; In = 'adventurer_aha.png';       Out = 'adventurer_aha.png';       W = 148; H = 148; Fmt = 'png' },
  @{ Dir = 'games\shell\faces'; In = 'adventurer_confusion.png'; Out = 'adventurer_confusion.png'; W = 148; H = 148; Fmt = 'png' },
  @{ Dir = 'games\shell\faces'; In = 'adventurer_thinking.png';  Out = 'adventurer_thinking.png';  W = 148; H = 148; Fmt = 'png' },
  @{ Dir = 'games\shell\faces'; In = 'adventurer_question.png';  Out = 'adventurer_question.png';  W = 148; H = 148; Fmt = 'png' },
  # ── 배경 플레이트 (알파 불필요 → JPEG). 표시 영역 비율로 크롭 ──
  @{ Dir = 'games\hwaryeok\img'; In = 'studio-bg.png'; Out = 'studio-bg.jpg'; W = 1280; H = 380; Fmt = 'jpg'; Q = 76 },
  @{ Dir = 'games\pocket\img';   In = 'arena-bg.png';  Out = 'arena-bg.jpg';  W = 1280; H = 574; Fmt = 'jpg'; Q = 76 },
  # ── 액터 (마젠타 키잉 → 알파 PNG) ──
  @{ Dir = 'games\hwaryeok\img';  In = 'pan.png';    Out = 'pan.png';    W = 192; H = 192; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\hwaryeok\img';  In = 'cloche.png'; Out = 'cloche.png'; W = 192; H = 192; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\giving-up\img'; In = 'pot.png';    Out = 'pot.png';    W = 128; H = 128; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\giving-up\img'; In = 'hammer.png'; Out = 'hammer.png'; W = 96;  H = 96;  Fmt = 'png'; Key = $true },
  # ── 심연낚시 (배경 플레이트 + 배 + 어종 5티어 + 물보라 시트) ──
  @{ Dir = 'games\fishing\img'; In = 'sea-bg.png';     Out = 'sea-bg.jpg';     W = 1280; H = 574; Fmt = 'jpg'; Q = 76 },
  @{ Dir = 'games\giving-up\img'; In = 'sky-bg.png';   Out = 'sky-bg.jpg';     W = 1280; H = 574; Fmt = 'jpg'; Q = 76 },
  @{ Dir = 'games\fishing\img'; In = 'boat.png';       Out = 'boat.png';       W = 256; H = 256; Fmt = 'png'; Key = $true },
  # 어종은 화면 크기(r×3.8 = 34~152px)에 맞춰 티어별로 다르게 줄인다 — 전설만 크다
  @{ Dir = 'games\fishing\img'; In = 'fish-0.png';     Out = 'fish-0.png';     W = 96;  H = 96;  Fmt = 'png'; Key = $true },
  @{ Dir = 'games\fishing\img'; In = 'fish-1.png';     Out = 'fish-1.png';     W = 128; H = 128; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\fishing\img'; In = 'fish-2.png';     Out = 'fish-2.png';     W = 160; H = 160; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\fishing\img'; In = 'fish-3.png';     Out = 'fish-3.png';     W = 224; H = 224; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\fishing\img'; In = 'fish-4.png';     Out = 'fish-4.png';     W = 320; H = 320; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\fishing\img'; In = 'vfx-splash.png'; Out = 'vfx-splash.jpg'; W = 512; H = 512; Fmt = 'jpg'; Q = 80; WhiteKey = $true },
  # ── 해체쇼 (배경 플레이트 + 폭탄 몸통 + 폭발 시트) ──
  @{ Dir = 'games\bomb\img'; In = 'bench-bg.png';  Out = 'bench-bg.jpg';  W = 1280; H = 574; Fmt = 'jpg'; Q = 76 },
  @{ Dir = 'games\bomb\img'; In = 'bomb-body.png'; Out = 'bomb-body.png'; W = 512; H = 512; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\bomb\img'; In = 'vfx-boom.png';  Out = 'vfx-boom.jpg';  W = 512; H = 512; Fmt = 'jpg'; Q = 80; WhiteKey = $true },
  # ── UI 크롬 아이콘 (마젠타 키잉 → 알파 PNG). 표시 12~15px → 64px이면 충분 ──
  @{ Dir = 'games\shell\img'; In = 'ui-logo.png';  Out = 'ui-logo.png';  W = 64; H = 64; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\shell\img'; In = 'ui-chat.png';  Out = 'ui-chat.png';  W = 64; H = 64; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\shell\img'; In = 'ui-obs.png';   Out = 'ui-obs.png';   W = 64; H = 64; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\shell\img'; In = 'ui-sound.png'; Out = 'ui-sound.png'; W = 64; H = 64; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\shell\img'; In = 'ui-net.png';   Out = 'ui-net.png';   W = 64; H = 64; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\shell\img'; In = 'ui-eye.png';   Out = 'ui-eye.png';   W = 64; H = 64; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\shell\img'; In = 'ui-heart.png'; Out = 'ui-heart.png'; W = 64; H = 64; Fmt = 'png'; Key = $true },
  # ── UI 면 텍스처 (배경은 JPEG 크롭 밴드, 버튼 플레이트는 키잉 PNG) ──
  @{ Dir = 'games\shell\img'; In = 'ui-titlebar.png'; Out = 'ui-titlebar.jpg'; W = 512; H = 96;  Fmt = 'jpg'; Q = 76 },
  @{ Dir = 'games\shell\img'; In = 'ui-taskbar.png';  Out = 'ui-taskbar.jpg';  W = 512; H = 96;  Fmt = 'jpg'; Q = 76 },
  @{ Dir = 'games\shell\img'; In = 'ui-panelbg.png';  Out = 'ui-panelbg.jpg';  W = 512; H = 512; Fmt = 'jpg'; Q = 74 },
  @{ Dir = 'games\shell\img'; In = 'ui-button.png';   Out = 'ui-button.png';   W = 256; H = 256; Fmt = 'png'; Key = $true },
  @{ Dir = 'games\shell\img'; In = 'ui-coin.png';     Out = 'ui-coin.png';     W = 64;  H = 64;  Fmt = 'png'; Key = $true }
)

$total = 0
foreach ($j in $jobs) {
  $dir = Join-Path $root $j.Dir
  $src = Join-Path $dir $j.In
  $dst = Join-Path $dir $j.Out
  if (-not (Test-Path $src)) {
    # 이미 최적화돼 원본이 다른 확장자로 남은 경우는 조용히 합계만 잡는다
    if (Test-Path $dst) { $total += (Get-Item $dst).Length } else { Write-Host ("건너뜀  {0} (없음)" -f $j.In) }
    continue
  }
  $before = (Get-Item $src).Length
  # 재실행 가드 — In=Out 잡의 원본이 이미 목표 크기 이하면 처리 끝난 최종본이다 (트림돼 더 작을
  # 수도 있다). 여기서 또 cover-리사이즈하면 업스케일+크롭으로 최종본을 망친다 (2026-08-08 실측
  # — 전체 재실행이 기존 몬스터·액터를 재크롭해 git checkout으로 복원했다).
  if ($j.In -eq $j.Out) {
    $probe = [System.Drawing.Image]::FromFile($src)
    $small = ($probe.Width -le $j.W -and $probe.Height -le $j.H); $probe.Dispose()
    if ($small) { $total += $before; Write-Host ("유지    {0} (이미 최적화)" -f $j.Out); continue }
  }
  $tmp = Join-Path $dir ("_tmp_" + $j.Out)
  # PowerShell 5.1에는 ?? 가 없다 — 파서 오류가 난다
  $q = if ($j.ContainsKey('Q')) { $j.Q } else { 80 }
  $key = if ($j.ContainsKey('Key')) { $j.Key } else { $false }
  $wkey = if ($j.ContainsKey('WhiteKey')) { $j.WhiteKey } else { $false }
  # 변환이 실패했는데도 원본을 지우거나 "줄었다"고 출력하면 안 된다 (실제로 그런 적 있음)
  try { Resize-Image -Src $src -Dst $tmp -W $j.W -H $j.H -Fmt $j.Fmt -Quality $q -Key $key -WhiteKey $wkey }
  catch {
    Write-Host ("실패    {0} — {1}" -f $j.In, $_.Exception.Message)
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    continue
  }
  if ($j.In -ne $j.Out) { Remove-Item $src -Force }
  Move-Item $tmp $dst -Force
  $after = (Get-Item $dst).Length
  $total += $after
  Write-Host ("{0,-24} {1,7:N0}KB -> {2,6:N0}KB  ({3}x{4}{5})" -f $j.Out, ($before/1KB), ($after/1KB), $j.W, $j.H, $(if ($key) { ' 키잉' } else { '' }))
}
Write-Host ("`n이미지 합계 {0:N0}KB — selftest.html 의 payload 예산에 포함시킬 것." -f ($total/1KB))
