"use client";

import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Camera,
  Upload,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { SpmbFormContent } from "@/config/spmb-form.i18n";

interface DocumentCaptureFieldProps {
  label: string;
  /** The field's own words, in the public page's language. */
  content: SpmbFormContent["documents"];
  documentType: "ktp" | "kk" | "akta" | "foto" | "lainnya";
  file: File | null;
  onFileSelect: (file: File) => void;
  userInputData?: {
    fullName?: string;
    nationalId?: string;
    familyCardNumber?: string;
    birthPlace?: string;
    birthDate?: string;
  };
  onOcrExtracted?: (extracted: {
    nationalId?: string;
    familyCardNumber?: string;
  }) => void;
  onOcrResult?: (result: {
    status: "WARNING" | "MISMATCH";
    notes: string[];
  }) => void;
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
  const [isParsing, setIsParsing] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<{
    matchScore?: number;
    status?: "VALID" | "WARNING" | "MISMATCH";
    notes?: string[];
    nationalIdMatch?: boolean;
    familyCardMatch?: boolean;
    fullNameMatch?: boolean;
    birthPlaceMatch?: boolean;
    birthDateMatch?: boolean;
    hasExtracted?: boolean;
  } | null>(null);

  // The API's own `notes` are Indonesian prose; the public form speaks three
  // languages. Render the structured verdict in the reader's language instead.
  const localizedNotes = (status: NonNullable<typeof ocrStatus>): string[] => {
    if (!status.hasExtracted) return [content.uncheckedNote];
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

      const res = await api.post("/admissions/public/parse-document", {
        imageBase64,
        documentType,
        userInputData,
      });

      if (res.data?.data) {
        const data = res.data.data;
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
        if (
          onOcrResult &&
          data.validation?.status &&
          data.validation.status !== "VALID"
        ) {
          onOcrResult({
            status: data.validation.status,
            notes: localizedNotes(validation),
          });
        }
        if (data.validation?.status === "VALID") {
          toast.success(content.toastValid);
        } else if (data.validation?.status === "WARNING") {
          toast.warning(content.toastRecheck);
        } else {
          toast.error(content.toastMismatch);
        }
      }
    } catch (err) {
      console.error("Failed to parse document OCR:", err);
      const fallbackStatus = {
        status: "WARNING" as const,
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
              ocrStatus.status === "VALID"
                ? "default"
                : ocrStatus.status === "WARNING"
                  ? "secondary"
                  : "destructive"
            }
            className="text-xs"
          >
            {ocrStatus.status === "VALID"
              ? content.valid
              : ocrStatus.status === "WARNING"
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
              {ocrStatus.status === "VALID" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              )}
              {note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
