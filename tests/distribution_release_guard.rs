use std::{fs, path::PathBuf};

fn workflow() -> String {
    fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".github/workflows/release.yml"),
    )
    .expect("read release workflow")
    .replace("\r\n", "\n")
}

fn windows_smoke() -> String {
    fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".github/scripts/windows-release-smoke.ps1"),
    )
    .expect("read Windows release smoke")
    .replace("\r\n", "\n")
}

#[test]
fn t_dist_012_release_workflow_is_tag_gated_and_allows_explicit_dispatch() {
    let release = workflow();
    let windows_smoke = windows_smoke();
    assert!(release.contains("on:\n  push:\n    tags:\n      - 'v*.*.*'"));
    assert!(release.contains("  workflow_dispatch:\n"));
    assert!(!release.contains("pull_request:"));
    assert!(!release.contains("branches:"));
    assert!(release.contains("permissions:\n  contents: read"));
    assert!(release.contains("permissions:\n      contents: write"));
    assert!(
        release
            .matches("cargo metadata --no-deps --format-version 1")
            .count()
            >= 3
    );
    assert!(release.contains("^v(?<base>\\d+\\.\\d+\\.\\d+)(?<suffix>-rc\\.\\d+)?$"));
    assert!(release.matches("(-rc\\.[0-9]+)?$").count() >= 2);
    assert!(release.contains("$tagBase -ne $cargoVersion"));
    assert!(release.contains("tag_base=\"${BASH_REMATCH[1]}\""));
    assert!(release.contains("Stable release tag"));
    assert!(release.contains("${GITHUB_REF_NAME#v}"));
    assert!(release.contains("GITHUB_REPOSITORY"));
    assert!(release.contains("secrets.GITHUB_TOKEN"));
    assert!(!release.contains("secrets.PAT"));
    assert!(!release.contains("softprops/action-gh-release"));
    assert!(!release.contains("actions/upload-release-asset"));
    assert!(release.contains("sha256sum"));
    assert!(release.contains("SHA256SUMS.txt"));
    assert!(release.contains("gh release create"));
    assert!(release.contains("--verify-tag"));
    assert!(release.contains("release_args=(--verify-tag)"));
    assert!(release.contains("release_args+=(--draft --prerelease)"));
    assert!(release.contains("is_candidate=\"${{ steps.version.outputs.is_candidate }}\""));
    assert!(release.contains("\"${release_args[@]}\""));
    assert!(release.contains("windows_name=\"MiniUsage-v${version}-windows-x64-setup.exe\""));
    assert!(release.contains("macos_name=\"MiniUsage-v${version}-macos-arm64.dmg\""));
    assert!(release.contains("TAG_VERSION=$tagVersion"));
    assert!(release.contains("CARGO_VERSION=$cargoVersion"));
    assert!(windows_smoke.contains("expectedBinaryVersion = $env:CARGO_VERSION"));
    assert!(release.contains("X-MiniUsage-Version"));
}

#[test]
fn t_dist_012_release_jobs_build_only_supported_assets() {
    let release = workflow();
    for required in [
        "runs-on: windows-latest",
        "runs-on: macos-latest",
        "test \"$(uname -m)\" = \"arm64\"",
        "npm ci",
        "npm run build",
        "cargo test --locked",
        "cargo build --release --locked --features embedded-frontend",
        "cargo install cargo-packager --locked --version",
        "cargo packager --release --formats nsis",
        "cargo packager --release --formats dmg",
        "MiniUsage-v$env:TAG_VERSION-windows-x64-setup.exe",
        "MiniUsage-v${TAG_VERSION}-macos-arm64.dmg",
        "actions/upload-artifact@v4",
        "actions/download-artifact@v4",
    ] {
        assert!(
            release.contains(required),
            "release workflow is missing: {required}"
        );
    }
    for forbidden in [
        "macos-15-intel",
        "macOS Intel",
        "x86_64.dmg",
        "macos-x64.dmg",
    ] {
        assert!(
            !release.contains(forbidden),
            "release workflow contains unsupported Intel path: {forbidden}"
        );
    }
}

#[test]
fn t_dist_013_windows_release_has_static_runtime_and_install_smoke() {
    let release = workflow();
    let smoke = windows_smoke();
    for required in [
        "rustup component add llvm-tools-preview",
        "$env:RUSTFLAGS = '-C target-feature=+crt-static'",
        "dumpbin.exe",
        "llvm-readobj.exe",
        "VCRUNTIME|MSVCP",
        "Windows CUI|IMAGE_SUBSYSTEM_WINDOWS_CUI",
        "machine\\s+\\(x64\\)|IMAGE_FILE_MACHINE_AMD64|COFF-x86-64|\\b866\\b",
        "PE32\\+|IMAGE_NT_OPTIONAL_HDR64_MAGIC|Magic:\\s*0x20B\\b",
        "Build NSIS installer",
        "T-DIST-013 clean-runtime installer smoke",
        "./.github/scripts/windows-release-smoke.ps1",
    ] {
        assert!(
            release.contains(required),
            "release workflow is missing Windows runtime guard: {required}"
        );
    }
    for required in [
        "MINIUSAGE_DISABLE_BROWSER",
        "MINIUSAGE_CODEX_HOME",
        "MINIUSAGE_DATABASE_PATH",
        "Start-Process",
        "/api/health",
        "X-MiniUsage-App",
        "X-MiniUsage-Version",
        "http://127.0.0.1:3210/",
        "/acceptance/spa-route",
        "/api/acceptance-not-found",
        "Content-Type",
        "mu.sqlite3",
    ] {
        assert!(
            smoke.contains(required),
            "Windows smoke is missing: {required}"
        );
    }
}

#[test]
fn t_dist_014_macos_release_has_arm64_clean_runtime_smoke() {
    let release = workflow();
    for required in [
        "test \"$(uname -m)\" = \"arm64\"",
        "file target/release/mini-usage | grep -Eq 'arm64|aarch64'",
        "Build unsigned DMG",
        "T-DIST-014 clean-runtime arm64 DMG smoke",
        "hdiutil attach -plist -nobrowse -readonly",
        "find \"$mount_point\" -maxdepth 1 -type d -name '*.app'",
        "ditto \"$app\" \"$app_copy\"",
        "MINIUSAGE_DISABLE_BROWSER=1",
        "http://127.0.0.1:3210/api/health",
        "X-MiniUsage-App",
        "X-MiniUsage-Version",
        "http://127.0.0.1:3210/",
        "/acceptance/spa-route",
        "/api/acceptance-not-found",
        "Content-Type",
        "mu.sqlite3",
    ] {
        assert!(
            release.contains(required),
            "release workflow is missing macOS runtime guard: {required}"
        );
    }
}

#[test]
fn packager_metadata_uses_cargo_identity_without_runtime_resources_or_signing() {
    let manifest = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"),
    )
    .expect("read Cargo.toml")
    .replace("\r\n", "\n");
    assert!(manifest.contains("[package.metadata.packager]"));
    assert!(manifest.contains("product-name = \"MiniUsage\""));
    assert!(manifest.contains("identifier = \"com.hogeexxl.miniusage\""));
    assert!(manifest.contains("formats = [\"nsis\", \"dmg\"]"));
    assert!(!manifest.contains("resources"));
    assert!(!manifest.contains("codesign_identity"));
    assert!(!manifest.contains("signing_identity"));
}
