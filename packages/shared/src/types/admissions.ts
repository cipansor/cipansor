export interface DocumentOcrResult {
  success: boolean;
  documentType: string;
  /**
   * SHA-256 of the uploaded file bytes. Lets an officer tell two uploads apart
   * (and detect a re-used file) without keeping the image itself.
   */
  sha256?: string;
  extractedData: {
    nationalId?: string;
    familyCardNumber?: string;
    fullName?: string;
    birthPlace?: string;
    birthDate?: string;
  };
  validation: {
    matchScore: number;
    status: "WARNING" | "MISMATCH";
    /** True when the OCR engine was invoked for this upload. */
    ocrAttempted?: boolean;
    nationalIdMatch?: boolean;
    familyCardMatch?: boolean;
    fullNameMatch?: boolean;
    birthPlaceMatch?: boolean;
    birthDateMatch?: boolean;
    notes: string[];
  };
}

export interface DocumentParseRequest {
  imageBase64?: string;
  documentType: "ktp" | "kk" | "akta" | "foto" | "lainnya";
  userInputData?: {
    fullName?: string;
    /**
     * Other names the document may legitimately carry — the father, mother and
     * guardian from the form. A KTP may belong to any of them, so a name that
     * matches any candidate is a match, not a mismatch.
     */
    fullNameCandidates?: string[];
    nationalId?: string;
    familyCardNumber?: string;
    birthPlace?: string;
    birthDate?: string;
  };
}
