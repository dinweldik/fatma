import { describe, expect, it } from "vitest";

import {
  appendProjectShellMobileConsoleOutput,
  buildProjectShellMobileConsoleSnapshot,
  DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
  deriveProjectShellMobilePrompt,
  normalizeProjectShellMobileOutput,
  toProjectShellMobileInputData,
} from "./projectShellMobileConsole.logic";

describe("projectShellMobileConsole.logic", () => {
  it("normalizes terminal output for textarea display", () => {
    expect(normalizeProjectShellMobileOutput("one\r\ntwo\rthree\u001b[31mred\u001b[0m")).toBe(
      "one\ntwo\nthreered",
    );
  });

  it("derives the latest prompt prefix from transcript output", () => {
    const output =
      "64 bytes from host\nroot@vscode:~/fatma/apps/server# ping orf.at\nroot@vscode:~/fatma/apps/server# ";

    expect(deriveProjectShellMobilePrompt(output, DEFAULT_PROJECT_SHELL_MOBILE_PROMPT)).toBe(
      "root@vscode:~/fatma/apps/server# ",
    );
  });

  it("builds a console snapshot from terminal history", () => {
    expect(
      buildProjectShellMobileConsoleSnapshot(
        "hello\r\nroot@vscode:~/fatma/apps/server# ",
        DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
      ),
    ).toEqual({
      outputText: "hello\nroot@vscode:~/fatma/apps/server# ",
      promptText: "root@vscode:~/fatma/apps/server# ",
    });
  });

  it("appends live output while keeping the latest prompt label", () => {
    expect(
      appendProjectShellMobileConsoleOutput({
        existingOutputText: "hello\nroot@vscode:~/fatma/apps/server# ",
        chunk: "pwd\r\n/root/fatma/apps/server\r\nroot@vscode:~/fatma/apps/server# ",
      }),
    ).toEqual({
      outputText:
        "hello\nroot@vscode:~/fatma/apps/server# pwd\n/root/fatma/apps/server\nroot@vscode:~/fatma/apps/server# ",
      promptText: "root@vscode:~/fatma/apps/server# ",
    });
  });

  it("serializes multi-line composer input into shell writes", () => {
    expect(toProjectShellMobileInputData("echo one\nprintf 'two'")).toBe(
      "echo one\rprintf 'two'\r",
    );
  });
});
