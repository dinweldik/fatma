#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Data, Effect, FileSystem, Logger, Option, Path } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { DEVELOPMENT_ICON_OVERRIDES, PUBLISH_ICON_OVERRIDES } from "../../../scripts/lib/brand-assets.ts";
import { resolveCatalogDependencies } from "../../../scripts/lib/resolve-catalog.ts";
import rootPackageJson from "../../../package.json" with { type: "json" };
import serverPackageJson from "../package.json" with { type: "json" };

class CliError extends Data.TaggedError("CliError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("../../..", import.meta.url))),
);

const runCommand = Effect.fn("runCommand")(function* (command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);
  const exitCode = yield* child.exitCode;

  if (exitCode !== 0) {
    return yield* new CliError({
      message: `Command exited with non-zero exit code (${exitCode})`,
    });
  }
});

interface PublishIconBackup {
  readonly targetPath: string;
  readonly backupPath: string;
}

interface PublishNpmRcBackup {
  readonly npmrcPath: string;
  readonly backupPath: string | null;
}

const PUBLISH_BACKUP_DIR_NAME = ".publish-icon-backups";

const applyPublishIconOverrides = Effect.fn("applyPublishIconOverrides")(function* (
  repoRoot: string,
  serverDir: string,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const backups: PublishIconBackup[] = [];
  const backupDir = path.join(serverDir, PUBLISH_BACKUP_DIR_NAME);

  yield* fs.makeDirectory(backupDir, { recursive: true });

  for (const override of PUBLISH_ICON_OVERRIDES) {
    const sourcePath = path.join(repoRoot, override.sourceRelativePath);
    const targetPath = path.join(serverDir, override.targetRelativePath);
    const backupFileName = `${override.targetRelativePath.replaceAll("/", "__")}.publish-bak`;
    const backupPath = path.join(backupDir, backupFileName);

    if (!(yield* fs.exists(sourcePath))) {
      return yield* new CliError({
        message: `Missing publish icon source: ${sourcePath}`,
      });
    }
    if (!(yield* fs.exists(targetPath))) {
      return yield* new CliError({
        message: `Missing publish icon target: ${targetPath}. Run the build subcommand first.`,
      });
    }

    yield* fs.copyFile(targetPath, backupPath);
    yield* fs.copyFile(sourcePath, targetPath);
    backups.push({ targetPath, backupPath });
  }

  yield* Effect.log("[cli] Applied publish icon overrides to dist/client");
  return backups as ReadonlyArray<PublishIconBackup>;
});

const restorePublishIconOverrides = Effect.fn("restorePublishIconOverrides")(function* (
  backups: ReadonlyArray<PublishIconBackup>,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  for (const backup of backups) {
    if (!(yield* fs.exists(backup.backupPath))) {
      continue;
    }
    yield* fs.rename(backup.backupPath, backup.targetPath);
  }

  const backupDirs = new Set(backups.map((backup) => path.dirname(backup.backupPath)));
  for (const backupDir of backupDirs) {
    if (!(yield* fs.exists(backupDir))) {
      continue;
    }
    yield* fs.remove(backupDir, { recursive: true, force: true });
  }
});

const configureNpmAuthForPublish = Effect.fn("configureNpmAuthForPublish")(function* (
  serverDir: string,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const token = process.env.NPM_TOKEN?.trim() ?? "";
  if (token.length === 0) {
    return yield* new CliError({
      message:
        "NPM_TOKEN is required for npm publish. Export it in the current shell before publishing.",
    });
  }

  const backupDir = path.join(serverDir, PUBLISH_BACKUP_DIR_NAME);
  const npmrcPath = path.join(serverDir, ".npmrc");
  const backupPath = (yield* fs.exists(npmrcPath))
    ? path.join(backupDir, "npmrc.publish-bak")
    : null;

  yield* fs.makeDirectory(backupDir, { recursive: true });
  if (backupPath) {
    yield* fs.copyFile(npmrcPath, backupPath);
  }

  const npmrcContents = `//registry.npmjs.org/:_authToken=${token}\n`;
  yield* fs.writeFileString(npmrcPath, npmrcContents);
  yield* Effect.log("[cli] Wrote temporary npm auth config from NPM_TOKEN");

  return {
    npmrcPath,
    backupPath,
  } satisfies PublishNpmRcBackup;
});

