/* ═══════════════════════════════════════
   STEALTHCAM — Main Application Logic
   ═══════════════════════════════════════ */

'use strict';

// ─── STATE ────────────────────────────────────────────────
const STATE = {
    pin: null,
    pinBuffer: '',
    pinMode: 'enter',      // 'enter' | 'set' | 'confirm'
    pinTemp: '',
    isRecording: false,
    stream: null,
    mediaRecorder: null,
    recordedChunks: [],
    facingMode: 'environment', // 'environment'=back | 'user'=front
    flashOn: false,
    flashTrack: null,
    timerInterval: null,
    timerSeconds: 0,
    wakeLock: null,
    stealthTapCount: 0,
    stealthTapTimer: null,
    recordings: [],           // [{id, blob, url, duration, date, size}]
    currentVideoIndex: -1,
};

// ─── INIT ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    loadRecordings();
    const savedPin = localStorage.getItem('sc_pin');
    if (savedPin) {
        STATE.pin = savedPin;
        STATE.pinMode = 'enter';
        document.getElementById('pinTitle').textContent = 'Enter PIN';
    } else {
        STATE.pinMode = 'set';
        document.getElementById('pinTitle').textContent = 'Create PIN (4 digits)';
    }
    showScreen('pinScreen');
});

// ─── SCREEN ROUTING ────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const s = document.getElementById(id);
    s.style.display = 'flex';
    requestAnimationFrame(() => s.classList.add('active'));
}
function showRecorder() { showScreen('recorderScreen'); updateSettings(); }
function showGallery() { renderGallery(); showScreen('galleryScreen'); }
function showSettings() { updateSettings(); showScreen('settingsScreen'); }

// ─── PIN SYSTEM ────────────────────────────────────────────
function pinPress(digit) {
    if (STATE.pinBuffer.length >= 4) return;
    STATE.pinBuffer += digit;
    updateDots(STATE.pinBuffer.length, false);
    if (STATE.pinBuffer.length === 4) {
        setTimeout(() => handlePinComplete(), 150);
    }
}

function pinDelete() {
    if (STATE.pinBuffer.length === 0) return;
    STATE.pinBuffer = STATE.pinBuffer.slice(0, -1);
    updateDots(STATE.pinBuffer.length, false);
}

function updateDots(count, error) {
    for (let i = 1; i <= 4; i++) {
        const dot = document.getElementById('d' + i);
        dot.classList.remove('filled', 'error');
        if (i <= count) {
            dot.classList.add(error ? 'error' : 'filled');
        }
    }
}

function handlePinComplete() {
    const entered = STATE.pinBuffer;
    STATE.pinBuffer = '';

    if (STATE.pinMode === 'set') {
        STATE.pinTemp = entered;
        STATE.pinMode = 'confirm';
        document.getElementById('pinTitle').textContent = 'Confirm PIN';
        updateDots(0, false);
        return;
    }

    if (STATE.pinMode === 'confirm') {
        if (entered === STATE.pinTemp) {
            STATE.pin = entered;
            localStorage.setItem('sc_pin', entered);
            STATE.pinMode = 'enter';
            document.getElementById('pinTitle').textContent = 'Enter PIN';
            document.getElementById('pinError').textContent = '';
            toast('PIN set! Launching camera...');
            setTimeout(() => launchCamera(), 600);
        } else {
            showPinError('PINs do not match. Try again.');
            STATE.pinMode = 'set';
            STATE.pinTemp = '';
            document.getElementById('pinTitle').textContent = 'Create PIN (4 digits)';
        }
        return;
    }

    if (STATE.pinMode === 'enter') {
        if (entered === STATE.pin) {
            document.getElementById('pinError').textContent = '';
            updateDots(4, false);
            setTimeout(() => launchCamera(), 200);
        } else {
            showPinError('Wrong PIN. Try again.');
        }
    }
}

function showPinError(msg) {
    document.getElementById('pinError').textContent = msg;
    updateDots(4, true);
    STATE.pinBuffer = '';
    setTimeout(() => { updateDots(0, false); }, 600);
}

// Change PIN from settings
function changePin() {
    STATE.pinMode = 'set';
    STATE.pinTemp = '';
    STATE.pinBuffer = '';
    document.getElementById('pinTitle').textContent = 'Create New PIN';
    document.getElementById('pinError').textContent = '';
    updateDots(0, false);
    showScreen('pinScreen');
}

// ─── CAMERA ────────────────────────────────────────────────
async function launchCamera() {
    showScreen('recorderScreen');
    await startCamera();
}

