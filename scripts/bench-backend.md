# Benchmark backend lokal

Jalankan dari root repository:

```sh
pnpm bench:backend
pnpm test:bench
```

Memerlukan Linux, Docker daemon dengan dukungan batas CPU/memori, Node sesuai `package.json`, Java 21+, dan dependency pnpm yang sudah terpasang. Build image menggunakan Dockerfile backend yang ada; tidak menambahkan dependency. Build/download emulator termasuk setup, di luar target pengukuran sekitar 8–10 menit.

Runner menolak port terpakai: API 18787, Auth 39099, Firestore 38080, websocket 39150, hub 39400, logging 39500. Emulator memakai project `demo-oi-benchmark` dengan data sementara: satu organisasi, 20 material, 10 mesin, 100 RFQ sintetis. Token berasal dari Auth Emulator. Tiap klien menggunakan RFQ berbeda.

API memakai satu image production yang sama untuk profil 1 vCPU/512 MiB dan 2 vCPU/1 GiB, tanpa watch, dengan swap dibatasi sama dengan RAM (tanpa tambahan swap). Container hanya bergabung ke network Docker `--internal`, sehingga tidak memiliki rute keluar. Emulator hanya mendengarkan gateway network tersebut. Generator beban mengakses IP bridge container pada port 18787; API tidak diterbitkan ke LAN. File `.env.local`, kredensial provider, dan konfigurasi aplikasi utama tidak dimuat. Emulator, container, dan network dihentikan/dihapus melalui `finally`, termasuk ketika menerima SIGINT/SIGTERM. Image dan artefak hasil disimpan agar hasil bisa ditelusuri. Stack `pnpm dev` tetap berjalan.

Setiap profil menjalankan tiga percobaan startup lokal. Percobaan ketiga dilanjutkan ke beban; tidak ada pergantian image. Request bisnis pertama berupa estimasi lead time terautentikasi. Waktu startup dihitung dari sebelum `docker run` sampai health siap, dengan polling 100 ms. Ini bukan cold start platform.

Beban bisnis memakai siklus empat estimasi lead time dan satu update quotation per klien, berurutan tanpa jeda. Untuk setiap profil: concurrency 1 → 5 → 10, dua ulangan, masing-masing 5 detik pemanasan + 30 detik pengukuran. Baseline `/health` terpisah diukur **5 detik** pada tiap tahap, tanpa pemanasan khusus, agar total putaran sekitar 8–10 menit. Siklus terakhir bisa terpotong sehingga rasio aktual tidak persis 80/20; jumlah per endpoint dilaporkan. Timeout 10 detik; request yang sedang berjalan ditunggu, dan waktu drain masuk denominator throughput. Tidak ada retry dari generator; retry SDK Firestore merupakan bagian pekerjaan server.

Laporan Markdown dan JSON berada di `.local/benchmarks/backend/<run-id>/`, bersama log build, emulator, dan tiap container. JSON menyimpan konfigurasi image/mesin, status awal working tree, ringkasan endpoint, status HTTP/error/timeout, serta sampel Docker dengan timestamp dan tahap. Latency mencakup semua percobaan; p99 diberi penanda jika sampel <1.000. CPU Docker 100% berarti satu core. Memori adalah working set menurut Docker, tidak mencakup emulator. Biaya generator, emulator, dan layanan host lain tetap dapat memengaruhi hasil.

Respons lead time harus tepat satu hari sesuai fixture, respons lainnya harus `{ ok: true }`. Runner memeriksa quotation terakhir di Firestore setelah setiap tahap dan menolak hasil dengan error autentikasi, respons salah, restart/OOM, atau kegagalan efek internal di log. Jalur efek quotation tetap dijalankan; pada implementasi sekarang quotation tidak membuat notifikasi manufacturer dan email dilewati karena kredensial kosong.

Kesimpulan menggunakan pemeriksaan sederhana: throughput C=10 yang naik kurang dari 10% dibanding C=5 ditandai mendatar; jika CPU rata-rata bisnis C=10 juga mencapai 85% kuota, ditandai indikasi jenuh CPU lokal. Ini indikasi, bukan bukti batas pasti. Jika CPU belum jenuh, laporan menyatakan “batas belum ditemukan”; plateau tanpa CPU tinggi memerlukan pemeriksaan emulator/host.

Hasil closed loop pada concurrency maksimum 10 merupakan baseline lokal, bukan kapasitas Firebase production atau jumlah pengguna nyata. Tidak mencakup UI, slicer, latensi provider AI, autoscaling, jaringan antarregion, atau cold start Cloud Run. Perbedaan transaksi, indeks, dan batas emulator berlaku: [Cloud Run lokal](https://docs.cloud.google.com/run/docs/testing/local), [Firestore Emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_emulator_differs_from_production).
