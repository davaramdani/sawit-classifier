"""Export the existing trusted ResNet50 checkpoint and verify its ONNX outputs."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from PIL import Image
from torch import nn
from torchvision import models, transforms

ROOT = Path(__file__).resolve().parents[1]
CLASSES = ["Belum Masak", "Masak", "Terlalu Masak"]
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]


def build_model(weights):
    model = models.resnet50(weights=None)
    model.fc = nn.Sequential(nn.Linear(model.fc.in_features, 256), nn.ReLU(),
                             nn.Dropout(0.4), nn.Linear(256, len(CLASSES)))
    # Only load checkpoints you trust: this file is the project's local checkpoint.
    model.load_state_dict(torch.load(str(weights), map_location="cpu"))
    return model.eval()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, default=ROOT / "model_resnet50_sawit.pth")
    args = parser.parse_args()
    torch.set_num_threads(2)
    torch.manual_seed(1337)
    model = build_model(args.weights)
    destination = ROOT / "docs" / "models"
    destination.mkdir(parents=True, exist_ok=True)
    temporary = destination / "export.onnx"
    torch.onnx.export(model, torch.zeros(1, 3, 224, 224), str(temporary),
                      input_names=["image"], output_names=["logits"],
                      opset_version=13, do_constant_folding=True)
    onnx.checker.check_model(str(temporary))
    session = ort.InferenceSession(str(temporary), providers=["CPUExecutionProvider"])
    preprocess = transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor(),
                                     transforms.Normalize(MEAN, STD)])
    checks = []
    fixtures_dir = ROOT / ".runtime" / "validation"
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    for image_path in sorted((ROOT / "static" / "uploads").glob("*")):
        if image_path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            continue
        with Image.open(image_path) as image:
            image = image.convert("RGB")
            tensor = preprocess(image).unsqueeze(0)
            with torch.no_grad():
                expected = model(tensor).numpy()
            actual = session.run(None, {"image": tensor.numpy()})[0]
            np.testing.assert_allclose(actual, expected, atol=2e-4, rtol=2e-4)
            assert int(actual.argmax()) == int(expected.argmax())
            probabilities = torch.softmax(torch.from_numpy(expected), dim=1)[0].numpy()
            checks.append({"file": image_path.name, "prediction": CLASSES[int(expected.argmax())],
                           "probabilities": [float(p * 100) for p in probabilities],
                           "max_logit_error": float(np.abs(actual - expected).max())})
            # Lossless fixtures isolate resizing/normalization from JPEG decoding in JS tests.
            fixture_name = "fixture-" + str(len(checks))
            image.save(fixtures_dir / (fixture_name + ".png"))
            (fixtures_dir / (fixture_name + ".rgba")).write_bytes(image.convert("RGBA").tobytes())
            resized = image.resize((224, 224), Image.Resampling.BILINEAR)
            resized.save(fixtures_dir / (fixture_name + "-resized.png"))
            (fixtures_dir / (fixture_name + ".rgb")).write_bytes(resized.tobytes())
            tensor.numpy().astype("<f4").tofile(fixtures_dir / (fixture_name + ".f32"))
            checks[-1]["logits"] = expected[0].tolist()
            checks[-1].update({"fixture": fixture_name, "width": image.width, "height": image.height})
    assert checks, "At least one image is needed to validate the export."
    digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
    output = destination / ("sawit-resnet50-" + digest[:12] + ".onnx")
    temporary.replace(output)
    metadata = {"schema": 1, "file": output.name, "sha256": digest,
                "bytes": output.stat().st_size, "classes": CLASSES,
                "inputShape": [1, 3, 224, 224], "mean": MEAN, "std": STD,
                "resize": "Pillow-compatible bilinear with antialiasing",
                "runtimeVersion": "1.23.2", "opset": 13}
    (destination / "manifest.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    report = {"torch": torch.__version__, "onnx": onnx.__version__,
              "onnxruntime": ort.__version__, "model_sha256": digest, "checks": checks}
    (fixtures_dir / "python-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"model": str(output), "bytes": output.stat().st_size,
                      "checks": checks}, indent=2), flush=True)


if __name__ == "__main__":
    main()
