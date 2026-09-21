const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Binaries and dependencies (cross-platform: works on Linux server & Windows local)
let YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';
const localWinYtdlp = 'C:\\Users\\Parth\\AppData\\Local\\Python\\pythoncore-3.14-64\\Scripts\\yt-dlp.exe';
if (process.platform === 'win32' && fs.existsSync(localWinYtdlp)) {
  YTDLP_BIN = localWinYtdlp;
}

const FFMPEG_DIR = 'C:\\Users\\Parth\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-full_build\\bin';

if (fs.existsSync(FFMPEG_DIR)) {
  process.env.PATH = `${FFMPEG_DIR};${process.env.PATH}`;
  console.log(`  🎬 ffmpeg found at: ${FFMPEG_DIR}`);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Clean up old files every 10 minutes (files older than 15 min)
setInterval(() => {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(DOWNLOADS_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 15 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    // silently continue
  }
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidUrl(url) {
  const patterns = [
    /https?:\/\/(www\.)?instagram\.com\/(reel|reels|p|stories)\//i,
    /https?:\/\/(www\.)?instagram\.com\/[\w.]+\/(reel|reels|p)\//i,
    /https?:\/\/(www\.)?facebook\.com\/.+\/(videos|reel|reels)\//i,
    /https?:\/\/(www\.)?facebook\.com\/reel\//i,
    /https?:\/\/(www\.)?facebook\.com\/watch/i,
    /https?:\/\/fb\.watch\//i,
    /https?:\/\/(www\.)?facebook\.com\/share\/(r|v)\//i,
    /https?:\/\/(www\.)?instagram\.com\/share\//i,
  ];
  return patterns.some((p) => p.test(url));
}

function detectPlatform(url) {
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  return 'unknown';
}

function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    // Clean all argument strings: strip any unintended outer quotes
    const cleanArgs = args.map((a) => String(a).replace(/^"|"$/g, '').trim());
    console.log('[yt-dlp exec]', cleanArgs.join(' '));

    execFile(
      YTDLP_BIN,
      cleanArgs,
      { maxBuffer: 20 * 1024 * 1024, timeout: 120000 },
      (err, stdout, stderr) => {
        if (err) {
          const errMsg = (stderr || err.message || '').trim();
          console.error('[yt-dlp error]', errMsg);
          reject(new Error(errMsg));
        } else {
          resolve((stdout || '').trim());
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// API: Health check
// ---------------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    const version = await runYtdlp(['--version']);
    res.json({
      ok: true,
      ytdlp: version,
      ffmpeg: fs.existsSync(path.join(FFMPEG_DIR, 'ffmpeg.exe')),
    });
  } catch {
    res.json({ ok: false, ytdlp: null, message: 'yt-dlp is not installed or not working.' });
  }
});

// ---------------------------------------------------------------------------
// API: Fetch video information
// ---------------------------------------------------------------------------
app.post('/api/info', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid Instagram or Facebook reel/video URL.' });
  }

  try {
    const raw = await runYtdlp([
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '--no-check-certificates',
      url,
    ]);

    const info = JSON.parse(raw);

    // Collect available video heights for quality selector
    const heights = new Set();
    for (const f of (info.formats || [])) {
      if (f.vcodec && f.vcodec !== 'none' && f.height) {
        heights.add(f.height);
      }
    }

    const sortedHeights = [...heights].sort((a, b) => b - a);

    const formats = sortedHeights.map((h) => ({
      id: String(h),
      ext: 'mp4',
      quality: `${h}p (HD with Audio)`,
      height: h,
    }));

    // Always ensure "Best Quality" is available
    formats.unshift({ id: 'best', ext: 'mp4', quality: 'Best Quality (Original Audio)', height: 0 });

    res.json({
      title: info.title || info.description?.slice(0, 80) || 'Reel Video',
      thumbnail: info.thumbnail || null,
      duration: info.duration || 0,
      platform: detectPlatform(url),
      uploader: info.uploader || info.channel || '',
      formats,
    });
  } catch (err) {
    console.error('Info endpoint error:', err.message);
    res.status(500).json({
      error: 'Could not fetch video info. The link may be private or restricted by the platform.',
    });
  }
});

// Rate Limiting & Concurrency Control (Prevents Server Crash Under Heavy Load)
let activeDownloads = 0;
const MAX_CONCURRENT_DOWNLOADS = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS, 10) || 4;

