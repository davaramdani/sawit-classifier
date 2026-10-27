// Match the Flask/Pillow bilinear resize, including downsampling antialiasing.
// Pillow uses normalized 22-bit coefficients and rounds after each pass.
function coefficients(inputSize, outputSize) {
    const scale = inputSize / outputSize;
    const filterScale = Math.max(1, scale);
    return Array.from({ length: outputSize }, (_, index) => {
        const center = (index + 0.5) * scale;
        const start = Math.max(0, Math.trunc(center - filterScale + 0.5));
        const end = Math.min(inputSize, Math.trunc(center + filterScale + 0.5));
        const weights = [];
        let sum = 0;
        for (let pixel = start; pixel < end; pixel++) {
            const weight = Math.max(0, 1 - Math.abs((pixel - center + 0.5) / filterScale));
            weights.push(weight);
            sum += weight;
        }
        return { start, weights: weights.map((weight) => Math.floor(weight / sum * 4194304 + 0.5)) };
    });
}

export function resizeRGB(rgba, width, height, outputWidth = 224, outputHeight = 224) {
    const horizontal = coefficients(width, outputWidth);
    const vertical = coefficients(height, outputHeight);
    const intermediate = new Uint8Array(outputWidth * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < outputWidth; x++) {
            const { start, weights } = horizontal[x];
            for (let channel = 0; channel < 3; channel++) {
                let sum = 2097152;
                for (let k = 0; k < weights.length; k++) sum += rgba[((y * width + start + k) * 4) + channel] * weights[k];
                intermediate[(y * outputWidth + x) * 3 + channel] = Math.min(255, Math.floor(sum / 4194304));
            }
        }
    }
    const output = new Uint8Array(outputWidth * outputHeight * 3);
    for (let y = 0; y < outputHeight; y++) {
        const { start, weights } = vertical[y];
        for (let x = 0; x < outputWidth; x++) {
            for (let channel = 0; channel < 3; channel++) {
                let sum = 2097152;
                for (let k = 0; k < weights.length; k++) sum += intermediate[((start + k) * outputWidth + x) * 3 + channel] * weights[k];
                output[(y * outputWidth + x) * 3 + channel] = Math.min(255, Math.floor(sum / 4194304));
            }
        }
    }
    return output;
}

export function normalizeRGB(rgb, mean, std) {
    const pixels = rgb.length / 3;
    const tensor = new Float32Array(rgb.length);
    for (let channel = 0; channel < 3; channel++) {
        const center = Math.fround(mean[channel]);
        const scale = Math.fround(std[channel]);
        for (let pixel = 0; pixel < pixels; pixel++) {
            // Match float32 rounding in ToTensor, subtraction, then division.
            const value = Math.fround(rgb[pixel * 3 + channel] / 255);
            tensor[channel * pixels + pixel] = Math.fround(Math.fround(value - center) / scale);
        }
    }
    return tensor;
}

export function probabilitiesFromLogits(logits, classes) {
    if (logits.length !== classes.length || !Array.from(logits).every(Number.isFinite)) {
        throw new Error('Hasil model tidak valid. Muat ulang halaman dan coba lagi.');
    }
    const maximum = Math.max(...logits);
    const exponentials = Array.from(logits, (value) => Math.exp(value - maximum));
    const denominator = exponentials.reduce((sum, value) => sum + value, 0);
    const values = exponentials.map((value) => value / denominator * 100);
    const winner = values.indexOf(Math.max(...values));
    return {
        prediction: classes[winner],
        probabilities: Object.fromEntries(classes.map((name, index) => [name, Math.round(values[index] * 100) / 100])),
    };
}
