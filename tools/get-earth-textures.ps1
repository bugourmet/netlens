# Downloads the NASA Earth images and resizes them to 4096 x 2048 for public/textures.
# Sources and terms: see THIRD_PARTY_NOTICES.md.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\public\textures'
New-Item -ItemType Directory -Force $out | Out-Null
$out = (Resolve-Path $out).Path
$temp = Join-Path ([IO.Path]::GetTempPath()) "netlens-textures-$PID"
New-Item -ItemType Directory -Force $temp | Out-Null

$base = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images'
$images = @(
    @{ Name = 'earth-day.jpg'; Url = "$base/bmng/bmng-topography-bathymetry/january/world.topo.bathy.200401.3x5400x2700.jpg" },
    @{ Name = 'earth-night.jpg'; Url = "$base/imagerecords/144000/144898/BlackMarble_2016_3km.jpg" }
)

$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$quality = New-Object Drawing.Imaging.EncoderParameters 1
$quality.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 90L

try {
    foreach ($image in $images) {
        $file = Join-Path $temp $image.Name
        Invoke-WebRequest -UseBasicParsing $image.Url -OutFile $file
        $source = [Drawing.Image]::FromFile($file)
        $target = New-Object Drawing.Bitmap 4096, 2048
        $graphics = [Drawing.Graphics]::FromImage($target)
        $graphics.InterpolationMode = 'HighQualityBicubic'
        $graphics.DrawImage($source, 0, 0, 4096, 2048)
        $target.Save((Join-Path $out $image.Name), $codec, $quality)
        $graphics.Dispose(); $target.Dispose(); $source.Dispose()
    }
}
finally {
    Remove-Item -Recurse -Force $temp
}
Get-ChildItem $out | Select-Object Name, Length
