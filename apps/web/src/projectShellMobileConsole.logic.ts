export const DEFAULT_PROJECT_SHELL_MOBILE_PROMPT = "$ ";

const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const PROMPT_PREFIX_PATTERN = /^(.*?(?:[$#%>]))(?:\s.*)?$/;

export function normalizeProjectShellMobileOutput(text: string): string {
  if (text.length === 0) {
    return "";
  }

  return text.replace(ANSI_ESCAPE_PATTERN, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function deriveProjectShellMobilePrompt(
  outputText: string,
  fallbackPrompt = DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
): string {
  const normalizedOutput = normalizeProjectShellMobileOutput(outputText);
  if (normalizedOutput.length === 0) {
    return fallbackPrompt;
  }

  const lines = normalizedOutput.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trimEnd();
    if (!line) {
      continue;
    }

    const match = line.match(PROMPT_PREFIX_PATTERN);
    if (!match?.[1]) {
      continue;
    }

    const promptPrefix = match[1].trimEnd();
    if (promptPrefix.length === 0) {
      continue;
    }

    return `${promptPrefix} `;
  }

  return fallbackPrompt;
}

export function buildProjectShellMobileConsoleSnapshot(
  history: string,
  fallbackPrompt = DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
): {
  outputText: string;
  promptText: string;
} {
  const outputText = normalizeProjectShellMobileOutput(history);

  return {
    outputText,
    promptText: deriveProjectShellMobilePrompt(outputText, fallbackPrompt),
  };
}

export function appendProjectShellMobileConsoleOutput(input: {
  readonly chunk: string;
  readonly existingOutputText: string;
  readonly fallbackPrompt?: string;
}): {
  outputText: string;
  promptText: string;
} {
  const normalizedChunk = normalizeProjectShellMobileOutput(input.chunk);
  const outputText =
    normalizedChunk.length === 0
      ? input.existingOutputText
      : `${input.existingOutputText}${normalizedChunk}`;

  return {
    outputText,
    promptText: deriveProjectShellMobilePrompt(
      outputText,
      input.fallbackPrompt ?? DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
    ),
  };
}

export function toProjectShellMobileInputData(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r") + "\r";
}
