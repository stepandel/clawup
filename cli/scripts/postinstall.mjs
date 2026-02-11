#!/usr/bin/env node

/**
 * Postinstall script for agent-army CLI
 *
 * Downloads vendored binaries (Pulumi CLI, AWS CLI v2) for the current
 * platform to cli/vendor/. Runs automatically after `npm install`.
 *
 * Versions and checksums are fetched dynamically:
 * - Pulumi: latest release from GitHub API, checksums from release assets
 * - AWS CLI: latest from AWS, checksums from .sha256 sidecar files
 *
 * If downloads fail (network issues, unsupported platform), the CLI
 * falls back to system PATH binaries — this is not a fatal error.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const VENDOR_DIR = path.join(__dirname, "..", "vendor");

function getPlatform() {
  const platform = process.platform;
  const arch = process.arch;

  let osName;
  if (platform === "darwin") osName = "darwin";
  else if (platform === "linux") osName = "linux";
  else if (platform === "win32") osName = "windows";
  else return null;

  let archName;
  if (arch === "x64") archName = "x64";
  else if (arch === "arm64") archName = "arm64";
  else return null;

  return { os: osName, arch: archName };
}

/**
 * Compute SHA256 hash of a file.
 */
function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

/**
 * Verify SHA256 checksum of a downloaded file.
 * Throws if checksum doesn't match.
 */
function verifyChecksum(filePath, expectedHash, label) {
  if (!expectedHash) {
    console.log(`  ⚠ No checksum available for ${label} — skipping verification`);
    return;
  }
  const actualHash = sha256File(filePath);
  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for ${label}!\n` +
      `  Expected: ${expectedHash}\n` +
      `  Got:      ${actualHash}\n` +
      `  This could indicate a corrupted download or supply chain attack.\n` +
      `  Delete the file and retry, or install the CLI manually.`
    );
  }
  console.log(`  ✓ Checksum verified for ${label}`);
}

/**
 * Make an HTTPS GET request and return the response body as a string.
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const doRequest = (reqUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error("Too many redirects"));
        return;
      }
      https.get(reqUrl, { headers: { "User-Agent": "agent-army-postinstall" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }).on("error", reject);
    };
    doRequest(url);
  });
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (reqUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error("Too many redirects"));
        return;
      }
      https
        .get(reqUrl, { headers: { "User-Agent": "agent-army-postinstall" } }, (response) => {
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            request(response.headers.location, redirectCount + 1);
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`HTTP ${response.statusCode} for ${reqUrl}`));
            return;
          }
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        })
        .on("error", (err) => {
          try { fs.unlinkSync(destPath); } catch {}
          reject(err);
        });
    };
    request(url);
  });
}

/**
 * Fetch the latest Pulumi version from GitHub releases API.
 */
async function getLatestPulumiVersion() {
  const data = await httpsGet("https://api.github.com/repos/pulumi/pulumi/releases/latest");
  const release = JSON.parse(data);
  const version = release.tag_name.replace(/^v/, "");
  console.log(`  Resolved Pulumi latest version: v${version}`);
  return version;
}

/**
 * Fetch Pulumi checksums from the GitHub release checksums.txt asset.
 * Returns a map of filename -> sha256 hash.
 */
async function getPulumiChecksums(version) {
  const url = `https://github.com/pulumi/pulumi/releases/download/v${version}/pulumi-${version}-checksums.txt`;
  try {
    const data = await httpsGet(url);
    const checksums = {};
    for (const line of data.trim().split("\n")) {
      const [hash, filename] = line.trim().split(/\s+/);
      if (hash && filename) {
        checksums[filename] = hash;
      }
    }
    return checksums;
  } catch (err) {
    console.warn(`  ⚠ Could not fetch Pulumi checksums: ${err.message}`);
    return {};
  }
}

function getPulumiFilename(version, platform) {
  const ext = platform.os === "windows" ? "zip" : "tar.gz";
  return `pulumi-v${version}-${platform.os}-${platform.arch}.${ext}`;
}

