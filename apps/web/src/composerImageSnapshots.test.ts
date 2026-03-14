import { describe, expect, it } from "vitest";

import {
  legacyDataUrlToPayload,
  payloadToUploadAttachment,
  snapshotImageFile,
} from "./composerImageSnapshots";

describe("composerImageSnapshots", () => {
  it("snapshots a File into an app-owned blob payload", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "image.png", {
      type: "image/png",
    });

    const snapshot = await snapshotImageFile(file, "img-1");

    expect(snapshot.attachment).toMatchObject({
      type: "image",
      id: "img-1",
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 4,
    });
    expect(snapshot.attachment.previewUrl.startsWith("blob:")).toBe(true);
    expect(snapshot.payload).toMatchObject({
      id: "img-1",
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 4,
    });
    expect(new Uint8Array(await snapshot.payload.blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("converts a blob payload into the existing upload attachment shape", async () => {
    const attachment = await payloadToUploadAttachment({
      id: "img-1",
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 3,
      blob: new Blob([new Uint8Array([7, 8, 9])], { type: "image/png" }),
    });

    expect(attachment).toMatchObject({
      type: "image",
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 3,
    });
    expect(attachment.dataUrl).toBe("data:image/png;base64,BwgJ");
  });

  it("converts legacy data URLs into blob-backed payloads", async () => {
    const payload = legacyDataUrlToPayload({
      id: "img-1",
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 4,
      dataUrl: "data:image/png;base64,AQIDBA==",
    });

    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({
      id: "img-1",
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 4,
    });
    expect(new Uint8Array(await payload!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
