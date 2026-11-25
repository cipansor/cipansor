"use client";

import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Camera, Upload, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { DocumentOcrResult, DocumentParseRequest } from "@cipansor/shared";
import { useParseDocument } from "@/hooks/use-admissions";
import type { SpmbFormContent } from "@/config/spmb-form.i18n";

interface DocumentCaptureFieldProps {
  label: string;
  /** The field's own words, in the public page's language. */
  content: SpmbFormContent["documents"];
  documentType: DocumentParseRequest["documentType"];
  file: File | null;
  onFileSelect: (file: File) => void;
  userInputData?: DocumentParseRequest["userInputData"];
  onOcrExtracted?: (extracted: DocumentOcrResult["extractedData"]) => void;
  onOcrResult?: (
    result: {
      status: DocumentOcrResult["validation"]["status"];
      /** The API's Indonesian notes, stored for the Indonesian staff portal. */
      notes: string[];
    } | null,
  ) => void;
}

export function DocumentCaptureField({
  label,
  content,
  documentType,
  file,
  onFileSelect,
  userInputData,
  onOcrExtracted,
  onOcrResult,
}: DocumentCaptureFieldProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const parseDocument = useParseDocument();
  const [isParsing, setIsParsing] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<
    | (Partial<DocumentOcrResult["validation"]> & { hasExtracted?: boolean })
    | null
  >(null);

  // The API's own `notes` are Indonesian prose; the public form speaks three
  // languages. Render the structured verdict in the reader's language instead.
  const localizedNotes = (status: NonNullable<typeof ocrStatus>): string[] => {
    if (!status.hasExtracted) {
      // `ocrAttempted` separates a failed engine run from a document that was
      // never scanned at all (the flag is off).
      return [status.ocrAttempted ? content.uncheckedNote : content.manualNote];
    }
    const compared = [
      status.nationalIdMatch,
      status.familyCardMatch,
      status.fullNameMatch,
      status.birthPlaceMatch,
      status.birthDateMatch,
    ].filter((value) => value !== undefined);
    if (compared.length === 0) {
      // Something was read, but nothing could be compared: never claim a match.
      return [content.ocrEngineNote, content.ocrPartialNote];
    }
    const fields: string[] = [];
    if (status.nationalIdMatch === false)
      fields.push(content.ocrField.nationalId);
    if (status.familyCardMatch === false)
      fields.push(content.ocrField.familyCardNumber);
    if (status.fullNameMatch === false) fields.push(content.ocrField.fullName);
    if (status.birthPlaceMatch === false)
      fields.push(content.ocrField.birthPlace);
    if (status.birthDateMatch === false)
      fields.push(content.ocrField.birthDate);
    return fields.length
      ? [content.ocrEngineNote, content.ocrMismatchNote(fields.join(", "))]
      : [content.ocrEngineNote, content.ocrMatchedNote];
  };

  const processOcr = async (selectedFile: File) => {
    setOcrStatus(null);
    if (!selectedFile.type.startsWith("image/")) {
      // A PDF carries no scan result; drop the previous file's verdict so it is
      // never sent (and stored) for the replacement.
      onOcrResult?.(null);
      return;
    }

    setIsParsing(true);
    try {
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(selectedFile);
      });

      const data = await parseDocument.mutateAsync({
        imageBase64,
        documentType,
        userInputData,
      });

      if (data) {
        const validation = {
          ...data.validation,
          hasExtracted: Boolean(
            data.extractedData && Object.keys(data.extractedData).length > 0,
          ),
        };
        setOcrStatus(validation);
        if (data.extractedData && onOcrExtracted) {
          onOcrExtracted(data.extractedData);
        }
        if (onOcrResult && data.validation?.status) {
          onOcrResult({
            status: data.validation.status,
            // The staff portal is Indonesian: store the API's own notes, not
            // the applicant's language used on screen.
            notes: data.validation.notes ?? [],
          });
        }
        if (data.validation?.status === "MISMATCH") {
          toast.error(content.toastMismatch);
        } else {
          toast.warning(content.toastRecheck);
        }
      }
    } catch (err) {
      console.error("Failed to parse document OCR:", err);
      const fallbackStatus = {
        status: "WARNING" as const,
        ocrAttempted: true,
        notes: [content.uncheckedNote],
      };
      setOcrStatus(fallbackStatus);
      if (onOcrResult) {
        onOcrResult(fallbackStatus);
      }
      toast.warning(content.toastUnchecked);
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      onFileSelect(selectedFile);
      processOcr(selectedFile);
    }
  };

  return (
    <div className="space-y-2 border p-4 rounded-xl bg-slate-50/50">
      <div className="flex items-center justify-between">
        <Label className="font-semibold text-sm">{label}</Label>
        {ocrStatus && (
          <Badge
            variant={
              ocrStatus.status === "WARNING" ? "secondary" : "destructive"
            }
            className="text-xs"
          >
            {ocrStatus.status === "WARNING"
              ? content.recheck
              : content.mismatch}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {/* Standard File Upload */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4 me-2" />
          {content.chooseFile}
        </Button>

        {/* Camera Capture Input */}
        <input
          type="file"
          ref={cameraInputRef}
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => cameraInputRef.current?.click()}
        >
          <Camera className="h-4 w-4 me-2 text-primary" />
          {content.camera}
        </Button>

        {file && (
          <span className="text-xs text-green-700 font-medium truncate max-w-[200px]">
            {file.name}
          </span>
        )}
      </div>

      {isParsing && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 animate-pulse mt-2">
          <RefreshCw className="h-3 w-3 animate-spin" /> {content.checking}
        </p>
      )}

      {ocrStatus && localizedNotes(ocrStatus).length > 0 && (
        <div className="mt-2 text-xs text-slate-600 bg-white p-2 rounded border space-y-1">
          {localizedNotes(ocrStatus).map((note, idx) => (
            <p key={idx} className="flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              {note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
