from pathlib import Path

path = Path(__file__).with_name("v013-implement.py")
text = path.read_text(encoding="utf-8")
old = 'replace_once("src/codex/mod.rs", "mod global_state;\\nmod metadata;", "mod global_state;\\nmod metadata;\\nmod skill_usage;")'
new = 'replace_once("src/codex/mod.rs", "pub mod global_state;\\npub mod metadata;", "pub mod global_state;\\npub mod metadata;\\nmod skill_usage;")'
if old in text:
    text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
