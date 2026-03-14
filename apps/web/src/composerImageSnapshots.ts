import type { UploadChatImageAttachment } from "@fatma/contracts";

import type { ChatImageAttachment } from "./types";

export interface ComposerImageAttachment extends Omit<ChatImageAttachment, "previewUrl"> {
  previewUrl: string;
}

export interface ComposerImageAttachmentPayload {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
}

export interface LegacyComposerImageAttachmentPayload extends Omit<
  ComposerImageAttachmentPayload,
  "blob"
> {
  dataUrl: string;
}

export interface ComposerImageSnapshot {
  attachment: ComposerImageAttachment;
  payload: ComposerImageAttachmentPayload;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === "undefined") {
    return blob.arrayBuffer().then((buffer) => {
      const base64 =
        typeof globalThis !== "undefined" && "Buffer" in globalThis
          ? (
              globalThis as typeof globalThis & {
                Buffer: {
                  from: (input: ArrayBuffer) => { toString: (encoding: string) => string };
                };
              }
            ).Buffer.from(buffer).toString("base64")
          : btoa(Array.from(new Uint8Array(buffer), (byte) => String.fromCharCode(byte)).join(""));
      return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(blob);
  });
}

function blobMimeType(blob: Blob, fallbackMimeType: string): string {
  return blob.type || fallbackMimeType;
}

function blobName(inputName: string): string {
  return inputName || "image";
}

export function payloadToPreviewUrl(payload: ComposerImageAttachmentPayload): string {
  if (typeof URL === "undefined") {
    return "";
  }
  return URL.createObjectURL(payload.blob);
}

export function payloadToComposerImageAttachment(
  payload: ComposerImageAttachmentPayload,
): ComposerImageAttachment {
  return {
    type: "image",
    id: payload.id,
    name: payload.name,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    previewUrl: payloadToPreviewUrl(payload),
  };
}

export async function snapshotImageFile(file: File, id: string): Promise<ComposerImageSnapshot> {
  const bytes = await file.arrayBuffer();
  const blob = new Blob([bytes], { type: file.type });
  const payload: ComposerImageAttachmentPayload = {
    id,
    name: blobName(file.name),
    mimeType: blobMimeType(blob, file.type),
    sizeBytes: blob.size,
    blob,
  };
  return {
    attachment: payloadToComposerImageAttachment(payload),
    payload,
  };
}

export async function payloadToUploadAttachment(
  payload: ComposerImageAttachmentPayload,
): Promise<UploadChatImageAttachment> {
  return {
    type: "image",
    name: payload.name,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    dataUrl: await readBlobAsDataUrl(payload.blob),
  };
}

export function legacyDataUrlToPayload(
  attachment: LegacyComposerImageAttachmentPayload,
): ComposerImageAttachmentPayload | null {
  const commaIndex = attachment.dataUrl.indexOf(",");
  const header = commaIndex === -1 ? attachment.dataUrl : attachment.dataUrl.slice(0, commaIndex);
  const payload = commaIndex === -1 ? "" : attachment.dataUrl.slice(commaIndex + 1);
  if (payload.length === 0) {
    return null;
  }
  try {
    const isBase64 = header.includes(";base64");
    if (!isBase64) {
      const decodedText = decodeURIComponent(payload);
      const mimeType =
        header.startsWith("data:") && header.includes(";")
          ? header.slice("data:".length, header.indexOf(";"))
          : attachment.mimeType;
      const blob = new Blob([decodedText], { type: mimeType || attachment.mimeType });
      return {
        id: attachment.id,
        name: attachment.name,
        mimeType: blobMimeType(blob, attachment.mimeType),
        sizeBytes: blob.size,
        blob,
      };
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: attachment.mimeType });
    return {
      id: attachment.id,
      name: attachment.name,
      mimeType: blobMimeType(blob, attachment.mimeType),
      sizeBytes: blob.size,
      blob,
    };
  } catch {
    return null;
  }
}
