# 動画カット・圧縮ツールを、最新版に更新する
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$appDir = $PSScriptRoot
$zipUrl = 'https://github.com/daisuke55-max/mp4-cutter/archive/refs/heads/main.zip'

Write-Host '=== 動画カット・圧縮ツール 更新 ===' -ForegroundColor Cyan

Write-Host '(ツールを開いている場合は、黒い画面を閉じておくと確実です)'

# git で入れた場合は、git pull で更新する
if ((Test-Path (Join-Path $appDir '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host 'git で更新します...'
    git -C $appDir pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'git pull に失敗しました' }
    Write-Host '更新が終わりました。' -ForegroundColor Green
    exit 0
}

$tmp = Join-Path $env:TEMP ('mp4-cutter-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host '最新版をダウンロードしています...'
    $zip = Join-Path $tmp 'latest.zip'
    Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $src = Join-Path $tmp 'mp4-cutter-main'
    if (-not (Test-Path (Join-Path $src 'server.js'))) { throw 'ダウンロードしたファイルの中身が正しくありません' }

    Write-Host 'ファイルを入れ替えています...'
    robocopy $src $appDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'ファイルの入れ替えに失敗しました' }

    Write-Host '更新が終わりました。ツールを開いていた場合は、黒い画面を閉じて、「動画カット起動.bat」を開き直してください。' -ForegroundColor Green
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
