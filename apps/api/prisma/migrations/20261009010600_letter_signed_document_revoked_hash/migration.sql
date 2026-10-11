-- Hash salinan bercap DICABUT dari naskah yang diarsipkan.
--
-- Pengenalan salinan bercap sebelumnya membuat ulang cap pada setiap permintaan
-- dan hanya memeriksa 200 tanda tangan tercabut terbaru. Begitu pencabutan
-- melewati 200, salinan resmi yang lebih tua dijawab "tidak terdaftar" oleh
-- halaman verifikasi publik. Kolom ini menyimpan hash salinan itu saat
-- pencabutan dicatat, sehingga pencocokan menjadi tepat dan tanpa batas.
--
-- NULL untuk pencabutan yang tercatat sebelum kolom ini ada.
ALTER TABLE "letter_signed_documents" ADD COLUMN "revoked_sha256" TEXT;
