// Run the shipped WASM engine and JS preprocessing against PyTorch/Pillow fixtures.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import * as ort from '../docs/vendor/ort/ort.wasm.min.mjs';
import { resizeRGB, normalizeRGB, probabilitiesFromLogits } from '../web/preprocess.js';

const read = (path) => readFile(new URL(path, import.meta.url));
const manifest = JSON.parse(await read('../docs/models/manifest.json'));
const fixtures = JSON.parse(await read('../.runtime/validation/python-report.json'));
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('../docs/vendor/ort/', import.meta.url).href;
const model = await read('../docs/models/' + manifest.file);
const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
const results = [];
for (const test of fixtures.checks) {
    const prefix = '../.runtime/validation/' + test.fixture;
    const original = new Uint8Array(await read(prefix + '.rgba'));
    const expectedRGB = new Uint8Array(await read(prefix + '.rgb'));
    const rgb = resizeRGB(original, test.width, test.height);
    assert.deepEqual(rgb, expectedRGB, test.fixture + ': resized pixels differ from Pillow');
    const expectedBytes = await read(prefix + '.f32');
    const expectedTensor = new Float32Array(expectedBytes.buffer.slice(expectedBytes.byteOffset, expectedBytes.byteOffset + expectedBytes.byteLength));
    const input = normalizeRGB(rgb, manifest.mean, manifest.std);
    assert.deepEqual(input, expectedTensor, test.fixture + ': normalized tensor differs from PyTorch');
    const start = performance.now();
    const output = await session.run({ image: new ort.Tensor('float32', input, manifest.inputShape) });
    const elapsed = Math.round(performance.now() - start);
    const logits = output.logits.data;
    const result = probabilitiesFromLogits(logits, manifest.classes);
    assert.equal(result.prediction, test.prediction);
    const error = Math.max(...Array.from(logits, (value, index) => Math.abs(value - test.logits[index])));
    assert(error < 2e-4, 'WASM logits differ from PyTorch: ' + error);
    results.push({ fixture: test.fixture, prediction: result.prediction,
        maxLogitError: error, inferenceMs: elapsed, pillowPixelsExact: true, normalizedTensorExact: true });
}
const report = { modelSHA256: manifest.sha256, runtime: 'onnxruntime-web ' + manifest.runtimeVersion + ' WASM (Node.js)',
    note: 'Conversion parity on local fixtures, not a test-set accuracy measurement. Browser timings depend on the device.', results };
await writeFile(new URL('../docs/validation-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
