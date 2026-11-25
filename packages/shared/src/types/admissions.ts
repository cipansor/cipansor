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
    nationalId?: string;
    familyCardNumber?: string;
    birthPlace?: string;
    birthDate?: string;
  };
}