async function startCamera() {
    if (STATE.stream) {
        STATE.stream.getTracks().forEach(t => t.stop());
    }
    STATE.flashOn = false;
    updateFlashBtn();

    const quality = document.getElementById('qualitySelect')?.value || 'medium';
    const constraints = {
        video: {
            facingMode: STATE.facingMode,
            width: quality === 'high' ? 1920 : quality === 'medium' ? 1280 : 640,
            height: quality === 'high' ? 1080 : quality === 'medium' ? 720 : 480,
        },
        audio: true,
    };

    try {
        STATE.stream = await navigator.mediaDevices.getUserMedia(constraints);
        const video = document.getElementById('videoPreview');
        video.srcObject = STATE.stream;
        video.play();

        // Find torch track
        STATE.flashTrack = STATE.stream.getVideoTracks().find(t => t.getCapabilities && t.getCapabilities().torch);
    } catch (err) {
        toast('Camera error: ' + err.message);
        console.error(err);
    }
}

async function switchCamera() {
    if (STATE.isRecording) {
        toast('Cannot switch camera while recording');
        return;
    }
    STATE.facingMode = STATE.facingMode === 'environment' ? 'user' : 'environment';
    await startCamera();
    toast(STATE.facingMode === 'user' ? 'Front camera' : 'Back camera');
}

// ─── FLASHLIGHT ────────────────────────────────────────────
async function toggleFlash() {
    if (!STATE.flashTrack) {
        toast('Flashlight not available');
        return;
    }
    STATE.flashOn = !STATE.flashOn;
    try {
        await STATE.flashTrack.applyConstraints({ advanced: [{ torch: STATE.flashOn }] });
        updateFlashBtn();
        toast(STATE.flashOn ? 'Flash ON' : 'Flash OFF');
    } catch (e) {
        toast('Flash error: ' + e.message);
        STATE.flashOn = false;
        updateFlashBtn();
    }
}

function updateFlashBtn() {
    const btn = document.getElementById('flashBtn');
    if (STATE.flashOn) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

// ─── RECORDING ─────────────────────────────────────────────
async function toggleRecord() {
    if (STATE.isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    if (!STATE.stream) {
        toast('No camera stream');
        return;
    }

    STATE.recordedChunks = [];

    // Pick best mimeType
    const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mime = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';

    try {
        STATE.mediaRecorder = new MediaRecorder(STATE.stream, mime ? { mimeType: mime } : {});
    } catch (e) {
        STATE.mediaRecorder = new MediaRecorder(STATE.stream);
    }

    STATE.mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) STATE.recordedChunks.push(e.data);
    };

    STATE.mediaRecorder.onstop = () => saveRecording();

    STATE.mediaRecorder.start(1000); // chunk every 1s
    STATE.isRecording = true;
    STATE.timerSeconds = 0;

    // UI updates
    document.getElementById('recordBtn').classList.add('recording');
    document.getElementById('recTimer').classList.add('recording');

    // Timer
    STATE.timerInterval = setInterval(() => {
        STATE.timerSeconds++;
        document.getElementById('recTimer').textContent = formatTime(STATE.timerSeconds);
    }, 1000);

    // Wake lock to prevent sleep
    await acquireWakeLock();

    toast('Recording started');
}

function stopRecording() {
    if (!STATE.mediaRecorder) return;
    STATE.mediaRecorder.stop();
    STATE.isRecording = false;

    clearInterval(STATE.timerInterval);
    document.getElementById('recordBtn').classList.remove('recording');
    document.getElementById('recTimer').classList.remove('recording');
    document.getElementById('recTimer').textContent = '00:00';

    releaseWakeLock();
    toast('Recording saved!');
}

