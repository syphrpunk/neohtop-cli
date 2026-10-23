#!/usr/bin/env node

const os = require("os");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const VERSION = require("./package.json").version;
const REPO = "syphrpunk/neohtop-cli";

const PLATFORM_MAP = {
  "darwin-arm64": { file: "sloppytop-macos-arm64", archive: "tar.gz" },
  "linux-arm64": { file: "sloppytop-linux-arm64", archive: "tar.gz" },
  "linux-x64": { file: "sloppytop-linux-amd64", archive: "tar.gz" },
  "win32-x64": { file: "sloppytop-windows-amd64", archive: "tar.gz" },
};

function getPlatformKey() {
  const platform = os.platform();
  const arch = os.arch();
  return `${platform}-${arch}`;
}

function install() {
  const platformKey = getPlatformKey();
  const target = PLATFORM_MAP[platformKey];

  if (platformKey === "darwin-x64") {
    console.error(
      "sloppytop: no prebuilt binary for Intel Macs.\n" +
        "Clone https://github.com/syphrpunk/neohtop-cli and run ./st (mise install, then ./st tui)."
    );
    process.exit(1);
  }

  if (!target) {
    console.error(
      `sloppytop: unsupported platform ${platformKey}\n` +
        `Supported: ${Object.keys(PLATFORM_MAP).join(", ")}`
    );
    process.exit(1);
  }

  const binDir = path.join(__dirname, "bin");
  const isWindows = os.platform() === "win32";
  const binName = isWindows ? "sloppytop.exe" : "sloppytop";
  const binPath = path.join(binDir, binName);

  // Skip if the native binary already exists
  if (fs.existsSync(binPath)) {
    const stat = fs.statSync(binPath);
    // A real binary is larger than 1KB; skip re-download
    if (stat.size > 1024) {
      console.log("sloppytop: binary already installed");
      return;
    }
  }

  const archiveName = `${target.file}.${target.archive}`;
  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${archiveName}`;

  console.log(`sloppytop: downloading ${platformKey} binary from v${VERSION}...`);

  fs.mkdirSync(binDir, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sloppytop-cli-"));
  const tmpArchive = path.join(tmpDir, archiveName);

  try {
    // Download
    execSync(`curl -fsSL "${url}" -o "${tmpArchive}"`, { stdio: "inherit" });

    // Extract
    execSync(`tar xzf "${tmpArchive}" -C "${tmpDir}"`, { stdio: "inherit" });

    // Move binary
    const extractedBin = isWindows
      ? path.join(tmpDir, `${target.file}.exe`)
      : path.join(tmpDir, target.file);

    fs.copyFileSync(extractedBin, binPath);
    if (!isWindows) {
      fs.chmodSync(binPath, 0o755);
    }

    console.log("sloppytop: installed successfully");
  } catch (err) {
    console.error(`sloppytop: installation failed\n${err.message}`);
    console.error(`\nYou can download manually from:\nhttps://github.com/${REPO}/releases`);
    process.exit(1);
  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

install();
