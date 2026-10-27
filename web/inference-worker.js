import * as ort from '../vendor/ort/ort.wasm.min.mjs';
import { resizeRGB, normalizeRGB, probabilitiesFromLogits } from './preprocess.js';

const modelBase = new URL('../models/', import.meta.url);
const CACHE_NAME = 'sawit-models-v1-' + modelBase.pathname;
ort.env.wasm.numThreads = 1; // GitHub Pages does not provide cross-origin isolation headers.
ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
let sessionPromise = null;
let metadata = null;
let activeJob = null;

let lastProgressAt = 0;
const progress = (id, text, percent = null, hint = '') => {
    const now = performance.now();
    if (percent !== null && percent !== 0 && percent !== 100 && now - lastProgressAt < 150) return;
    lastProgressAt = now;
    self.postMessage({ id, type: 'progress', text, percent, hint });
};

async function downloadModel(id, manifest) {
    const url = new URL(manifest.file, modelBase).href;
    let cache;
    try {
        cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(url);
        if (cached) {
            progress(id, 'Membuka model tersimpan…', null, 'Model ditemukan di penyimpanan browser.');
            const bytes = await cached.arrayBuffer();
            if (bytes.byteLength === manifest.bytes) return bytes;
            await cache.delete(url);
        }
    } catch { /* A full/disabled cache must not prevent analysis. */ }
    progress(id, 'Mengunduh model…', 0, 'Unduhan pertama sekitar ' + Math.ceil(manifest.bytes / 1000000) + ' MB. Foto tetap di perangkat ini.');
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Model belum dapat diunduh. Periksa koneksi dan coba lagi.');
    const bytes = new Uint8Array(manifest.bytes);
    let received = 0;
    if (response.body) {
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (received + value.length > bytes.length) {
                await reader.cancel();
                throw new Error('Ukuran model tidak sesuai. Muat ulang halaman dan coba lagi.');
            }
            bytes.set(value, received);
            received += value.length;
            progress(id, 'Mengunduh model…', Math.round(received / manifest.bytes * 100),
                (received / 1000000).toFixed(1) + ' / ' + (manifest.bytes / 1000000).toFixed(1) + ' MB · Foto tetap di perangkat ini.');
        }
    } else {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== bytes.length) throw new Error('Unduhan model belum lengkap. Silakan coba lagi.');
        bytes.set(new Uint8Array(buffer));
        received = bytes.length;
    }
    if (received !== manifest.bytes) throw new Error('Unduhan model terputus. Periksa koneksi dan coba lagi.');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('');
    if (digest !== manifest.sha256) throw new Error('Model yang diunduh tidak sesuai. Muat ulang halaman dan coba lagi.');
    if (cache) {
        try {
            await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
            for (const request of await cache.keys()) if (request.url !== url) await cache.delete(request);
        } catch { /* Quota restrictions are normal in private browsing. */ }
    }
    return bytes.buffer;
}

async function getSession(id) {
    if (!sessionPromise) {
        sessionPromise = (async () => {
            const response = await fetch(new URL('manifest.json', modelBase), { cache: 'no-cache' });
            if (!response.ok) throw new Error('Informasi model belum tersedia. Coba lagi sebentar.');
            const manifest = await response.json();
            if (manifest.schema !== 1 || manifest.inputShape?.join(',') !== '1,3,224,224'
                || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > 150000000
                || !/^[a-z0-9-]+\.onnx$/.test(manifest.file) || !/^[a-f0-9]{64}$/.test(manifest.sha256)
                || manifest.classes?.length !== 3) throw new Error('Konfigurasi model tidak sesuai.');
            metadata = manifest;
            const bytes = await downloadModel(id, manifest);
            progress(id, 'Menyiapkan analisis…', null, 'Menyiapkan model di perangkat. Halaman tetap bisa digunakan.');
            return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
        })().catch((error) => { sessionPromise = null; throw error; });
    }
    return sessionPromise;
}

self.onmessage = async ({ data }) => {
    const { id, photo } = data;
    if (activeJob !== null) {
        self.postMessage({ id, type: 'error', message: 'Analisis sebelumnya masih berjalan. Silakan coba lagi sebentar.' });
        return;
    }
    activeJob = id;
    let bitmap;
    try {
        const session = await getSession(id);
        progress(id, 'Membaca foto…', null, 'Prediksi dijalankan di perangkat. Foto tidak dikirim ke server.');
        bitmap = await createImageBitmap(photo, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        if (bitmap.width * bitmap.height > 24000000) throw new Error('Resolusi foto terlalu besar. Kecilkan menjadi maksimal 24 megapiksel, lalu coba lagi.');
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Browser belum mendukung pemrosesan foto ini. Coba browser terbaru.');
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
        const rgb = resizeRGB(pixels.data, bitmap.width, bitmap.height);
        const tensor = new ort.Tensor('float32', normalizeRGB(rgb, metadata.mean, metadata.std), metadata.inputShape);
        const feeds = { [session.inputNames[0]]: tensor };
        const output = await session.run(feeds);
        const result = probabilitiesFromLogits(output[session.outputNames[0]].data, metadata.classes);
        self.postMessage({ id, type: 'result', result });
    } catch (error) {
        const message = error instanceof TypeError && /fetch/i.test(error.message)
            ? 'Model belum dapat dimuat. Periksa koneksi dan coba lagi.'
            : error.message || 'Perangkat belum dapat menjalankan analisis. Coba muat ulang halaman.';
        self.postMessage({ id, type: 'error', message });
    } finally {
        if (bitmap) bitmap.close();
        activeJob = null;
    }
};
