import { PDFDocument, PDFFont, StandardFonts, degrees, reduceRotation, rgb } from 'pdf-lib';
import { TEST_COPY_NOTE, TEST_COPY_STAMP } from '@cipansor/shared';
import { config } from '@/config';
import { Errors } from '@/middleware/error';

const ANGLE = 45;
const STAMP_SIZE = 34;
const NOTE_SIZE = 7.5;
/** Space kept between a marking's box and the edge of the visible page. */
const EDGE_MARGIN = 12;
/**
 * The smallest a marking is drawn. A page that cannot carry both markings at
 * least this large is refused, not stamped anyway: the bytes are signed and
 * archived, so a page without a readable warning is a test copy no one can tell
 * is one. It is also a correctness floor, not just legibility — pdf-lib's
 * `drawText` reads `options.size || this.fontSize`, so a fitted size of 0 would
 * be silently replaced by its 24pt default and drawn *outside* the tiny page.
 */
const MIN_MARK_SIZE = 4;
const RED = rgb(0.75, 0.1, 0.1);

/**
 * Maps a point given in the page's *displayed* coordinates back to the page's
 * own coordinate system, undoing the `/Rotate` a viewer applies and offsetting
 * by the CropBox origin.
 *
 * A viewer rotates the page clockwise by `/Rotate` before showing it. A mark
 * drawn at unrotated coordinates therefore lands somewhere else — on a 90° page
 * the note meant for the top edge appears down a side, and can fall outside the
 * visible area entirely. `(u, v)` are the displayed coordinates (origin at the
 * lower-left of what the reader sees); the result is the point to hand to
 * `page.drawText`, plus the angle the mark itself must be turned so it stays
 * upright to the reader.
 */
function displayedPointToPage(
  u: number,
  v: number,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number
): { x: number; y: number; angle: number } {
  const r = reduceRotation(rotation);
  const { x: cx, y: cy, width: w, height: h } = crop;
  if (r === 90) {
    return { x: cx + (w - v), y: cy + u, angle: 90 };
  }
  if (r === 180) {
    return { x: cx + (w - u), y: cy + (h - v), angle: 180 };
  }
  if (r === 270) {
    return { x: cx + v, y: cy + (h - u), angle: 270 };
  }
  return { x: cx + u, y: cy + v, angle: 0 };
}

/** The displayed width and height of a page once `/Rotate` is applied. */
function displayedSize(
  crop: { width: number; height: number },
  rotation: number
): { width: number; height: number } {
  const r = reduceRotation(rotation);
  return r === 90 || r === 270
    ? { width: crop.height, height: crop.width }
    : { width: crop.width, height: crop.height };
}

/**
 * Places a run of text so its whole box — not just its anchor or its midpoint —
 * sits inside a rectangle of `width` × `height`, centred, turned by `angle`.
 *
 * pdf-lib draws from the baseline's left end, so a long or diagonal run anchored
 * at the page's centre hangs past the edges even when its midpoint is well
 * inside. This computes the box the run will occupy (length `runWidth`, height
 * the font's, rising from the baseline) and shifts the anchor so the box is
 * centred; `size` is shrunk to fit inside the margin. `size` is returned as 0
 * when even `MIN_MARK_SIZE` cannot fit, so the caller can refuse the page
 * instead of drawing a marking larger than it — or one pdf-lib would silently
 * restore to its default size. The result is in the displayed coordinate system
 * — hand it to `displayedPointToPage`.
 */
