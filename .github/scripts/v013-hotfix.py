from pathlib import Path

path = Path(__file__).with_name("v013-implement.py")
text = path.read_text(encoding="utf-8")
old = 'replace_once("src/codex/mod.rs", "mod global_state;\\nmod metadata;", "mod global_state;\\nmod metadata;\\nmod skill_usage;")'
new = 'replace_once("src/codex/mod.rs", "pub mod global_state;\\npub mod metadata;", "pub mod global_state;\\npub mod metadata;\\nmod skill_usage;")'
if old in text:
    text = text.replace(old, new, 1)
needle = '''pipeline = pipeline.replace("""        result,\n        last,""", """        result,\n        skill_events,\n        last,""")\n'''
addition = '''pipeline = pipeline.replace("""        result,\n        last,""", """        result,\n        skill_events,\n        last,""")\npipeline = pipeline.replace("""        },\n        last,""", """        },\n        skill_events,\n        last,""")\n'''
if needle in text and addition not in text:
    text = text.replace(needle, addition, 1)
path.write_text(text, encoding="utf-8")