function saveRecording() {
    const blob = new Blob(STATE.recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const rec = {
        id: Date.now(),
        blob,
        url,
        duration: STATE.timerSeconds,
        date: new Date().toLocaleString(),
        size: blob.size,
    };
    STATE.recordings.unshift(rec);
    persistRecordings();
    updateSettings();
}

// ─── GALLERY ───────────────────────────────────────────────
function renderGallery() {
    const grid = document.getElementById('galleryGrid');
    if (STATE.recordings.length === 0) {
        grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎥</div>
        <p>No recordings yet</p>
      </div>`;
        return;
    }

    grid.innerHTML = STATE.recordings.map((r, i) => `
    <div class="gallery-item" onclick="openVideo(${i})">
      <video src="${r.url}" preload="metadata"></video>
      <div class="item-overlay">
        <span class="item-duration">${formatTime(r.duration)}</span>
      </div>
      <div class="item-play">▶</div>
    </div>
  `).join('');
}

function openVideo(index) {
    STATE.currentVideoIndex = index;
    const rec = STATE.recordings[index];
    document.getElementById('modalVideo').src = rec.url;
    document.getElementById('videoModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('videoModal').classList.add('hidden');
    document.getElementById('modalVideo').pause();
    document.getElementById('modalVideo').src = '';
    STATE.currentVideoIndex = -1;
}

function deleteCurrentVideo() {
    if (STATE.currentVideoIndex < 0) return;
    STATE.recordings.splice(STATE.currentVideoIndex, 1);
    persistRecordings();
    closeModal();
    renderGallery();
    toast('Recording deleted');
}

async function exportToGallery() {
    const idx = STATE.currentVideoIndex;
    if (idx < 0) return;
    const rec = STATE.recordings[idx];

    // Capacitor native export
    if (window.Capacitor && Capacitor.isNativePlatform() && Capacitor.Plugins.Filesystem) {
        try {
            const { Filesystem, Directory } = Capacitor.Plugins;
            const reader = new FileReader();
            reader.readAsDataURL(rec.blob);
            reader.onloadend = async () => {
                const base64 = reader.result.split(',')[1];
                const fileName = 'StealthCam_' + rec.id + '.webm';
                await Filesystem.writeFile({
                    path: 'Movies/' + fileName,
                    data: base64,
                    directory: Directory.ExternalStorage,
                });
                toast('Saved to Gallery!');
            };
        } catch (e) {
            toast('Export error: ' + e.message);
        }
    } else {
        // Web fallback — trigger download
        const a = document.createElement('a');
        a.href = rec.url;
        a.download = 'StealthCam_' + rec.id + '.webm';
        a.click();
        toast('Downloading video...');
    }
}

function clearAll() {
    if (!confirm('Delete ALL recordings? This cannot be undone.')) return;
    STATE.recordings = [];
    persistRecordings();
    renderGallery();
    toast('All recordings deleted');
}

// ─── STEALTH MODE ──────────────────────────────────────────
function activateStealth() {
    const overlay = document.getElementById('stealthOverlay');
    overlay.classList.remove('hidden');

    // Triple-tap to exit stealth
    overlay.addEventListener('click', handleStealthTap);
    toast('Stealth mode ON — tap 3x to unlock');
}

function handleStealthTap() {
    STATE.stealthTapCount++;
    clearTimeout(STATE.stealthTapTimer);

    if (STATE.stealthTapCount >= 3) {
        STATE.stealthTapCount = 0;
        deactivateStealth();
    } else {
        STATE.stealthTapTimer = setTimeout(() => {
            STATE.stealthTapCount = 0;
        }, 800);
    }
}

function deactivateStealth() {
    const overlay = document.getElementById('stealthOverlay');
    overlay.classList.add('hidden');
    overlay.removeEventListener('click', handleStealthTap);
    STATE.stealthTapCount = 0;
}

// ─── WAKE LOCK ─────────────────────────────────────────────
async function acquireWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            STATE.wakeLock = await navigator.wakeLock.request('screen');
            STATE.wakeLock.addEventListener('release', () => {
                // Re-acquire if still recording (handles screen-off re-on)
                if (STATE.isRecording) acquireWakeLock();
            });
        }
    } catch (e) {
        console.warn('Wake lock:', e.message);
    }
}

async function releaseWakeLock() {
    if (STATE.wakeLock) {
        try { await STATE.wakeLock.release(); } catch { }
        STATE.wakeLock = null;
    }
}

function toggleWakeLock(el) {
    if (el.checked) {
        acquireWakeLock();
        toast('Screen will stay on');
    } else {
        releaseWakeLock();
        toast('Screen lock restored');
    }
}

// Handle page visibility change — keep recording when screen dims
document.addEventListener('visibilitychange', () => {
    if (STATE.isRecording && document.hidden) {
        // Recording continues; wake lock will try to re-acquire
        console.log('App hidden — recording continues in background');
    }
});

// ─── PERSISTENCE ───────────────────────────────────────────
// We store metadata in localStorage; blobs in memory (lost on close)
// For production use Capacitor Filesystem to truly persist blobs
function persistRecordings() {
    const meta = STATE.recordings.map(r => ({
        id: r.id,
        duration: r.duration,
        date: r.date,
        size: r.size,
    }));
    localStorage.setItem('sc_recordings_meta', JSON.stringify(meta));
}

function loadRecordings() {
    // Blobs can't be loaded from localStorage — we just show session data
    // On native, Capacitor Filesystem is used for permanent storage
    STATE.recordings = [];
}

// ─── SETTINGS ──────────────────────────────────────────────
function updateSettings() {
    const total = STATE.recordings.length;
    const bytes = STATE.recordings.reduce((a, r) => a + r.size, 0);
    document.getElementById('totalRec').textContent = total;
    document.getElementById('storageUsed').textContent = formatBytes(bytes);
}

// ─── UTILS ─────────────────────────────────────────────────
function formatTime(s) {
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
}

function toast(msg, duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), duration);
}
