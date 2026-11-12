'use strict';
// 動画カット・圧縮ツール(このPC専用)
// ブラウザの画面で動画を見ながら、必要な時間の範囲だけを切り出し、解像度と画質を下げて小さく保存する。
// 動画の処理は ffmpeg に任せる。外には一切つながない(127.0.0.1 だけで待ち受ける)。

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const TOKEN = crypto.randomBytes(16).toString('hex');
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm', '.ts', '.mts', '.m2ts']);
const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm' };
// ブラウザを閉じたまま放っておいたら、サーバーも自分で終わる(メモリを使い続けないように)
const IDLE_EXIT_MS = 5 * 60 * 1000;

// ffmpeg / ffprobe の場所を探す(PATH → winget の入れ場所)
function findBin(name) {
  const exe = name + '.exe';
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    try {
      const p = path.join(d.replace(/"/g, ''), exe);
      if (fs.existsSync(p)) return p;
    } catch { /* 次へ */ }
  }
  const pk = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const dir of fs.readdirSync(pk)) {
      if (!/ffmpeg/i.test(dir)) continue;
      for (const sub of fs.readdirSync(path.join(pk, dir))) {
        const p = path.join(pk, dir, sub, 'bin', exe);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { /* 見つからない */ }
  return null;
}
const FFMPEG = findBin('ffmpeg');
const FFPROBE = findBin('ffprobe');

function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

// Windows の「ファイルを選ぶ」「フォルダを選ぶ」画面を出す(PowerShell を使う)
function psDialog(script) {
  const full =
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
    'Add-Type -AssemblyName System.Windows.Forms;' +
    '$f=New-Object System.Windows.Forms.Form;$f.TopMost=$true;' +
    script;
  const enc = Buffer.from(full, 'utf16le').toString('base64');
  return runCapture('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', enc]).then((r) =>
    r.out.replace(/^﻿/, '').trim(),
  );
}
const PICK_FILE =
  "$d=New-Object System.Windows.Forms.OpenFileDialog;$d.Title='動画を選んでください';" +
  "$d.Filter='動画ファイル|*.mp4;*.mov;*.mkv;*.avi;*.m4v;*.webm;*.ts;*.mts;*.m2ts|すべてのファイル|*.*';" +
  "if($d.ShowDialog($f) -eq 'OK'){$d.FileName}";
const PICK_FOLDER =
  "$d=New-Object System.Windows.Forms.FolderBrowserDialog;$d.Description='保存するフォルダを選んでください';" +
  "if($d.ShowDialog($f) -eq 'OK'){$d.SelectedPath}";

// 選んだ動画の情報(長さ・大きさ・解像度など)
async function probe(file) {
  if (!FFPROBE) throw new Error('ffprobe が見つかりません');
  const r = await runCapture(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) throw new Error('この動画を読み込めませんでした');
  const j = JSON.parse(r.out);
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('映像が見つかりませんでした');
  const a = streams.find((s) => s.codec_type === 'audio');
  const duration = parseFloat((j.format && j.format.duration) || v.duration);
  if (!(duration > 0)) throw new Error('動画の長さが分かりませんでした');
  return {
    file,
    name: path.basename(file),
    duration,
    size: Number((j.format && j.format.size) || fs.statSync(file).size),
    width: v.width,
    height: v.height,
    vcodec: v.codec_name,
    hasAudio: !!a,
  };
}

// 解像度・画質などの選択を覚えておく(次に起動したときも、同じ設定で始まる)。
// 保存先は、ツールのフォルダの外(AppData)。ツールを入れ直しても消えない。
const HEIGHTS = [0, 360, 480, 540, 720, 1080];
const DEFAULT_SETTINGS = { height: 720, crf: 26, audio: true, merge: true };
const SETTINGS_FILE = path.join(process.env.APPDATA || __dirname, 'mp4-cutter', 'settings.json');
function cleanSettings(s) {
  const o = { ...DEFAULT_SETTINGS };
  if (s && HEIGHTS.includes(s.height)) o.height = s.height;
  if (s && Number.isInteger(s.crf) && s.crf >= 16 && s.crf <= 40) o.crf = s.crf;
  if (s && typeof s.audio === 'boolean') o.audio = s.audio;
  if (s && typeof s.merge === 'boolean') o.merge = s.merge;
  return o;
}
function loadSettings() {
  try {
    return cleanSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
  } catch { /* 保存できなくても、ツールは使える */ }
}

// いま選んでいる動画と、書き出しの状況
const state = { info: null };
const job = { running: false, cancel: false, merging: false, total: 0, index: 0, percent: 0, results: [], error: null, child: null };
let lastPing = Date.now();

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; ; i++) {
    const q = path.join(dir, `${name}(${i})${ext}`);
    if (!fs.existsSync(q)) return q;
  }
}
const stamp = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}h${p(Math.floor((s % 3600) / 60))}m${p(s % 60)}s`;
};

// 1か所ずつ ffmpeg で切り出して、解像度と画質を下げて書き出す
function encodeOne(src, seg, opt, outFile) {
  return new Promise((resolve, reject) => {
    const dur = seg.end - seg.start;
    const args = ['-hide_banner', '-y', '-ss', String(seg.start), '-i', src, '-t', String(dur), '-map', '0:v:0', '-map', '0:a:0?'];
    if (opt.height > 0) args.push('-vf', `scale=-2:'min(${opt.height},ih)'`); // 元より大きくはしない
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(opt.crf), '-pix_fmt', 'yuv420p');
    if (opt.audio) args.push('-c:a', 'aac', '-b:a', '96k');
    else args.push('-an');
    args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outFile);

    const child = spawn(FFMPEG, args, { windowsHide: true });
    job.child = child;
    let buf = '';
    let tail = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line); // どちらも単位はマイクロ秒
        if (m) job.percent = Math.min(100, (Number(m[1]) / 1e6 / dur) * 100);
      }
    });
    child.stderr.on('data', (d) => (tail = (tail + d).slice(-600)));
    child.on('error', reject);
    child.on('close', (code) => {
      job.child = null;
      if (job.cancel) return reject(new Error('中止しました'));
      if (code !== 0) return reject(new Error('書き出しに失敗しました: ' + tail.trim().split('\n').pop()));
      resolve();
    });
  });
}

// 同じ設定で書き出した範囲どうしを、作り直さずにそのままつなげる(速い)
function concatSegments(dir, count, outFile) {
  return new Promise((resolve, reject) => {
    const list = Array.from({ length: count }, (_, i) => `file 'seg${i}.mp4'`).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'list.txt'), list);
    const args = ['-hide_banner', '-y', '-f', 'concat', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', outFile];
    const child = spawn(FFMPEG, args, { cwd: dir, windowsHide: true });
    job.child = child;
    let tail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => (tail = (tail + d).slice(-600)));
    child.on('error', reject);
    child.on('close', (code) => {
      job.child = null;
      if (job.cancel) return reject(new Error('中止しました'));
      if (code !== 0) return reject(new Error('つなげるのに失敗しました: ' + tail.trim().split('\n').pop()));
      resolve();
    });
  });
}

async function runJob(body) {
  const info = state.info;
  const merge = !!body.merge && body.segments.length > 1;
  Object.assign(job, { running: true, cancel: false, total: body.segments.length, index: 0, percent: 0, merging: false, results: [], error: null });
  let work = null;
  try {
    fs.mkdirSync(body.outDir, { recursive: true });
    const base = path.parse(info.file).name;
    const tag = body.height > 0 ? `_${body.height}p` : '';
    if (merge) work = fs.mkdtempSync(path.join(body.outDir, '_作業中_')); // つなげ終わったら消す
    for (let i = 0; i < body.segments.length; i++) {
      const seg = body.segments[i];
      job.index = i;
      job.percent = 0;
      const out = merge ? path.join(work, `seg${i}.mp4`) : uniquePath(path.join(body.outDir, `${base}_${stamp(seg.start)}-${stamp(seg.end)}${tag}.mp4`));
      await encodeOne(info.file, seg, body, out);
      if (!merge) job.results.push({ file: out, name: path.basename(out), size: fs.statSync(out).size, dur: seg.end - seg.start });
      job.percent = 100;
    }
    if (merge) {
      job.merging = true;
      const total = body.segments.reduce((a, s) => a + (s.end - s.start), 0);
      const out = uniquePath(path.join(body.outDir, `${base}_結合${body.segments.length}か所${tag}.mp4`));
      await concatSegments(work, body.segments.length, out);
      job.results.push({ file: out, name: path.basename(out), size: fs.statSync(out).size, dur: total });
    }
  } catch (e) {
    job.error = e.message;
  } finally {
    if (work) {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* 残っても害はない */ }
    }
    job.merging = false;
    job.running = false;
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      s += d;
      if (s.length > 1e6) reject(new Error('too large'));
    });
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

// プレビュー用に、選んだ動画だけを返す(途中から再生できるよう Range に対応)
function serveVideo(req, res) {
  if (!state.info) return res.writeHead(404).end();
  const f = state.info.file;
  const size = fs.statSync(f).size;
  const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  let start = 0;
  let end = size - 1;
  if (m) {
    if (m[1] !== '') start = parseInt(m[1], 10);
    if (m[2] !== '') end = parseInt(m[2], 10);
    if (m[1] === '' && m[2] !== '') {
      start = Math.max(0, size - parseInt(m[2], 10));
      end = size - 1;
    }
  }
  if (start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  end = Math.min(end, size - 1);
  res.writeHead(m ? 206 : 200, {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  });
  const rs = fs.createReadStream(f, { start, end });
  rs.on('error', () => res.destroy());
  res.on('close', () => rs.destroy());
  rs.pipe(res);
}

function validateRun(b) {
  if (!state.info) throw new Error('先に動画を選んでください');
  if (job.running) throw new Error('いま書き出し中です');
  if (!Array.isArray(b.segments) || b.segments.length === 0 || b.segments.length > 200) throw new Error('範囲を追加してください');
  for (const s of b.segments) {
    if (!(Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start && s.end <= state.info.duration + 1))
      throw new Error('範囲の時間が正しくありません');
  }
  if (!HEIGHTS.includes(b.height)) throw new Error('解像度が正しくありません');
  if (!(Number.isInteger(b.crf) && b.crf >= 16 && b.crf <= 40)) throw new Error('画質が正しくありません');
  if (typeof b.outDir !== 'string' || !path.isAbsolute(b.outDir)) throw new Error('保存先が正しくありません');
}

const server = http.createServer(async (req, res) => {
  try {
    // 他のサイトからの呼び出しを防ぐ: 宛先と合言葉を確認する
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${server.address().port}`) return res.writeHead(403).end();
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    if (url.searchParams.get('t') !== TOKEN && req.headers['x-token'] !== TOKEN) return res.writeHead(403).end();
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.address().port}`)
      return res.writeHead(403).end();

    if (req.method === 'GET' && url.pathname === '/video') return serveVideo(req, res);
    if (req.method === 'GET' && url.pathname === '/api/status')
      return sendJson(res, 200, { running: job.running, merging: job.merging, total: job.total, index: job.index, percent: job.percent, results: job.results, error: job.error });
    if (req.method === 'GET' && url.pathname === '/api/state')
      return sendJson(res, 200, { info: state.info, ffmpeg: !!FFMPEG && !!FFPROBE, settings: loadSettings() });

    if (req.method !== 'POST') return res.writeHead(404).end();
    const body = await readBody(req);

    if (url.pathname === '/api/ping') {
      lastPing = Date.now();
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/settings') {
      saveSettings(cleanSettings(body));
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/pick') {
      const f = await psDialog(PICK_FILE);
      if (!f) return sendJson(res, 200, { canceled: true });
      state.info = await probe(f);
      return sendJson(res, 200, { info: state.info });
    }
    if (url.pathname === '/api/setpath') {
      const f = String(body.path || '').replace(/^"|"$/g, '').trim();
      if (!VIDEO_EXT.has(path.extname(f).toLowerCase())) throw new Error('動画のファイルを指定してください');
      if (!fs.existsSync(f)) throw new Error('ファイルが見つかりません');
      state.info = await probe(f);
      return sendJson(res, 200, { info: state.info });
    }
    if (url.pathname === '/api/pickfolder') {
      const d = await psDialog(PICK_FOLDER);
      return sendJson(res, 200, d ? { dir: d } : { canceled: true });
    }
    if (url.pathname === '/api/run') {
      validateRun(body);
      runJob(body);
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/cancel') {
      job.cancel = true;
      if (job.child) job.child.kill();
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/reveal') {
      const hit = job.results.find((r) => r.file === body.file);
      if (!hit) throw new Error('対象が見つかりません');
      spawn('explorer.exe', [`/select,${hit.file}`], { windowsHide: false, detached: true }).unref();
      return sendJson(res, 200, { ok: true });
    }
    res.writeHead(404).end();
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
});

if (!FFMPEG || !FFPROBE) {
  console.error('ffmpeg が見つかりません。次のコマンドで入れてください:\n  winget install Gyan.FFmpeg');
}
server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/?t=${TOKEN}`;
  console.log('動画カット・圧縮ツールを起動しました。この黒い画面は、閉じないでください。');
  console.log(url);
  if (!process.env.NO_OPEN) spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true }).unref();
});
setInterval(() => {
  if (!job.running && Date.now() - lastPing > IDLE_EXIT_MS) {
    console.log('ブラウザが閉じられたので終了します。');
    process.exit(0);
  }
}, 15000).unref();