function getPulumiUrl(version, platform) {
  return `https://get.pulumi.com/releases/sdk/${getPulumiFilename(version, platform)}`;
}

function getAwsCliUrl(platform) {
  if (platform.os === "linux" && platform.arch === "x64") {
    return "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip";
  }
  if (platform.os === "linux" && platform.arch === "arm64") {
    return "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip";
  }
  if (platform.os === "darwin") {
    return "https://awscli.amazonaws.com/AWSCLIV2.pkg";
  }
  if (platform.os === "windows") {
    return "https://awscli.amazonaws.com/AWSCLIV2.msi";
  }
  return null;
}

/**
 * Fetch the SHA256 checksum for an AWS CLI download from the .sha256 sidecar.
 */
async function getAwsCliChecksum(url) {
  try {
    const data = await httpsGet(`${url}.sha256`);
    // Format: "<hash>  filename" or just the hash
    const hash = data.trim().split(/\s+/)[0];
    if (hash && /^[a-f0-9]{64}$/.test(hash)) {
      return hash;
    }
    return null;
  } catch {
    return null;
  }
}

async function installPulumi(platform) {
  // Resolve version dynamically
  const version = await getLatestPulumiVersion();
  const checksums = await getPulumiChecksums(version);
  const filename = getPulumiFilename(version, platform);
  const expectedChecksum = checksums[filename] || null;
  const url = getPulumiUrl(version, platform);
  const platformKey = `${platform.os}-${platform.arch}`;
  const destDir = path.join(VENDOR_DIR, "pulumi");
  fs.mkdirSync(destDir, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-army-pulumi-"));

  try {
    if (platform.os === "windows") {
      const zipPath = path.join(tmpDir, "pulumi.zip");
      console.log(`  Downloading Pulumi v${version} (${platformKey})...`);
      await download(url, zipPath);
      verifyChecksum(zipPath, expectedChecksum, `Pulumi v${version} (${platformKey})`);

      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`, {
        stdio: "pipe",
      });

      const extractedDir = path.join(tmpDir, "pulumi", "bin");
      if (fs.existsSync(extractedDir)) {
        for (const file of fs.readdirSync(extractedDir)) {
          fs.copyFileSync(path.join(extractedDir, file), path.join(destDir, file));
        }
      }
    } else {
      const tarPath = path.join(tmpDir, "pulumi.tar.gz");
      console.log(`  Downloading Pulumi v${version} (${platformKey})...`);
      await download(url, tarPath);
      verifyChecksum(tarPath, expectedChecksum, `Pulumi v${version} (${platformKey})`);

      execSync(`tar xzf "${tarPath}" -C "${tmpDir}"`, { stdio: "pipe" });

      const extractedDir = path.join(tmpDir, "pulumi");
      if (fs.existsSync(extractedDir)) {
        for (const file of fs.readdirSync(extractedDir)) {
          const srcPath = path.join(extractedDir, file);
          const dstPath = path.join(destDir, file);
          fs.copyFileSync(srcPath, dstPath);
          fs.chmodSync(dstPath, 0o755);
        }
      }
    }

    // Write version file for runtime reference
    fs.writeFileSync(path.join(destDir, ".version"), version);
    console.log(`  ✓ Pulumi v${version} installed to vendor/pulumi/`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function installAwsCli(platform) {
  const url = getAwsCliUrl(platform);
  if (!url) {
    console.log("  AWS CLI: unsupported platform, skipping vendor install");
    return;
  }

  const platformKey = `${platform.os}-${platform.arch}`;
  const destDir = path.join(VENDOR_DIR, "aws-cli");
  fs.mkdirSync(destDir, { recursive: true });

  // Fetch checksum from AWS .sha256 sidecar file
  const expectedChecksum = await getAwsCliChecksum(url);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-army-awscli-"));

  try {
    if (platform.os === "linux") {
      const zipPath = path.join(tmpDir, "awscli.zip");
      console.log(`  Downloading AWS CLI v2 (${platformKey})...`);
      await download(url, zipPath);
      verifyChecksum(zipPath, expectedChecksum, `AWS CLI v2 (${platformKey})`);

      execSync(`unzip -q "${zipPath}" -d "${tmpDir}"`, { stdio: "pipe" });

      const installDir = path.join(destDir, "v2");
      execSync(
        `"${tmpDir}/aws/install" --install-dir "${installDir}" --bin-dir "${destDir}" --update`,
        { stdio: "pipe" }
      );

      console.log(`  ✓ AWS CLI v2 installed to vendor/aws-cli/`);
    } else if (platform.os === "darwin") {
      const pkgPath = path.join(tmpDir, "AWSCLIV2.pkg");
      console.log(`  Downloading AWS CLI v2 (${platformKey})...`);
      await download(url, pkgPath);
      verifyChecksum(pkgPath, expectedChecksum, `AWS CLI v2 (${platformKey})`);

      const expandDir = path.join(tmpDir, "expanded");
      execSync(`pkgutil --expand "${pkgPath}" "${expandDir}"`, { stdio: "pipe" });

      const payloadDir = path.join(tmpDir, "payload");
      fs.mkdirSync(payloadDir, { recursive: true });

      const awsCliPkg = path.join(expandDir, "aws-cli.pkg");
      if (fs.existsSync(path.join(awsCliPkg, "Payload"))) {
        execSync(`cd "${payloadDir}" && cat "${awsCliPkg}/Payload" | cpio -idm 2>/dev/null || true`, {
          stdio: "pipe",
        });
      }

      const awsBinSrc = path.join(payloadDir, "aws-cli", "aws");
      if (fs.existsSync(awsBinSrc)) {
        copyDirSync(path.join(payloadDir, "aws-cli"), destDir);
        fs.chmodSync(path.join(destDir, "aws"), 0o755);
        console.log(`  ✓ AWS CLI v2 installed to vendor/aws-cli/`);
      } else {
        console.log("  AWS CLI: could not locate binary in .pkg payload, skipping");
      }
    } else if (platform.os === "windows") {
      console.log("  AWS CLI: Windows uses MSI installer, skipping vendor install");
      console.log("  Install from: https://awscli.amazonaws.com/AWSCLIV2.msi");
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  // Skip in CI or if AGENT_ARMY_SKIP_POSTINSTALL is set
  if (process.env.AGENT_ARMY_SKIP_POSTINSTALL || process.env.CI) {
    console.log("agent-army: skipping postinstall (CI or AGENT_ARMY_SKIP_POSTINSTALL set)");
    return;
  }

  const platform = getPlatform();
  if (!platform) {
    console.log(`agent-army: unsupported platform (${process.platform}/${process.arch}), skipping vendor install`);
    console.log("  Pulumi and AWS CLI must be installed manually.");
    return;
  }

  console.log(`agent-army: installing vendored binaries (${platform.os}/${platform.arch})...`);

  // Install Pulumi
  try {
    await installPulumi(platform);
  } catch (err) {
    console.warn(`  ✗ Failed to install Pulumi: ${err instanceof Error ? err.message : String(err)}`);
    console.warn("  The CLI will fall back to system PATH for Pulumi.");
  }

  // Install AWS CLI
  try {
    await installAwsCli(platform);
  } catch (err) {
    console.warn(`  ✗ Failed to install AWS CLI: ${err instanceof Error ? err.message : String(err)}`);
    console.warn("  The CLI will fall back to system PATH for AWS CLI.");
  }

  console.log("agent-army: postinstall complete.");
}

main().catch((err) => {
  // Non-fatal — the CLI will fall back to system PATH
  console.warn(`agent-army postinstall: ${err instanceof Error ? err.message : String(err)}`);
  console.warn("  Vendored binaries may not be available. Falling back to system PATH.");
  process.exit(0); // Exit 0 so npm install doesn't fail
});
