export interface TerminalBufferLikeLine {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

export interface TerminalBufferLike {
  readonly baseY: number;
  readonly length: number;
  readonly viewportY: number;
  getLine(y: number): TerminalBufferLikeLine | undefined;
}

export interface ResolveTouchedBufferLineInput {
  readonly bufferLength: number;
  readonly clientY: number;
  readonly containerHeight: number;
  readonly containerTop: number;
  readonly viewportRows: number;
  readonly viewportY: number;
}

export interface WrappedTerminalBlockRange {
  readonly endLine: number;
  readonly startLine: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveTouchedBufferLine(input: ResolveTouchedBufferLineInput): number | null {
  if (input.bufferLength <= 0 || input.containerHeight <= 0 || input.viewportRows <= 0) {
    return null;
  }

  const relativeY = clamp(input.clientY - input.containerTop, 0, input.containerHeight - 1);
  const viewportRow = clamp(
    Math.floor(relativeY / (input.containerHeight / input.viewportRows)),
    0,
    input.viewportRows - 1,
  );

  return clamp(input.viewportY + viewportRow, 0, input.bufferLength - 1);
}

export function resolveWrappedTerminalBlockRange(
  buffer: TerminalBufferLike,
  line: number,
): WrappedTerminalBlockRange | null {
  if (buffer.length <= 0 || line < 0 || line >= buffer.length) {
    return null;
  }

  let startLine = line;
  while (startLine > 0 && buffer.getLine(startLine)?.isWrapped) {
    startLine -= 1;
  }

  let endLine = line;
  while (endLine + 1 < buffer.length && buffer.getLine(endLine + 1)?.isWrapped) {
    endLine += 1;
  }

  return {
    endLine,
    startLine,
  };
}

export function readWrappedTerminalBlockText(buffer: TerminalBufferLike, line: number): string {
  const range = resolveWrappedTerminalBlockRange(buffer, line);
  if (!range) {
    return "";
  }

  let result = "";
  for (let currentLine = range.startLine; currentLine <= range.endLine; currentLine += 1) {
    const entry = buffer.getLine(currentLine);
    if (!entry) {
      continue;
    }
    const text = entry.translateToString(true);
    if (currentLine > range.startLine && !entry.isWrapped && result.length > 0) {
      result += "\n";
    }
    result += text;
  }

  return result.trimEnd();
}
