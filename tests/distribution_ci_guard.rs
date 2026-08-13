use std::{fs, path::PathBuf};

fn workflow() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(".github")
        .join("workflows")
        .join("ci.yml");
    fs::read_to_string(path).expect("read GitHub CI workflow")
}

#[test]
fn t_dist_011_ci_workflow_covers_required_matrix_and_commands() {
    let ci = workflow();

    for required in [
        "on:\n  push:\n  pull_request:",
        "permissions:\n  contents: read",
        "frontend:",
        "rust-format:",
        "rust:",
        "embedded:",
        "runs-on: ubuntu-latest",
        "os: windows-latest",
        "os: macos-latest",
        "architecture: AMD64",
        "architecture: arm64",
        "uses: actions/checkout@v4",
        "uses: actions/setup-node@v4",
        "uses: dtolnay/rust-toolchain@stable",
        "uses: Swatinem/rust-cache@v2",
        "run: npm ci",
        "run: npm test",
        "run: npm run check",
        "run: npm run build",
        "run: cargo fmt --check",
        "run: cargo check --locked",
        "run: cargo test --locked",
        "cargo build --release --locked --features embedded-frontend",
        "cargo test --locked --test distribution_runtime_integration",
        "cargo test --locked file_identity",
        "cargo test --locked scanner",
        "PROCESSOR_ARCHITECTURE",
        "uname -m",
    ] {
        assert!(ci.contains(required), "CI workflow is missing: {required}");
    }
}

#[test]
fn t_dist_011_ci_workflow_excludes_unsupported_macos_intel_targets() {
    let ci = workflow();
    for forbidden in [
        "macos-15-intel",
        "macOS Intel x64",
        "architecture: x86_64",
        "macos-x64.dmg",
        "x86_64.dmg",
    ] {
        assert!(
            !ci.contains(forbidden),
            "CI workflow must not reference unsupported macOS Intel artifacts or runners: {forbidden}"
        );
    }
}

#[test]
fn t_dist_011_ci_workflow_does_not_publish_release_assets() {
    let ci = workflow();
    for forbidden in [
        "release.yml",
        "softprops/action-gh-release",
        "actions/upload-release-asset",
        "cargo-packager",
        "upload_url",
        "workflow_dispatch:",
        "tags:",
    ] {
        assert!(
            !ci.contains(forbidden),
            "CI workflow must not publish release assets: {forbidden}"
        );
    }
}
