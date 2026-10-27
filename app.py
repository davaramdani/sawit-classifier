from flask import Flask, render_template, request, jsonify
import torch
import torch.nn as nn
import torchvision.transforms as transforms
import torchvision.models as models
from PIL import Image
import io
import os

app = Flask(__name__)

# =============================================
# LOAD MODEL
# =============================================
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
class_names = ['Belum Masak', 'Masak', 'Terlalu Masak']
num_classes = 3

def load_model():
    model = models.resnet50(weights=None)
    in_features = model.fc.in_features
    model.fc = nn.Sequential(
        nn.Linear(in_features, 256),
        nn.ReLU(),
        nn.Dropout(0.4),
        nn.Linear(256, num_classes)
    )
    model.load_state_dict(torch.load('model_resnet50_sawit.pth', map_location=device))
    model.eval()
    return model.to(device)

model = load_model()

# =============================================
# TRANSFORM GAMBAR
# =============================================
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406],
                         [0.229, 0.224, 0.225])
])

# =============================================
# FUNGSI PREDIKSI (tanpa simpan file)
# =============================================
def predict_image(image_bytes):
    img = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    img_tensor = transform(img).unsqueeze(0).to(device)

    with torch.no_grad():
        outputs = model(img_tensor)
        probabilities = torch.nn.functional.softmax(outputs, dim=1)[0]
        predicted_idx = torch.argmax(probabilities).item()

    results = {
        class_names[i]: round(float(probabilities[i]) * 100, 2)
        for i in range(num_classes)
    }
    return class_names[predicted_idx], results

# =============================================
# ROUTES
# =============================================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/predict', methods=['POST'])
def predict():
    if 'file' not in request.files:
        return jsonify({'error': 'Tidak ada file yang diupload'})

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Tidak ada file yang dipilih'})

    # Baca langsung ke memori, tidak disimpan ke disk
    image_bytes = file.read()
    label, probabilities = predict_image(image_bytes)

    return jsonify({
        'prediction': label,
        'probabilities': probabilities
    })

if __name__ == '__main__':
    app.run(debug=True)
