# next-image-optimizer-dead

> `/_next/image` has never resized anything here: `sharp` does not resolve in the standalone output, and the build ships the glibc binary to a musl runner. Ship images at display size until the runtime image is fixed.

Found 2026-08-17. Every `/_next/image` request returns the **source file
unchanged**, at every width, in the original format:

```
original /images/cipansor/galeri-1.webp = 156,656 bytes
  ?w=256 → 156656   ?w=640 → 156656   ?w=1080 → 156656   ?w=1920 → 156656
/logo.png ?w=128 with Accept: image/avif → 200 image/png 34998
```

Not the CDN (the container answers the same) and not a cache miss
(`X-Nextjs-Cache: HIT`). The optimiser runs and produces nothing. Two causes,
both in the runner image:

1. Next's standalone trace does not pick `sharp` up — it is loaded at runtime,
   not imported — so `require.resolve("sharp")` fails from the app directory.
2. The binary installed at build time is the **glibc** one; the runner is
   `node:26-alpine` (**musl**): `Could not load the "sharp" module using the
   linuxmusl-x64 runtime`.

The Dockerfile comment about "next/image writes optimised variants here" and
the image-cache volume both describe something that has never happened.

**The working rule:** ship files at the size they will be displayed.
`galleryThumb()` in `packages/shared/src/public-site.ts` is the pattern — a
real 560 px derivative next to the 1400 px original, chosen at the call site.
That is why `/galeri` costs 484 KB instead of 2.3 MB. Anything that assumes
`next/image` will resize for it is wrong.

**The repair, when someone takes it:** install `sharp` for musl in the runner
stage (`npm i --no-save sharp --cpu=x64 --os=linux --libc=musl`, resolvable
from `apps/web`) or move the runner to a glibc base. It is a runtime-image
change — verify with the width probe above and watch the image size
([docker-image-size-traps](./docker-image-size-traps.md)).

Also: `robots.txt` is served by **Cloudflare**, not the repo, and has no
`Sitemap:` line, so `/sitemap.xml` is found only through Search Console. A
repo-side `robots.ts` would be shadowed.
