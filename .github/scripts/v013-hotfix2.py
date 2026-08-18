from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]

# These assertions describe the current/latest schema after Ledger::open or a
# completed migration. Historical fixture setup versions are intentionally
# left unchanged.
migrations_path = root / "src/storage/migrations.rs"
value = migrations_path.read_text(encoding="utf-8")
value = value.replace("assert_eq!(migrate(&mut fresh, 0).unwrap(), 8);", "assert_eq!(migrate(&mut fresh, 0).unwrap(), 9);")
value = value.replace("assert_eq!(migrate(&mut fresh, 8).unwrap(), 8);", "assert_eq!(migrate(&mut fresh, 9).unwrap(), 9);")
# t_s01_001 has already migrated the same in-memory database to latest. Its
# second call is an idempotence check, therefore current_version must be 9.
value = value.replace("assert_eq!(migrate(&mut connection, 8).unwrap(), 9);", "assert_eq!(migrate(&mut connection, 9).unwrap(), 9);")
value = value.replace("assert_eq!(ledger.schema_version().unwrap(), 8);", "assert_eq!(ledger.schema_version().unwrap(), 9);")
migrations_path.write_text(value, encoding="utf-8")

storage_path = root / "src/storage/mod.rs"
value = storage_path.read_text(encoding="utf-8")
value = re.sub(r"assert_eq!\((\w+)\.schema_version\(\)\.unwrap\(\), 8\);", r"assert_eq!(\1.schema_version().unwrap(), 9);", value)
storage_path.write_text(value, encoding="utf-8")
