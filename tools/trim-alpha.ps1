# 키잉된 스프라이트의 투명 여백을 잘라낸다 (제자리, 멱등).
#
# 왜 필요한가: 생성물은 피사체가 정사각 캔버스 중앙에 떠 있어서, 게임이 "스프라이트
# 바닥 = 발 딛는 곳"으로 앵커하면 투명 여백만큼 공중에 뜬다 (실측: 항아리 29px,
# 클로슈 49px — "바닥이 아니라 공중에 있는 느낌" 피드백의 원인).
# 알파 경계 상자(+2px 패딩)로 잘라 스프라이트 가장자리 = 실제 내용 가장자리로 만든다.
#
# 사용: powershell -ExecutionPolicy Bypass -File tools/trim-alpha.ps1
# 이미 트림된 파일은 변화가 없다(멱등) — 몇 번을 돌려도 안전하다.

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class Trim {
  // 알파>20 픽셀의 경계 상자를 돌려준다. [minX, minY, maxX, maxY], 내용 없으면 null 취급(-1)
  public static int[] Bounds(Bitmap bmp) {
    var r = new Rectangle(0, 0, bmp.Width, bmp.Height);
    var d = bmp.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    int stride = Math.Abs(d.Stride);
    byte[] px = new byte[stride * bmp.Height];
    Marshal.Copy(d.Scan0, px, 0, px.Length);
    bmp.UnlockBits(d);
    int minX = bmp.Width, minY = bmp.Height, maxX = -1, maxY = -1;
    for (int y = 0; y < bmp.Height; y++)
      for (int x = 0; x < bmp.Width; x++)
        if (px[y * stride + x * 4 + 3] > 20) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    return new int[] { minX, minY, maxX, maxY };
  }
}
'@

$root = Join-Path $PSScriptRoot ".."
$targets = @(
  'games\giving-up\img\pot.png', 'games\giving-up\img\hammer.png',
  'games\hwaryeok\img\pan.png', 'games\hwaryeok\img\cloche.png',
  'games\pocket\img\me-fire.png', 'games\pocket\img\me-water.png', 'games\pocket\img\me-grass.png',
  'games\pocket\img\foe-fire.png', 'games\pocket\img\foe-water.png', 'games\pocket\img\foe-grass.png',
  'games\fishing\img\boat.png',
  'games\fishing\img\fish-0.png', 'games\fishing\img\fish-1.png', 'games\fishing\img\fish-2.png',
  'games\fishing\img\fish-3.png', 'games\fishing\img\fish-4.png',
  'games\bomb\img\bomb-body.png',
  # ui-* 아이콘은 트림하지 않는다 — 정사각 프레임을 유지해야 12~15px 표시 크기가 균일하다.
  # 버튼 플레이트만 예외: 투명 여백이 남으면 버튼 면과 클릭 영역이 어긋난다
  'games\shell\img\ui-button.png'
)

foreach ($rel in $targets) {
  $f = Join-Path $root $rel
  if (-not (Test-Path $f)) { Write-Host ("건너뜀  {0} (없음)" -f $rel); continue }
  $src = New-Object System.Drawing.Bitmap($f)
  $b = [Trim]::Bounds($src)
  if ($b[2] -lt 0) { Write-Host ("건너뜀  {0} (내용 없음)" -f $rel); $src.Dispose(); continue }
  $pad = 2
  $x0 = [Math]::Max(0, $b[0] - $pad); $y0 = [Math]::Max(0, $b[1] - $pad)
  $x1 = [Math]::Min($src.Width - 1, $b[2] + $pad); $y1 = [Math]::Min($src.Height - 1, $b[3] + $pad)
  $w = $x1 - $x0 + 1; $h = $y1 - $y0 + 1
  if ($w -ge $src.Width - 2 -and $h -ge $src.Height - 2) {
    Write-Host ("유지    {0} (여백 없음)" -f $rel); $src.Dispose(); continue
  }
  $dst = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), $x0, $y0, $w, $h, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $src.Dispose()
  $dst.Save("$f.tmp", [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
  Move-Item "$f.tmp" $f -Force
  Write-Host ("트림    {0}  → {1}x{2}" -f $rel, $w, $h)
}