const restoreNpmAuthAfterPublish = Effect.fn("restoreNpmAuthAfterPublish")(function* (
  backup: PublishNpmRcBackup,
) {
  const fs = yield* FileSystem.FileSystem;
  if (backup.backupPath) {
    yield* fs.rename(backup.backupPath, backup.npmrcPath);
    return;
  }

  yield* fs.remove(backup.npmrcPath, { force: true });
});

const applyDevelopmentIconOverrides = Effect.fn("applyDevelopmentIconOverrides")(function* (
  repoRoot: string,
  serverDir: string,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  for (const override of DEVELOPMENT_ICON_OVERRIDES) {
    const sourcePath = path.join(repoRoot, override.sourceRelativePath);
    const targetPath = path.join(serverDir, override.targetRelativePath);

    if (!(yield* fs.exists(sourcePath))) {
      return yield* new CliError({
        message: `Missing development icon source: ${sourcePath}`,
      });
    }
    if (!(yield* fs.exists(targetPath))) {
      return yield* new CliError({
        message: `Missing development icon target: ${targetPath}. Build web first.`,
      });
    }

    yield* fs.copyFile(sourcePath, targetPath);
  }

  yield* Effect.log("[cli] Applied development icon overrides to dist/client");
});

// ---------------------------------------------------------------------------
// build subcommand
// ---------------------------------------------------------------------------

const buildCmd = Command.make(
  "build",
  {
    verbose: Flag.boolean("verbose").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const repoRoot = yield* RepoRoot;
      const serverDir = path.join(repoRoot, "apps/server");

      yield* Effect.log("[cli] Running tsdown...");
      yield* runCommand(
        ChildProcess.make({
          cwd: serverDir,
          stdout: config.verbose ? "inherit" : "ignore",
          stderr: "inherit",
        })`bun tsdown`,
      );

      const webDist = path.join(repoRoot, "apps/web/dist");
      const clientTarget = path.join(serverDir, "dist/client");

      if (yield* fs.exists(webDist)) {
        yield* fs.copy(webDist, clientTarget);
        yield* applyDevelopmentIconOverrides(repoRoot, serverDir);
        yield* Effect.log("[cli] Bundled web app into dist/client");
      } else {
        yield* Effect.logWarning("[cli] Web dist not found — skipping client bundle.");
      }
    }),
).pipe(Command.withDescription("Build the server package (tsdown + bundle web client)."));

// ---------------------------------------------------------------------------
// publish subcommand
// ---------------------------------------------------------------------------

