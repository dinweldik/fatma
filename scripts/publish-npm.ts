#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface CliOptions {
  readonly version: string | null;
  readonly bump: "patch" | "minor" | "major";
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

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
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
  let bump: CliOptions["bump"] = "patch";
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
      case "--bump":
        if (next !== "patch" && next !== "minor" && next !== "major") {
          fail("Expected --bump patch|minor|major.");
        }
        bump = next;
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

  return {
    version,
    bump,
    tag,
    access,
    dryRun,
    verbose,
    provenance,
    otp,
  };
}

function parseSemver(version: string): ParsedSemver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function requireSemver(version: string, label: string): ParsedSemver {
  const parsed = parseSemver(version);
  if (!parsed) {
    fail(`${label} is not a plain semver version: ${version}`);
  }
  return parsed;
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

function formatSemver(version: ParsedSemver): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function bumpVersion(currentVersion: string, bump: CliOptions["bump"]): string {
  const parsed = requireSemver(currentVersion, "Current version");

  let major = parsed.major;
  let minor = parsed.minor;
  let patch = parsed.patch;

  switch (bump) {
    case "major":
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case "minor":
      minor += 1;
      patch = 0;
      break;
    case "patch":
      patch += 1;
      break;
  }

  return `${major}.${minor}.${patch}`;
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

function findHighestPublishedVersion(versions: ReadonlySet<string>): string | null {
  let highest: ParsedSemver | null = null;

  for (const version of versions) {
    const parsed = parseSemver(version);
    if (!parsed) {
      continue;
    }
    if (highest === null || compareSemver(parsed, highest) > 0) {
      highest = parsed;
    }
  }

  return highest ? formatSemver(highest) : null;
}

function maxVersion(left: string, right: string): string {
  return compareSemver(
    requireSemver(left, "Local version"),
    requireSemver(right, "Published version"),
  ) >= 0
    ? left
    : right;
}

function findNextUnpublishedVersion(
  baseVersion: string,
  bump: CliOptions["bump"],
  publishedVersions: ReadonlySet<string>,
): string {
  let candidate = bumpVersion(baseVersion, bump);
  while (publishedVersions.has(candidate)) {
    candidate = bumpVersion(candidate, bump);
  }
  return candidate;
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
  const highestPublishedVersion = findHighestPublishedVersion(publishedVersions);
  const versionBase = highestPublishedVersion
    ? maxVersion(packageJson.version, highestPublishedVersion)
    : packageJson.version;
  const nextVersion =
    options.version ?? findNextUnpublishedVersion(versionBase, options.bump, publishedVersions);

  if (options.version && publishedVersions.has(options.version)) {
    fail(`Version ${options.version} is already published for ${packageJson.name}.`);
  }

  const nextPackageJsonRaw = `${JSON.stringify({ ...packageJson, version: nextVersion }, null, 2)}\n`;

  if (highestPublishedVersion && versionBase !== packageJson.version) {
    console.log(
      `[publish-npm] Registry is ahead of local version ${packageJson.version}; using ${versionBase} as the bump base`,
    );
  }

  if (packageJson.version === nextVersion) {
    console.log(`[publish-npm] Reusing version ${nextVersion}`);
  } else {
    console.log(
      `[publish-npm] Bumping ${packageJson.name} from ${packageJson.version} to ${nextVersion}`,
    );
  }

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
