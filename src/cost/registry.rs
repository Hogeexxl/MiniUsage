//! Raw model identity and provider resolution shared by cost and filtering.

use super::pricing::LITELLM_SNAPSHOT_MODEL_IDS;

/// Provider ownership of a raw rollout model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelProvider {
    OpenAI,
    RouteModels,
}

impl ModelProvider {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OpenAI => "openai",
            Self::RouteModels => "route-models",
        }
    }
}

/// The resolved identity used by pricing and filter projections.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModelResolution<'model> {
    pub provider: ModelProvider,
    pub canonical_model_id: &'model str,
    pub pricing_provider: Option<ModelProvider>,
    pub pricing_target: Option<&'model str>,
}

/// Internal raw-model registry. It has no network or user configuration.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ModelRegistry;

impl ModelRegistry {
    pub const fn new() -> Self {
        Self
    }

    pub fn resolve<'model>(&self, raw_model_id: &'model str) -> ModelResolution<'model> {
        match raw_model_id {
            "codex-auto-review" => ModelResolution {
                provider: ModelProvider::OpenAI,
                canonical_model_id: "gpt-5.6-luna",
                pricing_provider: Some(ModelProvider::OpenAI),
                pricing_target: Some("gpt-5.6-luna"),
            },
            "gpt-5.6" => ModelResolution {
                provider: ModelProvider::OpenAI,
                canonical_model_id: "gpt-5.6-sol",
                pricing_provider: Some(ModelProvider::OpenAI),
                pricing_target: Some("gpt-5.6-sol"),
            },
            "github-copilot/gpt-5.6-luna" => ModelResolution {
                provider: ModelProvider::RouteModels,
                canonical_model_id: "gpt-5.6-luna",
                pricing_provider: Some(ModelProvider::OpenAI),
                pricing_target: Some("gpt-5.6-luna"),
            },
            "gemini-3.7-flash" | "grok-4.6" | "kimi-k3" => ModelResolution {
                provider: ModelProvider::RouteModels,
                canonical_model_id: raw_model_id,
                pricing_provider: None,
                pricing_target: None,
            },
            model if is_openai_snapshot_model(model) => ModelResolution {
                provider: ModelProvider::OpenAI,
                canonical_model_id: raw_model_id,
                pricing_provider: Some(ModelProvider::OpenAI),
                pricing_target: Some(raw_model_id),
            },
            _ => ModelResolution {
                provider: ModelProvider::RouteModels,
                canonical_model_id: raw_model_id,
                pricing_provider: None,
                pricing_target: None,
            },
        }
    }
}

fn is_openai_snapshot_model(model: &str) -> bool {
    LITELLM_SNAPSHOT_MODEL_IDS.contains(&model)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_openai_snapshot_models_resolve_exactly() {
        let registry = ModelRegistry::new();
        for model in [
            "gpt-5.1-codex-mini",
            "gpt-5.2-codex",
            "gpt-5.3-codex",
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5.5",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
        ] {
            assert!(LITELLM_SNAPSHOT_MODEL_IDS.contains(&model));
            let resolution = registry.resolve(model);
            assert_eq!(resolution.provider, ModelProvider::OpenAI, "{model}");
            assert_eq!(resolution.canonical_model_id, model);
            assert_eq!(resolution.pricing_provider, Some(ModelProvider::OpenAI));
            assert_eq!(resolution.pricing_target, Some(model));
        }
    }

    #[test]
    fn non_token_litellm_entries_are_not_openai_registry_models() {
        let registry = ModelRegistry::new();

        for model in [
            "openai/container",
            "gpt-4o-audio-preview",
            "gpt-4o-mini-search-preview",
            "o3-deep-research",
        ] {
            let resolution = registry.resolve(model);
            assert_eq!(resolution.provider, ModelProvider::RouteModels, "{model}");
            assert_eq!(resolution.pricing_target, None);
        }
    }

    #[test]
    fn local_aliases_and_route_exceptions_share_registry_resolution() {
        let registry = ModelRegistry::new();

        let auto_review = registry.resolve("codex-auto-review");
        assert_eq!(auto_review.provider, ModelProvider::OpenAI);
        assert_eq!(auto_review.canonical_model_id, "gpt-5.6-luna");
        assert_eq!(auto_review.pricing_target, Some("gpt-5.6-luna"));

        let default_model = registry.resolve("gpt-5.6");
        assert_eq!(default_model.provider, ModelProvider::OpenAI);
        assert_eq!(default_model.canonical_model_id, "gpt-5.6-sol");
        assert_eq!(default_model.pricing_target, Some("gpt-5.6-sol"));

        let copilot = registry.resolve("github-copilot/gpt-5.6-luna");
        assert_eq!(copilot.provider, ModelProvider::RouteModels);
        assert_eq!(copilot.canonical_model_id, "gpt-5.6-luna");
        assert_eq!(copilot.pricing_provider, Some(ModelProvider::OpenAI));
        assert_eq!(copilot.pricing_target, Some("gpt-5.6-luna"));

        for model in ["gemini-3.7-flash", "grok-4.6", "kimi-k3", "raw-rollout-id"] {
            let resolution = registry.resolve(model);
            assert_eq!(resolution.provider, ModelProvider::RouteModels, "{model}");
            assert_eq!(resolution.canonical_model_id, model);
            assert_eq!(resolution.pricing_target, None);
        }
    }
}