function placeMark(
  font: PDFFont,
  text: string,
  size: number,
  angleDeg: number,
  width: number,
  height: number
): { x: number; y: number; size: number } {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  // The box scales linearly with the size, so one step fits it exactly: at any
  // size `s` it is `(L, H)·s/size`.
  const runWidth = font.widthOfTextAtSize(text, size);
  const runHeight = font.heightAtSize(size);
  const boxAtSize = runWidth * cos + runHeight * sin;
  const boxAtSizeHeight = runWidth * sin + runHeight * cos;
  const maxWidth = Math.max(width - 2 * EDGE_MARGIN, 0);
  const maxHeight = Math.max(height - 2 * EDGE_MARGIN, 0);
  const fit = Math.min(
    1,
    boxAtSize > 0 ? maxWidth / boxAtSize : 1,
    boxAtSizeHeight > 0 ? maxHeight / boxAtSizeHeight : 1
  );
  const finalSize = size * fit;
  if (finalSize < MIN_MARK_SIZE) return { x: 0, y: 0, size: 0 };

  const l = font.widthOfTextAtSize(text, finalSize);
  const h = font.heightAtSize(finalSize);
  const boxWidth = l * cos + h * sin;
  const boxHeight = l * sin + h * cos;
  // The run's box corners are `l·(cosA, sinA) + h·(−sinA, cosA)` for l∈{0,L},
  // h∈{0,H}; the minimum of each coordinate is the sum of the two minima, which
  // is where the box's lower-left corner sits relative to the anchor.
  const boxMinX = Math.min(0, l * Math.cos(a)) + Math.min(0, -h * Math.sin(a));
  const boxMinY = Math.min(0, l * Math.sin(a)) + Math.min(0, h * Math.cos(a));
  return {
    x: width / 2 - boxMinX - boxWidth / 2,
    y: height / 2 - boxMinY - boxHeight / 2,
    size: finalSize,
  };
}

/**
 * Stamps every page of a document from a test copy of the system
 * (`config.documents.testCopy`, staging): "SALINAN UJI — BUKAN DOKUMEN SAH"
 * across the page and a line at its top saying where it came from.
 *
 * Called just before a document is saved. For a naskah dinas that is before it
 * is signed, so the signed bytes carry the stamp and no copy of the file exists
 * without it. Off — and the bytes exactly as before — everywhere else.
 */
export async function stampIfTestCopy(pdfDoc: PDFDocument): Promise<void> {
  if (!config.documents.testCopy) return;

  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const page of pdfDoc.getPages()) {
    // The viewer shows the CropBox, not the MediaBox, and rotates the page by
    // /Rotate. `page.getSize()` measures the MediaBox, so a mark placed with it
    // can sit outside what a reader actually sees — present in the signed bytes
    // but invisible on screen. Place every mark inside the CropBox, expressed in
    // the page's own coordinates.
    const crop = page.getCropBox();
    const rotation = page.getRotation().angle;
    // Place marks using what the reader actually sees: the CropBox size, turned
    // by the page's own rotation.
    const { width, height } = displayedSize(crop, rotation);

    // The diagonal stamp, centred: its whole turned box is kept inside the
    // visible area, shrunk if the page is too small for it at full size.
    const stamp = placeMark(bold, TEST_COPY_STAMP, STAMP_SIZE, ANGLE, width, height);
    // The note along the top edge, its box clear of the corner by the margin.
    const note = placeMark(regular, TEST_COPY_NOTE, NOTE_SIZE, 0, width, height);

    /**
     * A page too small for both markings is refused, not stamped anyway.
     *
     * Below `MIN_MARK_SIZE` the fitted size reaches 0, and pdf-lib's `drawText`
     * reads `options.size || this.fontSize` — so it would draw at its 24pt
     * default, outside a page this small, leaving a signed and archived page
     * whose warning no one can read. Refusing the document is the honest
     * failure: the switch is on precisely so no test copy goes out unmarked.
     * `badRequest` because the page came from the drafter's own upload, so the
     * fix is theirs — a normally sized page — not a server fault.
     */
    if (stamp.size === 0 || note.size === 0) {
      throw Errors.badRequest(
        `Salinan uji tidak dapat dicap: halaman ${Math.round(width)}×${Math.round(height)}pt ` +
          'terlalu kecil untuk memuat tanda "SALINAN UJI". Unggah PDF dengan ukuran ' +
          'halaman yang wajar.'
      );
    }

    const stampAt = displayedPointToPage(stamp.x, stamp.y, crop, rotation);
    page.drawText(TEST_COPY_STAMP, {
      x: stampAt.x,
      y: stampAt.y,
      size: stamp.size,
      font: bold,
      color: RED,
      opacity: 0.22,
      // `ANGLE` is the diagonal; `stampAt.angle` undoes the page's own /Rotate
      // so the diagonal still reads the same way to the viewer.
      rotate: degrees(ANGLE + stampAt.angle),
    });

    const noteAt = displayedPointToPage(
      note.x,
      height - EDGE_MARGIN - regular.heightAtSize(note.size),
      crop,
      rotation
    );
    page.drawText(TEST_COPY_NOTE, {
      x: noteAt.x,
      y: noteAt.y,
      size: note.size,
      font: regular,
      color: RED,
      rotate: degrees(noteAt.angle),
    });
  }
}
