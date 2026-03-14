export async function readTextFromClipboard(): Promise<string> {
  if (typeof navigator === "undefined" || navigator.clipboard?.readText === undefined) {
    throw new Error("Clipboard read is unavailable.");
  }

  return navigator.clipboard.readText();
}

export async function writeTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
    throw new Error("Clipboard write is unavailable.");
  }

  await navigator.clipboard.writeText(text);
}
