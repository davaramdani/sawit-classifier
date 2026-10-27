let worker = null;
let serial = 0;
let pending = null;

function getWorker() {
    if (!worker) {
        if (!window.Worker || !window.WebAssembly || !window.OffscreenCanvas) {
            throw new Error('Browser ini belum mendukung analisis di perangkat. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru.');
        }
        worker = new Worker(new URL('./inference-worker.js', import.meta.url), { type: 'module' });
        const engine = worker;
        worker.onmessage = ({ data }) => {
            if (!pending || pending.id !== data.id) return;
            if (data.type === 'progress') pending.onProgress(data);
            else if (data.type === 'result') pending.resolve(data.result);
            else if (data.type === 'error') pending.reject(new Error(data.message));
        };
        worker.onerror = (event) => {
            event.preventDefault();
            if (worker !== engine) return;
            const job = pending;
            engine.terminate();
            worker = null;
            if (job) job.reject(new Error('Mesin analisis belum dapat dimuat. Periksa koneksi atau gunakan browser terbaru.'));
        };
    }
    return worker;
}

export async function predictPhoto(photo, { signal, onProgress = () => {} } = {}) {
    if (signal?.aborted) throw new DOMException('Analisis dibatalkan.', 'AbortError');
    if (pending) throw new Error('Analisis sebelumnya masih berjalan. Coba lagi sebentar.');
    const engine = getWorker();
    const id = ++serial;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            engine.terminate();
            worker = null;
            finish(reject, new Error('Persiapan model memerlukan waktu terlalu lama. Periksa koneksi dan coba lagi.'));
        }, 5 * 60 * 1000);
        const cancel = () => {
            engine.terminate();
            worker = null;
            finish(reject, new DOMException('Analisis dibatalkan.', 'AbortError'));
        };
        function finish(callback, value) {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', cancel);
            if (pending?.id === id) pending = null;
            callback(value);
        }
        pending = { id, onProgress,
            resolve: (value) => finish(resolve, value),
            reject: (error) => finish(reject, error) };
        signal?.addEventListener('abort', cancel, { once: true });
        engine.postMessage({ id, photo });
    });
}
