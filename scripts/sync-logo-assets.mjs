#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SOURCE_SVG_PATH = path.join(REPO_ROOT, "assets/prod/logo.svg");

const MASTER_PNG_TARGETS = [
  "assets/prod/black-ios-1024.png",
  "assets/prod/black-macos-1024.png",
  "assets/prod/black-universal-1024.png",
  "assets/dev/blueprint-ios-1024.png",
  "assets/dev/blueprint-macos-1024.png",
  "assets/dev/blueprint-universal-1024.png",
  "apps/marketing/public/icon.png",
];

const PNG_TARGETS = [
  { size: 16, paths: ["assets/prod/fatma-black-web-favicon-16x16.png", "assets/dev/blueprint-web-favicon-16x16.png", "apps/web/public/favicon-16x16.png", "apps/marketing/public/favicon-16x16.png"] },
  { size: 32, paths: ["assets/prod/fatma-black-web-favicon-32x32.png", "assets/dev/blueprint-web-favicon-32x32.png", "apps/web/public/favicon-32x32.png", "apps/marketing/public/favicon-32x32.png"] },
  { size: 180, paths: ["assets/prod/fatma-black-web-apple-touch-180.png", "assets/dev/blueprint-web-apple-touch-180.png", "apps/web/public/apple-touch-icon.png", "apps/marketing/public/apple-touch-icon.png"] },
  { size: 192, paths: ["assets/prod/fatma-black-web-app-icon-192.png", "assets/dev/blueprint-web-app-icon-192.png", "apps/web/public/icon-192.png"] },
  { size: 512, paths: ["assets/prod/fatma-black-web-app-icon-512.png", "assets/dev/blueprint-web-app-icon-512.png", "apps/web/public/icon-512.png", "apps/desktop/resources/icon.png"] },
];

const ICO_TARGETS = [
  "assets/prod/fatma-black-web-favicon.ico",
  "assets/prod/fatma-black-windows.ico",
  "assets/dev/blueprint-web-favicon.ico",
  "assets/dev/blueprint-windows.ico",
  "apps/web/public/favicon.ico",
  "apps/marketing/public/favicon.ico",
  "apps/desktop/resources/icon.ico",
];

async function run(command, args) {
  await execFileAsync(command, args, {
    cwd: REPO_ROOT,
  });
}

async function ensureSourceExists() {
  await fs.access(SOURCE_SVG_PATH);
}

async function buildMasterPng(targetPath) {
  await run("magick", [
    "-background",
    "none",
    SOURCE_SVG_PATH,
    "-resize",
    "1024x1024",
    targetPath,
  ]);
}

async function buildSizedPng(masterPath, size, targetPath) {
  await run("magick", [masterPath, "-resize", `${size}x${size}`, targetPath]);
}

async function buildIco(masterPath, targetPath) {
  await run("magick", [
    masterPath,
    "-define",
    "icon:auto-resize=256,128,64,48,32,16",
    targetPath,
  ]);
}

async function buildIcns(masterPath, targetPath, tmpDir) {
  const iconsetDir = path.join(tmpDir, "icon.iconset");
  await fs.mkdir(iconsetDir, { recursive: true });

  for (const size of [16, 32, 128, 256, 512]) {
    const standardPath = path.join(iconsetDir, `icon_${size}x${size}.png`);
    const retinaSize = size * 2;
    const retinaPath = path.join(iconsetDir, `icon_${size}x${size}@2x.png`);
    await buildSizedPng(masterPath, size, standardPath);
    await buildSizedPng(masterPath, retinaSize, retinaPath);
  }

  await run("iconutil", ["-c", "icns", iconsetDir, "-o", targetPath]);
}

async function copyFile(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function main() {
  await ensureSourceExists();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fatma-logo-assets-"));
  const masterPath = path.join(tmpDir, "logo-1024.png");

  try {
    await buildMasterPng(masterPath);

    for (const relativeTargetPath of MASTER_PNG_TARGETS) {
      await copyFile(masterPath, path.join(REPO_ROOT, relativeTargetPath));
    }

    for (const pngTarget of PNG_TARGETS) {
      const sizedPath = path.join(tmpDir, `logo-${pngTarget.size}.png`);
      await buildSizedPng(masterPath, pngTarget.size, sizedPath);
      for (const relativeTargetPath of pngTarget.paths) {
        await copyFile(sizedPath, path.join(REPO_ROOT, relativeTargetPath));
      }
    }

    const icoPath = path.join(tmpDir, "logo.ico");
    await buildIco(masterPath, icoPath);
    for (const relativeTargetPath of ICO_TARGETS) {
      await copyFile(icoPath, path.join(REPO_ROOT, relativeTargetPath));
    }

    await buildIcns(masterPath, path.join(REPO_ROOT, "apps/desktop/resources/icon.icns"), tmpDir);

    process.stdout.write("Synced logo assets from assets/prod/logo.svg\n");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
