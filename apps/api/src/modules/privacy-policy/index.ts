/**
 * Kebijakan Privasi publik (UU PDP 27/2022 Pasal 30, 35).
 *
 * Modul lain memanggil lewat barrel ini, bukan berkas layanan langsung
 * (AGENTS.md: "Modules talk through … another module's index.ts").
 */
export { default as privacyPolicyRoutes } from './privacy-policy.routes';
export {
  assertVersionExists,
  getCurrentPolicy,
  getCurrentVersionNumber,
  getVersion,
} from './privacy-policy.service';
