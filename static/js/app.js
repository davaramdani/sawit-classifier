'use strict';

const $ = (id) => document.getElementById(id);
const tabs = { upload: $('uploadTab'), camera: $('cameraTab') };
const classNames = ['Belum Masak', 'Masak', 'Terlalu Masak'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
let source = 'upload';
let uploadFile = null;
let capturedBlob = null;
let uploadUrl = null;
let captureUrl = null;
let stream = null;
let cameraRequest = 0;
let photoVersion = 0;
let activeRequest = null;
let sampleRequest = null;
let busy = false;
let photoLoading = false;

function showError(message) {
    $('errorMessage').textContent = message;
    $('errorMessage').hidden = !message;
}

function currentPhoto() {
    return source === 'upload' ? uploadFile : capturedBlob;
}

function updateControls() {
    $('analyzeBtn').disabled = busy || photoLoading || !currentPhoto();
    $('analyzeText').textContent = busy ? 'Membaca foto…' : 'Analisis foto';
    $('analyzeBtn').querySelector('.icon').toggleAttribute('hidden', busy);
    $('analyzeBtn').querySelector('.spinner').hidden = !busy;
    $('clearPhotoBtn').hidden = !currentPhoto();
    $('fileName').textContent = currentPhoto()
        ? (source === 'upload' ? uploadFile.name : 'Foto dari kamera')
        : (source === 'upload' ? 'Belum ada foto dipilih' : 'Belum ada foto diambil');
    $('resultPanel').setAttribute('aria-busy', String(busy));
}

function clearResult() {
    $('resultEmpty').hidden = false;
    $('resultContent').hidden = true;
    $('clearResultBtn').hidden = true;
    $('predictionLabel').textContent = '';
    $('confidenceValue').textContent = '';
    $('resultStatus').textContent = currentPhoto() ? 'Siap dianalisis' : 'Menunggu foto';
    $('resultStatus').dataset.state = 'idle';
    document.querySelectorAll('.prob-item').forEach((row) => {
        row.querySelector('.prob-value').textContent = '—';
        row.querySelector('.prob-fill').style.width = '0%';
        row.classList.remove('is-top');
    });
}

// A changed photo invalidates any result still in flight.
function invalidatePrediction() {
    photoVersion++;
    if (activeRequest) activeRequest.abort();
    activeRequest = null;
    busy = false;
    photoLoading = false;
    clearResult();
    showError('');
    updateControls();
}

function stopCamera() {
    cameraRequest++;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    $('video').srcObject = null;
    $('video').hidden = true;
    $('captureBtn').hidden = true;
    $('captureBtn').disabled = true;
    $('cameraPrompt').hidden = !!capturedBlob;
    $('startCameraBtn').disabled = false;
    $('startCameraBtn').textContent = 'Buka kamera';
}

function switchTab(nextSource, focus = false) {
    if (source !== nextSource) {
        if (sampleRequest) sampleRequest.abort();
        stopCamera();
        source = nextSource;
        Object.entries(tabs).forEach(([name, tab]) => {
            const selected = name === source;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        $('uploadPanel').hidden = source !== 'upload';
        $('cameraPanel').hidden = source !== 'camera';
        invalidatePrediction();
    }
    if (focus) tabs[source].focus();
}

Object.entries(tabs).forEach(([name, tab]) => {
    tab.addEventListener('click', () => switchTab(name));
    tab.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 'upload' : event.key === 'End' ? 'camera' : name === 'upload' ? 'camera' : 'upload';
            switchTab(next, true);
        }
    });
});

async function selectPhoto(file) {
    if (!file) return;
    invalidatePrediction();
    if (!allowedTypes.includes(file.type)) {
        showError('Pilih foto berformat JPG, PNG, atau WEBP.');
        return;
    }
    if (file.size > MAX_FILE_SIZE) {
        showError('Ukuran foto melebihi 10 MB. Kecilkan foto, lalu coba lagi.');
        return;
    }
    const version = photoVersion;
    photoLoading = true;
    updateControls();
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
        image.src = objectUrl;
        await image.decode();
        if (version !== photoVersion) {
            URL.revokeObjectURL(objectUrl);
            return;
        }
        if (uploadUrl) URL.revokeObjectURL(uploadUrl);
        uploadUrl = objectUrl;
        uploadFile = file;
        $('previewImg').src = objectUrl;
        $('previewImg').hidden = false;
        $('uploadPrompt').hidden = true;
        $('changeOverlay').hidden = false;
        $('uploadBox').classList.add('has-photo');
        clearResult();
        $('liveStatus').textContent = 'Foto siap dianalisis.';
    } catch {
        URL.revokeObjectURL(objectUrl);
        if (version === photoVersion) showError('Foto tidak dapat dibaca. Pilih gambar lain yang masih utuh.');
    } finally {
        if (version === photoVersion) {
            photoLoading = false;
            updateControls();
        }
    }
}

