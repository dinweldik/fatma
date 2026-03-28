#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface CliOptions {
  readonly version: string | null;
  readonly tag: string;
  readonly access: string;
  readonly dryRun: boolean;
  readonly verbose: boolean;
  readonly provenance: boolean;
  readonly otp: string | null;
}

function fail(message: string): never {
  throw new Error(`[publish-npm] ${message}`);
}

function runCommand(command: string, args: ReadonlyArray<string>, cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function runJsonCommand(command: string, args: ReadonlyArray<string>, cwd: string): unknown {
  const result = spawnSync(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    if (/\bE404\b/.test(output) || /\b404\b/.test(output)) {
      return [];
    }
    fail(`Command failed: ${command} ${args.join(" ")}${output ? `\n${output}` : ""}`);
  }

  const stdout = result.stdout.trim();
  if (stdout.length === 0) {
    return [];
  }

  return JSON.parse(stdout);
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  let version: string | null = null;
  let tag = "latest";
  let access = "public";
  let dryRun = false;
  let verbose = false;
  let provenance = false;
  let otp: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--version":
        if (!next) fail("Missing value for --version.");
        version = next;
        index += 1;
        break;
      case "--tag":
        if (!next) fail("Missing value for --tag.");
        tag = next;
        index += 1;
        break;
      case "--access":
        if (!next) fail("Missing value for --access.");
        access = next;
        index += 1;
        break;
      case "--otp":
        if (!next) fail("Missing value for --otp.");
        otp = next;
        index += 1;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--verbose":
        verbose = true;
        break;
      case "--provenance":
        provenance = true;
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  return { version, tag, access, dryRun, verbose, provenance, otp };
}

function readPublishedVersions(packageName: string, cwd: string): ReadonlySet<string> {
  const output = runJsonCommand("npm", ["view", packageName, "versions", "--json"], cwd);
  if (typeof output === "string") {
    return new Set([output]);
  }
  if (Array.isArray(output) && output.every((value) => typeof value === "string")) {
    return new Set(output);
  }
  fail(`Unexpected npm response while reading versions for ${packageName}.`);
}

/**
 * CalVer: YYYY.M.D with a patch suffix for same-day releases.
 * First release of the day:  2026.3.28
 * Second release:            2026.3.2801
 * Third release:             2026.3.2802
 */
function calverToday(): { year: number; month: number; day: number } {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

function nextCalver(publishedVersions: ReadonlySet<string>): string {
  const { year, month, day } = calverToday();
  const base = `${year}.${month}.${day}`;
  if (!publishedVersions.has(base)) {
    return base;
  }
  // Same-day collision: append incrementing suffix to the patch segment.
  // e.g. 2026.3.2801, 2026.3.2802, ...
  for (let seq = 1; seq < 100; seq += 1) {
    const candidate = `${year}.${month}.${day}${String(seq).padStart(2, "0")}`;
    if (!publishedVersions.has(candidate)) {
      return candidate;
    }
  }
  fail("Exhausted same-day CalVer sequence (max 100 releases per day).");
}

try {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const serverDir = path.join(repoRoot, "apps", "server");
  const packageJsonPath = path.join(serverDir, "package.json");
  const originalPackageJsonRaw = readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(originalPackageJsonRaw) as {
    name: string;
    version: string;
  };

  if ((process.env.NPM_TOKEN?.trim() ?? "").length === 0) {
    fail("NPM_TOKEN is not set in the current shell.");
  }

  const publishedVersions = readPublishedVersions(packageJson.name, repoRoot);
  const nextVersion = options.version ?? nextCalver(publishedVersions);

  if (publishedVersions.has(nextVersion)) {
    fail(`Version ${nextVersion} is already published for ${packageJson.name}.`);
  }

  console.log(`[publish-npm] Publishing ${packageJson.name}@${nextVersion} (CalVer: YYYY.M.D)`);

  const nextPackageJsonRaw = `${JSON.stringify({ ...packageJson, version: nextVersion }, null, 2)}\n`;
  writeFileSync(packageJsonPath, nextPackageJsonRaw);

  let published = false;

  try {
    runCommand("bun", ["lint"], repoRoot);
    runCommand("bun", ["typecheck"], repoRoot);
    runCommand("bun", ["run", "build"], repoRoot);
    runCommand("node", ["scripts/cli.ts", "build", "--verbose"], serverDir);

    const publishArgs = [
      "scripts/cli.ts",
      "publish",
      "--tag",
      options.tag,
      "--access",
      options.access,
      "--app-version",
      nextVersion,
    ];
    if (options.verbose) {
      publishArgs.push("--verbose");
    }
    if (options.dryRun) {
      publishArgs.push("--dry-run");
    }
    if (options.provenance) {
      publishArgs.push("--provenance");
    }
    if (options.otp) {
      publishArgs.push("--otp", options.otp);
    }

    runCommand("node", publishArgs, serverDir);
    published = true;
    console.log(`[publish-npm] Published ${packageJson.name}@${nextVersion}`);
  } finally {
    if (!published) {
      writeFileSync(packageJsonPath, originalPackageJsonRaw);
      console.log("[publish-npm] Restored apps/server/package.json after failed publish.");
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