const ipRequests = new Map();
function rateLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = ipRequests.get(ip) || { count: 0, reset: now + 60000 };

  if (now > entry.reset) {
    entry.count = 1;
    entry.reset = now + 60000;
  } else {
    entry.count++;
  }
  ipRequests.set(ip, entry);

  if (entry.count > 30) {
    return res.status(429).json({ error: 'Too many requests. Please slow down and try again in a minute.' });
  }
  next();
}

app.use('/api/', rateLimiter);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// API: Download video (Supports both GET direct download and POST)
// ---------------------------------------------------------------------------
app.all('/api/download', async (req, res) => {
  const url = req.query.url || req.body?.url;
  const formatId = req.query.formatId || req.body?.formatId;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  // Crash Protection: Queue / limit concurrent video processing
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    const busyMsg = 'Server is currently busy processing other downloads. Please wait a few seconds and try again.';
    if (req.method === 'GET') {
      return res.redirect(`/?error=${encodeURIComponent(busyMsg)}`);
    }
    return res.status(429).json({ error: busyMsg });
  }

  activeDownloads++;
  const fileId = uuidv4();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${fileId}.%(ext)s`);

  try {
    // Speed Optimization: Prefer pre-merged MP4 first (instant, no merge needed),
    // then merge separate streams using stream copy (no re-encoding, 10x faster)
    let formatStr;
    if (formatId && formatId !== 'best') {
      formatStr = `b[height<=${formatId}][ext=mp4]/bv*[height<=${formatId}]+ba/b[height<=${formatId}]/b[ext=mp4]/bv*+ba/b`;
    } else {
      formatStr = `b[ext=mp4]/bv*+ba/b`;
    }

    const args = [
      '-f', formatStr,
      '--merge-output-format', 'mp4',
      '-N', '4', // Multi-threaded downloading (speeds up download by 3x-4x)
      '--postprocessor-args', 'Merger:-c:v copy -c:a copy', // Direct stream copy: NO CPU re-encoding lag!
      '--no-warnings',
      '--no-playlist',
      '--no-check-certificates',
    ];

    if (fs.existsSync(FFMPEG_DIR)) {
      args.push('--ffmpeg-location', FFMPEG_DIR);
    }

    args.push('-o', outputTemplate);
    args.push(url);

    await runYtdlp(args);

    // Locate the downloaded file
    const files = fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.startsWith(fileId));
    if (files.length === 0) {
      throw new Error('Download completed but file was not found on disk.');
    }

    const filePath = path.join(DOWNLOADS_DIR, files[0]);
    const ext = path.extname(files[0]) || '.mp4';
    const stat = fs.statSync(filePath);

    res.setHeader('Content-Disposition', `attachment; filename="ReelsDown_${Date.now()}${ext}"`);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('end', () => {
      // Auto-cleanup after download completes
      setTimeout(() => {
        try { fs.unlinkSync(filePath); } catch {}
      }, 5000);
    });
  } catch (err) {
    console.error('Download endpoint error:', err.message);
    const failMsg = 'Download failed. The video may be private or restricted.';
    if (req.method === 'GET') {
      res.redirect(`/?error=${encodeURIComponent(failMsg)}`);
    } else {
      res.status(500).json({ error: failMsg });
    }
  } finally {
    activeDownloads = Math.max(0, activeDownloads - 1);
  }
});

// ---------------------------------------------------------------------------
// Fallback: serve index.html for SPA
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  🎬 ReelGrab server running at http://localhost:${PORT}\n`);
  console.log(`  ✅ yt-dlp binary: ${YTDLP_BIN}`);
  console.log(`  ✅ ffmpeg dir: ${FFMPEG_DIR}\n`);
});