$('uploadBox').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (event) => {
    if (sampleRequest) sampleRequest.abort();
    selectPhoto(event.target.files[0]);
    event.target.value = '';
});
['dragenter', 'dragover'].forEach((name) => $('uploadBox').addEventListener(name, (event) => {
    event.preventDefault();
    $('uploadBox').classList.add('drag-over');
}));
['dragleave', 'drop'].forEach((name) => $('uploadBox').addEventListener(name, (event) => {
    event.preventDefault();
    $('uploadBox').classList.remove('drag-over');
}));
$('uploadBox').addEventListener('drop', (event) => {
    if (sampleRequest) sampleRequest.abort();
    selectPhoto(event.dataTransfer.files[0]);
});

$('sampleBtn').addEventListener('click', async () => {
    switchTab('upload');
    if (sampleRequest) sampleRequest.abort();
    const controller = new AbortController();
    sampleRequest = controller;
    $('sampleBtn').disabled = true;
    showError('');
    try {
        const response = await fetch($('sampleBtn').dataset.src, { signal: controller.signal });
        if (!response.ok) throw new Error('Foto contoh belum dapat dimuat. Coba unggah foto dari perangkat.');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        await selectPhoto(new File([blob], 'contoh-sawit.jpg', { type: 'image/jpeg' }));
    } catch (error) {
        if (error.name !== 'AbortError') showError(error.message);
    } finally {
        if (sampleRequest === controller) {
            sampleRequest = null;
            $('sampleBtn').disabled = false;
        }
    }
});

$('clearPhotoBtn').addEventListener('click', () => {
    if (sampleRequest) sampleRequest.abort();
    if (source === 'upload') {
        uploadFile = null;
        if (uploadUrl) URL.revokeObjectURL(uploadUrl);
        uploadUrl = null;
        $('previewImg').removeAttribute('src');
        $('previewImg').hidden = true;
        $('uploadPrompt').hidden = false;
        $('changeOverlay').hidden = true;
        $('uploadBox').classList.remove('has-photo');
    } else {
        capturedBlob = null;
        if (captureUrl) URL.revokeObjectURL(captureUrl);
        captureUrl = null;
        $('capturedImg').removeAttribute('src');
        $('capturedImg').hidden = true;
        $('retakeBtn').hidden = true;
        stopCamera();
    }
    invalidatePrediction();
});

async function startCamera() {
    showError('');
    if (!navigator.mediaDevices?.getUserMedia) {
        showError('Kamera tidak tersedia di browser ini. Gunakan unggah foto, atau buka halaman melalui HTTPS / localhost.');
        return;
    }
    stopCamera();
    const requestId = cameraRequest;
    $('startCameraBtn').disabled = true;
    $('startCameraBtn').textContent = 'Menghubungkan…';
    try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (requestId !== cameraRequest || source !== 'camera') {
            cameraStream.getTracks().forEach((track) => track.stop());
            return;
        }
        stream = cameraStream;
        capturedBlob = null;
        if (captureUrl) URL.revokeObjectURL(captureUrl);
        captureUrl = null;
        $('capturedImg').hidden = true;
        $('retakeBtn').hidden = true;
        $('video').srcObject = stream;
        $('video').hidden = false;
        $('cameraPrompt').hidden = true;
        await $('video').play();
        if (requestId !== cameraRequest || source !== 'camera') return;
        $('captureBtn').hidden = false;
        $('captureBtn').disabled = !$('video').videoWidth;
        invalidatePrediction();
    } catch (error) {
        if (requestId !== cameraRequest) return;
        stopCamera();
        showError(error.name === 'NotAllowedError'
            ? 'Izin kamera belum diberikan. Izinkan kamera di browser atau gunakan unggah foto.'
            : 'Kamera belum dapat dibuka. Periksa perangkat kamera atau gunakan unggah foto.');
    } finally {
        if (requestId === cameraRequest) {
            $('startCameraBtn').disabled = false;
            $('startCameraBtn').textContent = 'Buka kamera';
        }
    }
}

