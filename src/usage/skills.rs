#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillUsageEvent {
    pub occurred_at_ms: i64,
    pub thread_id: String,
    pub root_session_id: String,
    pub model: Option<String>,
    pub skill_name: String,
    pub source_file_id: i64,
    pub file_generation: i64,
    pub source_start_offset: u64,
    pub source_end_offset: u64,
}
