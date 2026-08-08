# AetherAI 생성 이미지를 배포 크기로 줄인다. aether-gen.js 다음에 한 번 돌린다.
#
# 왜 필요한가: 생성물은 1024~1536px 원본이라 바탕화면 하나가 1.1MB다. 배포 payload
# 예산은 450KB이고(selftest.html), 제출 요건이 "링크 클릭만으로 바로 플레이"다.
# 화면에서 실제로 쓰이는 크기는 바탕화면 ~1000x340, 아이콘 56px뿐이라 원본은 전부 낭비다.
#
# 바탕화면은 JPEG로 간다 — 전면 배경이라 알파가 필요 없고, 사진성 이미지는 PNG가 몇 배 크다.
# 아이콘은 PNG 유지 — 가장자리가 또렷해야 하고 96px이면 이미 충분히 작다.
#
# 사용: powershell -ExecutionPolicy Bypass -File tools/optimize-images.ps1
#      (원본을 덮어쓰므로, 다시 뽑고 싶으면 aether-gen.js --force)

Add-Type -AssemblyName System.Drawing

$img = Join-Path $PSScriptRoot "..\games\shell\img"
if (-not (Test-Path $img)) { Write-Host "img 폴더가 없다. 먼저 aether-gen.js 를 실행할 것."; exit 1 }

function Resize-Image {
  param([string]$Src, [string]$Dst, [int]$W, [int]$H, [string]$Fmt, [int]$Quality = 80)

  # 주의: 파라미터가 [string]$Src 이고 PowerShell은 변수명 대소문자를 구분하지 않는다.
  # $src 에 Image를 대입하면 선언 타입에 맞춰 "System.Drawing.Bitmap" 문자열로 변환된다.
  # 반드시 다른 이름을 쓸 것.
  $orig = [System.Drawing.Image]::FromFile($Src)
  # 비율 유지하며 목표 상자를 덮는다(cover) — 남는 부분은 잘라낸다
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

  if ($Fmt -eq 'jpg') {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
      [System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
    # JPEG는 알파가 없다 — 투명 배경이 검게 나오지 않도록 셸 배경색을 깔아준다
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
  # 화면에서 ~1000x340 영역을 cover 로 채운다. 2배 여유까지는 필요 없다 — 배경이라 디테일이 안 읽힌다
  @{ In = 'desktop-wallpaper.png'; Out = 'desktop-wallpaper.jpg'; W = 1280; H = 480; Fmt = 'jpg'; Q = 78 },
  @{ In = 'icon-hwaryeok.png';     Out = 'icon-hwaryeok.png';     W = 96;   H = 96;  Fmt = 'png' },
  @{ In = 'icon-giving-up.png';    Out = 'icon-giving-up.png';    W = 96;   H = 96;  Fmt = 'png' },
  @{ In = 'icon-pocket.png';       Out = 'icon-pocket.png';       W = 96;   H = 96;  Fmt = 'png' }
)

$total = 0
foreach ($j in $jobs) {
  $src = Join-Path $img $j.In
  if (-not (Test-Path $src)) { Write-Host ("건너뜀  {0} (없음)" -f $j.In); continue }
  $before = (Get-Item $src).Length
  $tmp = Join-Path $img ("_tmp_" + $j.Out)
  # PowerShell 5.1에는 ?? 가 없다 — 파서 오류가 난다
  $q = if ($j.ContainsKey('Q')) { $j.Q } else { 80 }
  # 변환이 실패했는데도 원본을 지우거나 "줄었다"고 출력하면 안 된다 (실제로 그런 적 있음)
  try { Resize-Image -Src $src -Dst $tmp -W $j.W -H $j.H -Fmt $j.Fmt -Quality $q }
  catch {
    Write-Host ("실패    {0} — {1}" -f $j.In, $_.Exception.Message)
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    continue
  }
  $dst = Join-Path $img $j.Out
  if ($j.In -ne $j.Out) { Remove-Item $src -Force }
  Move-Item $tmp $dst -Force
  $after = (Get-Item $dst).Length
  $total += $after
  Write-Host ("{0,-24} {1,7:N0}KB -> {2,6:N0}KB  ({3}x{4})" -f $j.Out, ($before/1KB), ($after/1KB), $j.W, $j.H)
}
Write-Host ("`n이미지 합계 {0:N0}KB — selftest.html 의 450KB payload 예산에 포함시킬 것." -f ($total/1KB))
