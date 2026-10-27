# Sawit — Klasifikasi Kematangan Buah

Aplikasi computer vision untuk memperkirakan tiga tingkat kematangan kelapa sawit dari foto: **Belum Masak**, **Masak**, dan **Terlalu Masak**. Model ResNet50 hasil fine-tuning dikonversi dari PyTorch ke ONNX dan dijalankan langsung di browser.

**[Buka demo](https://davaramdani.github.io/sawit-classifier/)**

## Fitur

- Unggah foto JPG, PNG, atau WEBP; mendukung drag-and-drop dan kamera.
- Prediksi kelas dan distribusi probabilitas.
- Pemrosesan di perangkat: foto tidak dikirim ke API atau server prediksi.
- Indikator unduhan model serta cache browser untuk kunjungan berikutnya.
- Tata letak responsif dan kontrol keyboard.

## Cara kerja

Pengunjung membuka halaman GitHub Pages, memilih foto, lalu menekan **Analisis foto**. Pada penggunaan pertama, browser memuat model sekitar **96 MB** dan runtime WebAssembly sekitar **12 MB**. Prediksi berjalan dalam Web Worker agar antarmuka tetap responsif. Cache model digunakan jika penyimpanan browser tersedia; browser dapat menghapus cache dan mode privat dapat membatasinya.

Preprocessing mengikuti aplikasi Flask: konversi RGB, resize bilinear dengan antialiasing ke 224 × 224, tensor NCHW, dan normalisasi ImageNet. Softmax menghasilkan probabilitas tiga kelas. Runtime memakai CPU/WASM satu thread sehingga tidak memerlukan GPU atau header cross-origin isolation.

## Menjalankan versi statis

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Buka `http://127.0.0.1:8000/`. Gunakan localhost atau HTTPS agar kamera, Web Worker, dan penyimpanan browser dapat digunakan. Tidak ada API key atau backend Python yang diperlukan saat memakai demo.

## Struktur

| Lokasi | Isi |
| --- | --- |
| `docs/` | Situs siap publikasi melalui GitHub Pages |
| `docs/models/` | Model ONNX dan manifest ukuran, kelas, serta SHA-256 |
| `docs/vendor/ort/` | ONNX Runtime Web 1.23.2 beserta lisensinya |
| `web/` | Sumber JavaScript untuk prediksi di browser |
| `templates/`, `static/` | Sumber desain bersama dan versi frontend Flask |
| `app.py` | Implementasi Flask/PyTorch awal sebagai referensi lokal |
| `scripts/` | Ekspor, pemeriksaan kesetaraan, dan build situs |

Checkpoint `model_resnet50_sawit.pth` tetap disimpan lokal dan diabaikan Git untuk menghindari duplikasi model besar. Versi deploy memakai file `.onnx` di `docs/models/`.

## Ekspor dan validasi

Dependensi ekspor tersedia di `requirements-export.txt` untuk Python 3.10. Gunakan environment terpisah. Simpan checkpoint asli di root proyek, kemudian jalankan:

```sh
python scripts/export_model.py
node scripts/validate_model.mjs
python scripts/build_site.py
```

Validasi memeriksa model ONNX native dan runtime WASM yang dikirim ke browser terhadap PyTorch pada empat foto lokal. Resize JavaScript dan tensor hasil normalisasi juga diperiksa terhadap Pillow/PyTorch. Hasil tercatat di `docs/validation-report.json`.

**Pemeriksaan ini menguji kesetaraan konversi, bukan akurasi pada test set.** Dekoder gambar browser dapat menghasilkan sedikit perbedaan dibanding Pillow, dan durasi prediksi bergantung pada perangkat pengunjung.

## Deployment GitHub Pages

Di pengaturan **Pages**, pilih **Deploy from a branch**, branch `main`, folder `/docs`. File `.nojekyll` sudah disertakan. Semua alamat aset menggunakan path relatif sehingga bekerja pada alamat proyek `/<repository>/`.

Setelah mengubah sumber desain atau JavaScript, jalankan `python scripts/build_site.py`, lalu commit sumber dan hasil build di `docs/`.

## Batasan

Ini adalah demo klasifikasi berbasis foto. Pencahayaan, sudut, latar, dan kualitas foto memengaruhi hasil. Sistem selalu memilih salah satu dari tiga kelas dan belum memiliki deteksi gambar di luar cakupan. Probabilitas model tidak sama dengan kepastian atau akurasi lapangan.

Model memerlukan unduhan awal yang cukup besar dan menggunakan memori perangkat. Foto dibatasi 10 MB serta 24 megapiksel pada versi browser. Bobot model yang dipublikasikan dapat diunduh oleh pengunjung.
