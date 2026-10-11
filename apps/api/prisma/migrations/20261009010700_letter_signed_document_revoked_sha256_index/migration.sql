-- Indeks untuk pencocokan salinan bercap DICABUT.
--
-- `matchRevokedCopy` mencocokkan berkas yang diunggah lewat
-- `letter_signed_documents.revoked_sha256 = ?`. Tanpa indeks, itu pemindaian
-- penuh tabel arsip pada setiap unggahan verifikasi publik — jadi "tepat dan
-- tanpa batas" hanya berarti "seluruh tabel", bukan murah.
CREATE INDEX "letter_signed_documents_revoked_sha256_idx"
  ON "letter_signed_documents"("revoked_sha256");
