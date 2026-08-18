CREATE TABLE skill_usage_events (
    ledger_epoch INTEGER NOT NULL CHECK (ledger_epoch > 0),
    source_file_id INTEGER NOT NULL,
    file_generation INTEGER NOT NULL CHECK (file_generation > 0),
    source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
    source_end_offset INTEGER NOT NULL CHECK (source_end_offset > source_start_offset),
    occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
    thread_id TEXT NOT NULL CHECK (length(thread_id) > 0),
    root_session_id TEXT NOT NULL CHECK (length(root_session_id) > 0),
    model TEXT,
    skill_name TEXT NOT NULL CHECK (length(skill_name) > 0 AND length(skill_name) <= 128),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    PRIMARY KEY (ledger_epoch, source_file_id, file_generation, source_start_offset, skill_name),
    FOREIGN KEY (source_file_id) REFERENCES source_files(source_file_id) ON DELETE CASCADE
);

CREATE INDEX idx_skill_usage_epoch_time
    ON skill_usage_events(ledger_epoch, occurred_at_ms);
CREATE INDEX idx_skill_usage_epoch_root_time
    ON skill_usage_events(ledger_epoch, root_session_id, occurred_at_ms);
CREATE INDEX idx_skill_usage_epoch_model_time
    ON skill_usage_events(ledger_epoch, model, occurred_at_ms);
CREATE INDEX idx_skill_usage_epoch_source_start
    ON skill_usage_events(ledger_epoch, source_file_id, source_start_offset);
