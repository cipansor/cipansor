/**
 * Who may change the yayasan's own profile (`PUT /foundation/:id`): Super
 * Admin and the Pengurus officers who keep its records, the Ketua and the
 * Sekretaris. The other organs read it. The API guards the route with this
 * list and the portal shows the "Edit" button only to it.
 */
export const FOUNDATION_WRITER_ROLE_CODES: readonly string[] = [
  "SUPER_ADMIN",
  "YAYASAN_KETUA",
  "YAYASAN_SEKRETARIS",
];