$('startCameraBtn').addEventListener('click', startCamera);
$('retakeBtn').addEventListener('click', startCamera);
$('video').addEventListener('loadeddata', () => {
    $('captureBtn').disabled = !$('video').videoWidth;
});
$('captureBtn').addEventListener('click', () => {
    const video = $('video');
    if (!video.videoWidth || !video.videoHeight || !stream) return;
    const requestId = cameraRequest;
    $('captureBtn').disabled = true;
    $('canvas').width = video.videoWidth;
    $('canvas').height = video.videoHeight;
    $('canvas').getContext('2d').drawImage(video, 0, 0);
    $('canvas').toBlob((blob) => {
        if (requestId !== cameraRequest || source !== 'camera') return;
        if (!blob) {
            $('captureBtn').disabled = false;
            showError('Foto belum berhasil diambil. Silakan coba lagi.');
            return;
        }
        capturedBlob = blob;
        if (captureUrl) URL.revokeObjectURL(captureUrl);
        captureUrl = URL.createObjectURL(blob);
        $('capturedImg').src = captureUrl;
        $('capturedImg').hidden = false;
        $('retakeBtn').hidden = false;
        stopCamera();
        invalidatePrediction();
        $('liveStatus').textContent = 'Foto kamera siap dianalisis.';
    }, 'image/jpeg', 0.92);
});

$('analyzeBtn').addEventListener('click', async () => {
    const photo = currentPhoto();
    if (!photo || busy || photoLoading) return;
    invalidatePrediction();
    const version = photoVersion;
    const controller = new AbortController();
    activeRequest = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
    busy = true;
    updateControls();
    $('resultStatus').textContent = 'Sedang membaca';
    $('resultStatus').dataset.state = 'loading';
    $('liveStatus').textContent = 'Analisis foto sedang berlangsung.';
    const formData = new FormData();
    formData.append('file', photo, source === 'upload' ? uploadFile.name : 'capture.jpg');
    try {
        const response = await fetch('/predict', { method: 'POST', body: formData, signal: controller.signal });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) throw new Error('Server belum dapat membaca foto ini. Coba foto lain atau ulangi sebentar lagi.');
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || 'Analisis belum berhasil. Silakan coba lagi.');
        if (!classNames.includes(data.prediction) || !data.probabilities || !classNames.every((name) => typeof data.probabilities[name] === 'number' && Number.isFinite(data.probabilities[name]) && data.probabilities[name] >= 0 && data.probabilities[name] <= 100)) throw new Error('Hasil analisis belum lengkap. Silakan ulangi.');
        if (version !== photoVersion) return;
        $('resultEmpty').hidden = true;
        $('resultContent').hidden = false;
        $('clearResultBtn').hidden = false;
        $('predictionLabel').textContent = data.prediction;
        $('confidenceValue').textContent = `${data.probabilities[data.prediction].toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
        document.querySelectorAll('.prob-item').forEach((row) => {
            const name = row.dataset.class;
            const value = data.probabilities[name];
            row.querySelector('.prob-value').textContent = `${value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
            row.querySelector('.prob-fill').style.width = `${value}%`;
            row.classList.toggle('is-top', name === data.prediction);
        });
        $('resultStatus').textContent = 'Analisis selesai';
        $('resultStatus').dataset.state = 'done';
        $('liveStatus').textContent = `Analisis selesai. Perkiraan kematangan: ${data.prediction}.`;
        if (window.matchMedia('(max-width: 700px)').matches) $('resultPanel').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    } catch (error) {
        if (version !== photoVersion) return;
        clearResult();
        if (timedOut) showError('Analisis memerlukan waktu terlalu lama. Silakan coba lagi.');
        else if (error.name !== 'AbortError') showError(error instanceof TypeError ? 'Koneksi ke server terputus. Periksa koneksi, lalu coba lagi.' : error.message);
        $('liveStatus').textContent = 'Analisis belum berhasil.';
    } finally {
        clearTimeout(timeout);
        if (activeRequest === controller) {
            activeRequest = null;
            busy = false;
            updateControls();
        }
    }
});

$('clearResultBtn').addEventListener('click', clearResult);
window.addEventListener('pagehide', () => {
    stopCamera();
    if (activeRequest) activeRequest.abort();
    if (sampleRequest) sampleRequest.abort();
});
updateControls();
