/**
 * Permintaan hak subjek data (UU 27/2022 Pasal 30, 32, 33, 35, 40, 43–44).
 *
 * Modul lain memanggil lewat barrel ini, bukan berkas layanan langsung
 * (AGENTS.md: "Modules talk through … another module's index.ts").
 */
export { default as dataSubjectRequestRoutes } from './data-subject-requests.routes';
export {
  computeDueAt,
  getRequest,
  listRequests,
  maskContact,
  submitGuardianRequest,
  submitPublicRequest,
  updateStatus,
  verifyPublicRequest,
} from './data-subject-requests.service';
