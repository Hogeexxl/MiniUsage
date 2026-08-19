from pathlib import Path
import subprocess


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    matches = text.count(old)
    if matches != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {matches}: {old!r}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "frontend/src/dashboard/session/useSessionTableController.ts",
    '  combined_total_tokens: "desc",\n  cache_hit_rate: "desc",',
    '  combined_total_tokens: "desc",\n  combined_estimated_cost: "desc",\n  cache_hit_rate: "desc",',
)
replace_once(
    "frontend/src/dashboard/session/useSessionTableController.ts",
    '  if (sortBy === "combined_total_tokens") comparison = compareNullableNumber(left.combined_total_tokens, right.combined_total_tokens, order);\n  return comparison || compareRootIds(left.root_session_id, right.root_session_id);',
    '  if (sortBy === "combined_total_tokens") comparison = compareNullableNumber(left.combined_total_tokens, right.combined_total_tokens, order);\n  if (sortBy === "combined_estimated_cost") comparison = compareNullableNumber(left.combined_estimated_cost, right.combined_estimated_cost, order);\n  return comparison || compareRootIds(left.root_session_id, right.root_session_id);',
)
replace_once(
    "Cargo.toml",
    'version = "0.1.3"',
    'version = "0.2.0"',
)

subprocess.run(["cargo", "fmt", "--all"], check=True)
subprocess.run(["cargo", "check"], check=True)

Path("tools/v020_finalize_patch.py").unlink(missing_ok=True)
Path(".github/workflows/v020-finalize.yml").unlink(missing_ok=True)
