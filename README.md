# 動画カット・圧縮ツール (mp4-cutter)

数時間の動画から必要な部分だけを切り出し、解像度を下げてデータを小さくするツールです。
動画はそのPCの中だけで処理され、外部には送られません。

## 使い方

1. `動画カット起動.bat` をダブルクリックする(ブラウザに操作画面が開く)
2. 動画を選び、残したい範囲を決めて、解像度・画質を選び、実行する
3. 使い終わったら黒い画面(コマンドの窓)を閉じる

## 新しいPCで使えるようにする(最初の1回だけ)

PowerShell を開いて、次を1行ずつ実行します。

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
```

そのあと PowerShell を開き直して、次を実行します(GitHubのログイン画面が出たらログインする)。

```powershell
cd $HOME
git clone https://github.com/daisuke55-max/mp4-cutter.git
```

`mp4-cutter` フォルダの中の `動画カット起動.bat` をダブルクリックすれば使えます。

## 更新するとき

```powershell
cd $HOME\mp4-cutter
git pull
```

## 構成

- `server.js` ... ローカルサーバー(ffmpeg を呼び出す)
- `index.html` ... 操作画面
- `動画カット起動.bat` ... 起動用