const publishCmd = Command.make(
  "publish",
  {
    tag: Flag.string("tag").pipe(Flag.withDefault("latest")),
    access: Flag.string("access").pipe(Flag.withDefault("public")),
    appVersion: Flag.string("app-version").pipe(Flag.optional),
    otp: Flag.string("otp").pipe(Flag.optional),
    provenance: Flag.boolean("provenance").pipe(Flag.withDefault(false)),
    dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false)),
    verbose: Flag.boolean("verbose").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const repoRoot = yield* RepoRoot;
      const serverDir = path.join(repoRoot, "apps/server");
      const packageJsonPath = path.join(serverDir, "package.json");
      const backupPath = `${packageJsonPath}.bak`;

      // Assert build assets exist
      for (const relPath of ["dist/index.mjs", "dist/client/index.html"]) {
        const abs = path.join(serverDir, relPath);
        if (!(yield* fs.exists(abs))) {
          return yield* new CliError({
            message: `Missing build asset: ${abs}. Run the build subcommand first.`,
          });
        }
      }

      yield* Effect.acquireUseRelease(
        // Acquire: backup package.json, resolve catalog: deps, strip devDependencies/scripts
        Effect.gen(function* () {
          // Resolve catalog dependencies before any file mutations. If this throws,
          // acquire fails and no release hook runs, so filesystem must still be untouched.
          const version = Option.getOrElse(config.appVersion, () => serverPackageJson.version);
          const pkg = {
            name: serverPackageJson.name,
            repository: serverPackageJson.repository,
            homepage: serverPackageJson.homepage,
            bugs: serverPackageJson.bugs,
            bin: serverPackageJson.bin,
            type: serverPackageJson.type,
            version,
            engines: serverPackageJson.engines,
            files: serverPackageJson.files,
            dependencies: serverPackageJson.dependencies as Record<string, unknown>,
          };

          pkg.dependencies = resolveCatalogDependencies(
            pkg.dependencies,
            rootPackageJson.workspaces.catalog,
            "apps/server dependencies",
          );

          const original = yield* fs.readFileString(packageJsonPath);
          yield* fs.writeFileString(backupPath, original);
          yield* fs.writeFileString(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
          yield* Effect.log("[cli] Resolved package.json for publish");

          const iconBackups = yield* applyPublishIconOverrides(repoRoot, serverDir);
          const npmrcBackup = yield* configureNpmAuthForPublish(serverDir);
          return { iconBackups, npmrcBackup };
        }),
        // Use: npm publish
        (resource: {
          readonly iconBackups: ReadonlyArray<PublishIconBackup>;
          readonly npmrcBackup: PublishNpmRcBackup;
        }) =>
          Effect.gen(function* () {
            const args = ["publish", "--access", config.access, "--tag", config.tag];
            if (config.provenance) args.push("--provenance");
            if (config.dryRun) args.push("--dry-run");
            if (Option.isSome(config.otp)) {
              args.push("--otp", config.otp.value);
            }

            const logArgs = Option.isSome(config.otp)
              ? args.map((arg, index) =>
                  args[index - 1] === "--otp" ? "[redacted]" : arg,
                )
              : args;

            yield* Effect.log(`[cli] Running: npm ${logArgs.join(" ")}`);
            yield* runCommand(
              ChildProcess.make("npm", [...args], {
                cwd: serverDir,
                env: {
                  ...process.env,
                  NPM_CONFIG_USERCONFIG: resource.npmrcBackup.npmrcPath,
                },
                stdout: config.verbose ? "inherit" : "ignore",
                stderr: "inherit",
              }),
            );
          }),
        // Release: restore
        (resource: {
          readonly iconBackups: ReadonlyArray<PublishIconBackup>;
          readonly npmrcBackup: PublishNpmRcBackup;
        }) =>
          Effect.gen(function* () {
            yield* restorePublishIconOverrides(resource.iconBackups).pipe(
              Effect.catch((error) =>
                Effect.logError(
                  `[cli] Failed to restore publish icon overrides: ${String(error)}`,
                ),
              ),
            );
            yield* restoreNpmAuthAfterPublish(resource.npmrcBackup).pipe(
              Effect.catch((error) =>
                Effect.logError(`[cli] Failed to restore temporary npm auth config: ${String(error)}`),
              ),
            );
            yield* fs.rename(backupPath, packageJsonPath);
            if (config.verbose) yield* Effect.log("[cli] Restored original package.json");
          }),
      );
    }),
).pipe(Command.withDescription("Publish the server package to npm."));

// ---------------------------------------------------------------------------
// root command
// ---------------------------------------------------------------------------

const cli = Command.make("cli").pipe(
  Command.withDescription("fatma server build & publish CLI."),
  Command.withSubcommands([buildCmd, publishCmd]),
);

Command.run(cli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide([Logger.layer([Logger.consolePretty()]), NodeServices.layer]),
  NodeRuntime.runMain,
);
