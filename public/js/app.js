/* ===================================================================
   ReelGrab — Client-side Application Logic
   =================================================================== */

(function () {
  'use strict';

  // ---- DOM refs ----
  const urlForm        = document.getElementById('urlForm');
  const urlInput       = document.getElementById('urlInput');
  const fetchBtn       = document.getElementById('fetchBtn');
  const btnText        = fetchBtn.querySelector('.btn-text');
  const btnLoader      = fetchBtn.querySelector('.btn-loader');
  const inputHint      = document.getElementById('inputHint');
  const statusBanner   = document.getElementById('statusBanner');
  const resultCard     = document.getElementById('resultCard');
  const closeResult    = document.getElementById('closeResult');
  const resultThumb    = document.getElementById('resultThumb');
  const resultDuration = document.getElementById('resultDuration');
  const resultPlatform = document.getElementById('resultPlatform');
  const resultTitle    = document.getElementById('resultTitle');
  const resultUploader = document.getElementById('resultUploader');
  const qualitySelect  = document.getElementById('qualitySelect');
  const downloadBtn    = document.getElementById('downloadBtn');
  const downloadBtnTxt = document.getElementById('downloadBtnText');
  const progressWrap   = document.getElementById('progressWrap');
  const progressBar    = document.getElementById('progressBar');
  const progressLabel  = document.getElementById('progressLabel');
  const toastContainer = document.getElementById('toastContainer');

  let currentUrl = '';

  // ---- Helpers ----

  function setHint(msg, type = 'info') {
    inputHint.textContent = msg;
    inputHint.className = `input-hint ${type}`;
  }

  function setLoading(on) {
    fetchBtn.disabled = on;
    btnText.hidden = on;
    btnLoader.hidden = !on;
  }

  function showToast(msg, type = 'info', duration = 4000) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s, transform 0.3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  function formatDuration(sec) {
    if (!sec || sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function isValidUrl(url) {
    return /https?:\/\/(www\.)?(instagram\.com|facebook\.com|fb\.watch)\//i.test(url);
  }

  // ---- Health Check ----

  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (!data.ok) {
        statusBanner.hidden = false;
        statusBanner.className = 'status-banner warn';
        statusBanner.innerHTML = '⚠️ <strong>yt-dlp</strong> is not installed. Run <code>pip install yt-dlp</code> to enable downloads.';
      }
    } catch {
      // Server not reachable — will fail on fetch anyway
    }
  }

  // ---- Auto-detect paste ----

  urlInput.addEventListener('paste', () => {
    setTimeout(() => {
      const val = urlInput.value.trim();
      if (isValidUrl(val)) {
        const platform = /instagram/i.test(val) ? 'Instagram' : 'Facebook';
        setHint(`✓ ${platform} link detected`, 'success');
      }
    }, 50);
  });

  urlInput.addEventListener('input', () => {
    const val = urlInput.value.trim();
    if (!val) {
      setHint('');
      return;
    }
    if (val.length > 10 && !isValidUrl(val)) {
      setHint('Please paste a valid Instagram or Facebook reel link', 'error');
    } else if (isValidUrl(val)) {
      const platform = /instagram/i.test(val) ? 'Instagram' : 'Facebook';
      setHint(`✓ ${platform} link detected`, 'success');
    } else {
      setHint('');
    }
  });

  // ---- Fetch Video Info ----

  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();

    if (!url) {
      setHint('Please paste a link first', 'error');
      urlInput.focus();
      return;
    }

    if (!isValidUrl(url)) {
      setHint('This doesn\'t look like a valid Instagram or Facebook link', 'error');
      return;
    }

    setLoading(true);
    setHint('Fetching video info…', 'info');
    resultCard.hidden = true;

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Something went wrong');
      }

      currentUrl = url;
      showResult(data);
      setHint('');
    } catch (err) {
      setHint('');
      showToast(err.message || 'Failed to fetch video info', 'error');
    } finally {
      setLoading(false);
    }
  });

  // ---- Show Result ----

  function showResult(info) {
    // Thumbnail
    if (info.thumbnail) {
      resultThumb.src = info.thumbnail;
      resultThumb.style.display = '';
    } else {
      resultThumb.style.display = 'none';
    }

    // Duration
    const dur = formatDuration(info.duration);
    resultDuration.textContent = dur;
    resultDuration.hidden = !dur;

    // Platform badge
    resultPlatform.textContent = info.platform === 'instagram' ? 'Instagram' : 'Facebook';
    resultPlatform.className = `result-platform ${info.platform}`;

    // Title & uploader
    resultTitle.textContent = info.title || 'Reel Video';
    resultUploader.textContent = info.uploader ? `@${info.uploader}` : '';

    // Quality options
    qualitySelect.innerHTML = '';
    for (const f of info.formats) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.quality;
      qualitySelect.appendChild(opt);
    }

    // Show card
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Reset progress
    progressWrap.hidden = true;
    progressBar.style.width = '0%';
    downloadBtn.disabled = false;
    downloadBtnTxt.textContent = 'Download MP4';
  }

  // ---- Close Result ----

  closeResult.addEventListener('click', () => {
    resultCard.hidden = true;
    currentUrl = '';
  });

  // ---- Download ----

  downloadBtn.addEventListener('click', async () => {
    if (!currentUrl) return;

    const formatId = qualitySelect.value;
    downloadBtn.disabled = true;
    downloadBtnTxt.textContent = 'Downloading…';
    progressWrap.hidden = false;
    progressBar.style.width = '15%';
    progressLabel.textContent = 'Starting download…';

    try {
      // Start a simulated progress while we wait
      let progress = 15;
      const progressInterval = setInterval(() => {
        if (progress < 85) {
          progress += Math.random() * 8;
          progressBar.style.width = `${Math.min(progress, 85)}%`;
        }
      }, 500);

      progressLabel.textContent = 'Processing video…';

      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentUrl, formatId }),
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        let errMsg = 'Download failed';
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch { /* response wasn't JSON */ }
        throw new Error(errMsg);
      }

      progressBar.style.width = '90%';
      progressLabel.textContent = 'Saving file…';

      // Get the blob and trigger download
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;

      // Extract filename from Content-Disposition or generate one
      const disposition = res.headers.get('Content-Disposition');
      let filename = `reel_${Date.now()}.mp4`;
      if (disposition) {
        const match = disposition.match(/filename="?([^";\n]+)"?/);
        if (match) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);

      progressBar.style.width = '100%';
      progressLabel.textContent = 'Done!';
      showToast('Video downloaded successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Download failed', 'error');
      progressLabel.textContent = 'Failed';
    } finally {
      downloadBtn.disabled = false;
      downloadBtnTxt.textContent = 'Download MP4';
      setTimeout(() => {
        progressWrap.hidden = true;
        progressBar.style.width = '0%';
      }, 3000);
    }
  });

  // ---- Modal Logic (About, Privacy, Terms) ----
  const modalBackdrop  = document.getElementById('modalBackdrop');
  const modalClose     = document.getElementById('modalClose');
  const modalAbout     = document.getElementById('modalAbout');
  const modalPrivacy   = document.getElementById('modalPrivacy');
  const modalTerms     = document.getElementById('modalTerms');
  const navAbout       = document.getElementById('navAbout');
  const navPrivacy     = document.getElementById('navPrivacy');
  const navTerms       = document.getElementById('navTerms');
  const footerAbout    = document.querySelector('.footer-about');
  const footerPrivacy  = document.querySelector('.footer-privacy');
  const footerTerms    = document.querySelector('.footer-terms');
  const navLinks       = document.querySelectorAll('.nav-link');

  function openModal(type) {
    if (!modalBackdrop) return;
    modalAbout.hidden = true;
    modalPrivacy.hidden = true;
    modalTerms.hidden = true;

    if (type === 'about') modalAbout.hidden = false;
    else if (type === 'privacy') modalPrivacy.hidden = false;
    else if (type === 'terms') modalTerms.hidden = false;

    modalBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';

    // Update active nav state
    navLinks.forEach((l) => l.classList.remove('active'));
    if (type === 'about' && navAbout) navAbout.classList.add('active');
    if (type === 'privacy' && navPrivacy) navPrivacy.classList.add('active');
    if (type === 'terms' && navTerms) navTerms.classList.add('active');
  }

  function closeModal() {
    if (!modalBackdrop) return;
    modalBackdrop.hidden = true;
    document.body.style.overflow = '';
    navLinks.forEach((l) => l.classList.remove('active'));
    const homeLink = document.querySelector('.nav-link[href="/"]');
    if (homeLink) homeLink.classList.add('active');
  }

  [navAbout, footerAbout].forEach((el) => el && el.addEventListener('click', (e) => {
    e.preventDefault();
    openModal('about');
  }));

  [navPrivacy, footerPrivacy].forEach((el) => el && el.addEventListener('click', (e) => {
    e.preventDefault();
    openModal('privacy');
  }));

  [navTerms, footerTerms].forEach((el) => el && el.addEventListener('click', (e) => {
    e.preventDefault();
    openModal('terms');
  }));

  if (modalClose) modalClose.addEventListener('click', closeModal);

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBackdrop && !modalBackdrop.hidden) {
      closeModal();
    }
  });

  // ---- Init ----
  checkHealth();
})();
