# WARAS AI

**W**awasan **A**nalisis **R**aga dan **S**ikap: pelatih kebugaran virtual yang mengoreksi squat secara real-time dari kamera.
Metode: Chen et al. (2026), *Non-Standard Squat Posture Detection Method Using Human Skeleton*, Computers 15(5):293, doi:10.3390/computers15050293.

Cara kerjanya: MediaPipe Pose jalan **di browser** → sudut panggul & lutut (hukum cosinus) → 2 cek per repetisi:
1. koordinasi: `|panggul − (k·lutut + b)| ≤ tol` (regresi linear, toleransi 3σ maks 15°)
2. kedalaman: di titik terendah, panggul tidak lebih tinggi dari lutut − `delta`·panjang paha

Tidak ada server ML dan tidak ada GPU, jadi semuanya gratis.

| File | Isi |
|---|---|
| `lib/squat.ts` | rumus sudut, deteksi repetisi, evaluasi (inti logika) |
| `lib/waras_params.json` | angka hasil fitting Colab (`k, b, tol, delta, minPassRatio`) |
| `app/page.tsx` | halaman kamera + feedback |
| `colab/waras_fit.ipynb` | fitting parameter dari data Zenodo paper |

## Jalankan lokal
```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test       # self-check logika squat
```

## "Training" di Google Colab (gratis)
1. Buka https://colab.research.google.com → **File → Upload notebook** → pilih `colab/waras_fit.ipynb`.
2. Unduh data skeleton dari Zenodo (link di bagian *Data Availability* artikel).
3. **Runtime → Run all**. Di sel upload, pilih file CSV/ZIP Zenodo.
4. Sel 2 (`load_clip`): sesuaikan nama kolom dengan isi CSV (lihat preview di sel 1). Ini satu-satunya bagian yang perlu diedit.
5. Cek akurasi di sel validasi, lalu `waras_params.json` otomatis terunduh.
6. Ganti `lib/waras_params.json` di repo dengan file itu.

Runtime CPU biasa cukup; tidak perlu GPU.

## Hosting di Vercel (gratis, paket Hobby)
1. Push repo ke GitHub.
2. Buka https://vercel.com → login pakai GitHub → **Add New → Project** → pilih repo ini → **Deploy** (Next.js & pnpm terdeteksi otomatis, tidak perlu setting apa pun).
3. Buka URL `*.vercel.app` di HP atau laptop, izinkan kamera. Vercel sudah HTTPS, jadi akses kamera jalan.
4. Setiap push ke GitHub (mis. parameter baru dari Colab) otomatis deploy ulang.

Catatan: paket Hobby khusus penggunaan non-komersial (tugas, riset, portofolio aman).

## Tips pemakaian
Kamera setinggi pinggang, badan **menyamping**, jarak 2–3 m, bahu sampai pergelangan kaki terlihat. Angka bawaan di `waras_params.json` diambil dari paper; `delta` dan `minPassRatio` masih tebakan sampai notebook dijalankan dengan data Zenodo.
