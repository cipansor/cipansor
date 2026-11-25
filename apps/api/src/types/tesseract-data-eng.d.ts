/**
 * `@tesseract.js-data/eng` ships only CommonJS JavaScript (no types). It exports
 * the language code, whether the traineddata is gzipped, and the absolute path
 * to the traineddata directory. Declared here so the OCR service can import it
 * without a `require`.
 */
declare module '@tesseract.js-data/eng' {
  const engData: {
    code: string;
    gzip: boolean;
    langPath: string;
  };
  export = engData;
}
