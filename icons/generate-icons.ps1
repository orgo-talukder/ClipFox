# Generates the Clipfox extension icons from the same geometry as brand/clipfox-mark.svg.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File .\generate-icons.ps1
# Requires Windows PowerShell 5.1+ (System.Drawing is built in).

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# The vector mark uses a 64 x 64 artboard. Two faceted halves meet on the
# centre line; the mask cutouts create the ears, eyes, and clipped cheek.
$leftHalf = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF(8, 5)),
    (New-Object System.Drawing.PointF(27, 15)),
    (New-Object System.Drawing.PointF(32, 10.5)),
    (New-Object System.Drawing.PointF(32, 57.5)),
    (New-Object System.Drawing.PointF(20.5, 43)),
    (New-Object System.Drawing.PointF(12.5, 33))
)
$rightHalf = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF(32, 10.5)),
    (New-Object System.Drawing.PointF(37, 15)),
    (New-Object System.Drawing.PointF(56, 5)),
    (New-Object System.Drawing.PointF(51.5, 33)),
    (New-Object System.Drawing.PointF(43.5, 43)),
    (New-Object System.Drawing.PointF(32, 57.5))
)
$cutouts = @(
    [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(15, 12)),
        (New-Object System.Drawing.PointF(25, 17.5)),
        (New-Object System.Drawing.PointF(21, 24))
    ),
    [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(49, 12)),
        (New-Object System.Drawing.PointF(39, 17.5)),
        (New-Object System.Drawing.PointF(43, 24))
    ),
    [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(21.5, 29.5)),
        (New-Object System.Drawing.PointF(28.5, 31.5)),
        (New-Object System.Drawing.PointF(26.5, 35.5)),
        (New-Object System.Drawing.PointF(20.5, 33.5))
    ),
    [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(42.5, 29.5)),
        (New-Object System.Drawing.PointF(35.5, 31.5)),
        (New-Object System.Drawing.PointF(37.5, 35.5)),
        (New-Object System.Drawing.PointF(43.5, 33.5))
    ),
    [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(46, 34.5)),
        (New-Object System.Drawing.PointF(56, 30)),
        (New-Object System.Drawing.PointF(58, 33.5)),
        (New-Object System.Drawing.PointF(48, 38))
    )
)

function New-ExtensionIcon {
    param([int]$Size)

    # Supersample at 16x, then downsample with a high-quality filter. This keeps
    # the faceted edges and the 16 px toolbar glyph clean.
    $super = 16
    $canvas = 64 * $super
    $bitmap = New-Object System.Drawing.Bitmap($canvas, $canvas)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.ScaleTransform([float]$super, [float]$super)

    $leftBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 138, 120, 242))
    $rightBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 92, 122, 240))
    $graphics.FillPolygon($leftBrush, $leftHalf)
    $graphics.FillPolygon($rightBrush, $rightHalf)

    # SourceCopy lets the transparent cutout polygons punch holes in the mark.
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $cutoutBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Transparent)
    foreach ($points in $cutouts) {
        $graphics.FillPolygon($cutoutBrush, $points)
    }

    $graphics.Dispose()
    $leftBrush.Dispose()
    $rightBrush.Dispose()
    $cutoutBrush.Dispose()

    $final = New-Object System.Drawing.Bitmap($Size, $Size)
    $finalGraphics = [System.Drawing.Graphics]::FromImage($final)
    $finalGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $finalGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $finalGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $finalGraphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $destination = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $finalGraphics.DrawImage($bitmap, $destination, 0, 0, $canvas, $canvas, [System.Drawing.GraphicsUnit]::Pixel)
    $finalGraphics.Dispose()

    $path = Join-Path $outDir ("icon{0}.png" -f $Size)
    $final.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $final.Dispose()
    $bitmap.Dispose()
    Write-Host ("Wrote {0} ({1}x{1})" -f $path, $Size)
}

foreach ($size in 16, 32, 48, 128) {
    New-ExtensionIcon -Size $size
}
