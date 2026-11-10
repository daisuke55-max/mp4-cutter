# 動画カット・圧縮ツールに必要なもの(Node.js と ffmpeg)を入れる
$ErrorActionPreference = 'Continue'

function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Find-Ffmpeg {
    if (Test-Cmd 'ffmpeg') { return $true }
    $pk = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path $pk) {
        $hit = Get-ChildItem $pk -Directory -Filter '*ffmpeg*' -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue } |
            Select-Object -First 1
        if ($hit) { return $true }
    }
    return $false
}

Write-Host '=== 動画カット・圧縮ツール 最初の準備 ===' -ForegroundColor Cyan

if (-not (Test-Cmd 'winget')) {
    Write-Host 'winget が見つかりません。Windows 10/11 の「アプリ インストーラー」を更新してから、もう一度実行してください。' -ForegroundColor Red
    exit 1
}

if (Test-Cmd 'node') {
    Write-Host '[OK] Node.js は入っています' -ForegroundColor Green
} else {
    Write-Host 'Node.js を入れています...(確認の画面が出たら「はい」を押してください)'
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
}

if (Find-Ffmpeg) {
    Write-Host '[OK] ffmpeg は入っています' -ForegroundColor Green
} else {
    Write-Host 'ffmpeg を入れています...'
    winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
}

Write-Host ''
Write-Host '準備が終わりました。この窓を閉じて、「動画カット起動.bat」をダブルクリックしてください。' -ForegroundColor Cyan
Write-Host '(「node が見つからない」と出たら、パソコンを再起動してから、もう一度試してください)'
