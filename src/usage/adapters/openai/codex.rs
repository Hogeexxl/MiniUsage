//! Codex rollout raw token schema to the MU canonical token schema.

use crate::domain::DomainError;
use crate::usage::normalized::NormalizedTokenUsage;

/// Raw names are intentionally kept at this boundary because they mirror the
/// Codex rollout JSONL wire format.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexRawTokenUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub cache_write_input_tokens: Option<i64>,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
}

pub struct CodexRolloutAdapter;

impl CodexRolloutAdapter {
    pub fn normalize(raw: CodexRawTokenUsage) -> Result<NormalizedTokenUsage, DomainError> {
        NormalizedTokenUsage::new(
            raw.input_tokens,
            raw.cached_input_tokens,
            raw.cache_write_input_tokens,
            raw.output_tokens,
            raw.reasoning_output_tokens,
            raw.total_tokens,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(write: Option<i64>) -> CodexRawTokenUsage {
        CodexRawTokenUsage {
            input_tokens: 10_000,
            cached_input_tokens: 6_000,
            cache_write_input_tokens: write,
            output_tokens: 1_500,
            reasoning_output_tokens: 500,
            total_tokens: 11_500,
        }
    }

    #[test]
    fn t_dc_011_to_015_maps_and_validates_raw_values() {
        let normalized = CodexRolloutAdapter::normalize(raw(Some(2_000))).unwrap();
        assert_eq!(normalized.cached_tokens, 6_000);
        assert_eq!(normalized.cache_write_tokens, Some(2_000));
        assert_eq!(normalized.reasoning_tokens, 500);
        assert_eq!(
            CodexRolloutAdapter::normalize(raw(Some(0)))
                .unwrap()
                .cache_write_tokens,
            Some(0)
        );
        assert!(CodexRolloutAdapter::normalize(raw(None)).is_ok());
        assert!(
            CodexRolloutAdapter::normalize(CodexRawTokenUsage {
                cached_input_tokens: 11_000,
                ..raw(None)
            })
            .is_err()
        );
        assert!(
            CodexRolloutAdapter::normalize(CodexRawTokenUsage {
                reasoning_output_tokens: 1_501,
                ..raw(None)
            })
            .is_err()
        );
        assert!(
            CodexRolloutAdapter::normalize(CodexRawTokenUsage {
                total_tokens: 1,
                ..raw(None)
            })
            .is_err()
        );
        assert!(
            CodexRolloutAdapter::normalize(CodexRawTokenUsage {
                cache_write_input_tokens: Some(5_000),
                ..raw(None)
            })
            .is_err()
        );
    }
}
