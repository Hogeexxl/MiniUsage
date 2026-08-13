//! Bundled model pricing for the cost domain.

/// Per-token rates expressed in USD nanodollars.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TokenRates {
    pub input_nanos_per_token: i64,
    pub cached_input_nanos_per_token: i64,
    pub cache_write_nanos_per_token: Option<i64>,
    pub output_nanos_per_token: i64,
}

impl TokenRates {
    pub const fn new(
        input_nanos_per_token: i64,
        cached_input_nanos_per_token: i64,
        cache_write_nanos_per_token: Option<i64>,
        output_nanos_per_token: i64,
    ) -> Self {
        Self {
            input_nanos_per_token,
            cached_input_nanos_per_token,
            cache_write_nanos_per_token,
            output_nanos_per_token,
        }
    }

    pub(crate) fn has_non_negative_rates(self) -> bool {
        self.input_nanos_per_token >= 0
            && self.cached_input_nanos_per_token >= 0
            && self
                .cache_write_nanos_per_token
                .is_none_or(|rate| rate >= 0)
            && self.output_nanos_per_token >= 0
    }
}

/// Pricing rules used after a model's prompt crosses its context threshold.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LongContextPolicy {
    pub threshold_input_tokens: i64,
    pub rates: TokenRates,
}

impl LongContextPolicy {
    pub const fn new(threshold_input_tokens: i64, rates: TokenRates) -> Self {
        Self {
            threshold_input_tokens,
            rates,
        }
    }
}

/// A model's versioned pricing rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModelPricing {
    pub canonical_model_id: &'static str,
    pub aliases: &'static [&'static str],
    pub effective_from_ms: i64,
    pub effective_to_ms: Option<i64>,
    pub short_context: TokenRates,
    pub long_context: Option<LongContextPolicy>,
}

impl ModelPricing {
    /// Returns whether the pricing rule is active at the given timestamp.
    /// The upper bound is exclusive when one is present.
    pub const fn is_effective_at(&self, occurred_at_ms: i64) -> bool {
        occurred_at_ms >= self.effective_from_ms
            && match self.effective_to_ms {
                Some(effective_to_ms) => occurred_at_ms < effective_to_ms,
                None => true,
            }
    }
}

/// Exact model/alias lookup against the bundled catalog.
pub trait PricingRepository {
    fn resolve(&self, model: &str, occurred_at_ms: i64) -> Option<&ModelPricing>;
}

const CATALOG_EFFECTIVE_FROM_MS: i64 = i64::MIN;

const GPT_5_6_SOL_ALIASES: &[&str] = &["gpt-5.6"];
const GPT_5_6_TERRA_ALIASES: &[&str] = &[];
const GPT_5_6_LUNA_ALIASES: &[&str] = &["codex-auto-review"];

/// GPT-5.6 Sol Standard pricing.
pub const GPT_5_6_SOL_PRICING: ModelPricing = ModelPricing {
    canonical_model_id: "gpt-5.6-sol",
    aliases: GPT_5_6_SOL_ALIASES,
    effective_from_ms: CATALOG_EFFECTIVE_FROM_MS,
    effective_to_ms: None,
    short_context: TokenRates::new(5_000, 500, Some(6_250), 30_000),
    long_context: Some(LongContextPolicy::new(
        272_000,
        TokenRates::new(10_000, 1_000, Some(12_500), 45_000),
    )),
};

/// GPT-5.6 Terra Standard pricing.
pub const GPT_5_6_TERRA_PRICING: ModelPricing = ModelPricing {
    canonical_model_id: "gpt-5.6-terra",
    aliases: GPT_5_6_TERRA_ALIASES,
    effective_from_ms: CATALOG_EFFECTIVE_FROM_MS,
    effective_to_ms: None,
    short_context: TokenRates::new(2_000, 200, Some(2_500), 12_000),
    long_context: Some(LongContextPolicy::new(
        272_000,
        TokenRates::new(4_000, 400, Some(5_000), 18_000),
    )),
};

/// GPT-5.6 Luna Standard pricing.
pub const GPT_5_6_LUNA_PRICING: ModelPricing = ModelPricing {
    canonical_model_id: "gpt-5.6-luna",
    aliases: GPT_5_6_LUNA_ALIASES,
    effective_from_ms: CATALOG_EFFECTIVE_FROM_MS,
    effective_to_ms: None,
    short_context: TokenRates::new(200, 20, Some(250), 1_200),
    long_context: Some(LongContextPolicy::new(
        272_000,
        TokenRates::new(400, 40, Some(500), 1_800),
    )),
};

/// The immutable bundled Standard catalog.
pub const BUNDLED_PRICING_CATALOG: &[ModelPricing] = &[
    GPT_5_6_SOL_PRICING,
    GPT_5_6_TERRA_PRICING,
    GPT_5_6_LUNA_PRICING,
];

/// Repository backed by the fixed bundled catalog.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BundledPricingRepository;

impl BundledPricingRepository {
    pub const fn new() -> Self {
        Self
    }

    pub const fn catalog(&self) -> &'static [ModelPricing] {
        BUNDLED_PRICING_CATALOG
    }

    pub fn resolve(&self, model: &str, occurred_at_ms: i64) -> Option<&'static ModelPricing> {
        resolve_from_catalog(BUNDLED_PRICING_CATALOG, model, occurred_at_ms)
    }
}

impl PricingRepository for BundledPricingRepository {
    fn resolve(&self, model: &str, occurred_at_ms: i64) -> Option<&ModelPricing> {
        Self::resolve(self, model, occurred_at_ms)
    }
}

fn resolve_from_catalog(
    catalog: &'static [ModelPricing],
    model: &str,
    occurred_at_ms: i64,
) -> Option<&'static ModelPricing> {
    catalog
        .iter()
        .find(|pricing| {
            pricing.canonical_model_id == model && pricing.is_effective_at(occurred_at_ms)
        })
        .or_else(|| {
            catalog.iter().find(|pricing| {
                pricing.aliases.contains(&model) && pricing.is_effective_at(occurred_at_ms)
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_mu03_b01_pricing_catalog_contract() {
        let repository = BundledPricingRepository::new();

        let sol = repository.resolve("gpt-5.6-sol", 0).expect("Sol pricing");
        assert_eq!(sol.canonical_model_id, "gpt-5.6-sol");
        assert_eq!(
            sol.short_context,
            TokenRates::new(5_000, 500, Some(6_250), 30_000)
        );
        assert_eq!(
            sol.long_context.expect("Sol long pricing").rates,
            TokenRates::new(10_000, 1_000, Some(12_500), 45_000)
        );
        assert_eq!(
            sol.long_context
                .expect("Sol long pricing")
                .threshold_input_tokens,
            272_000
        );

        let terra = repository
            .resolve("gpt-5.6-terra", 0)
            .expect("Terra pricing");
        assert_eq!(
            terra.short_context,
            TokenRates::new(2_000, 200, Some(2_500), 12_000)
        );
        assert_eq!(
            terra.long_context.expect("Terra long pricing").rates,
            TokenRates::new(4_000, 400, Some(5_000), 18_000)
        );

        let luna = repository.resolve("gpt-5.6-luna", 0).expect("Luna pricing");
        assert_eq!(
            luna.short_context,
            TokenRates::new(200, 20, Some(250), 1_200)
        );
        assert_eq!(
            luna.long_context.expect("Luna long pricing").rates,
            TokenRates::new(400, 40, Some(500), 1_800)
        );

        let alias = repository.resolve("gpt-5.6", 0).expect("gpt-5.6 alias");
        assert_eq!(alias.canonical_model_id, "gpt-5.6-sol");
        assert_eq!(alias.short_context, sol.short_context);
        assert!(repository.resolve("gpt-5.6-s", 0).is_none());
        assert!(repository.resolve("unknown-model", 0).is_none());
    }

    #[test]
    fn t_mu04_a01_pricing_alias_matrix() {
        let repository = BundledPricingRepository::new();

        let sol = repository.resolve("gpt-5.6-sol", 0).expect("Sol pricing");
        let sol_alias = repository.resolve("gpt-5.6", 0).expect("Sol alias");
        assert_eq!(sol_alias.canonical_model_id, "gpt-5.6-sol");
        assert_eq!(
            sol.short_context,
            TokenRates::new(5_000, 500, Some(6_250), 30_000)
        );
        assert_eq!(
            sol.long_context.expect("Sol long pricing").rates,
            TokenRates::new(10_000, 1_000, Some(12_500), 45_000)
        );
        assert_eq!(sol_alias.short_context, sol.short_context);
        assert_eq!(sol_alias.long_context, sol.long_context);

        let luna = repository.resolve("gpt-5.6-luna", 0).expect("Luna pricing");
        let luna_alias = repository
            .resolve("codex-auto-review", 0)
            .expect("Luna alias");
        assert_eq!(luna_alias.canonical_model_id, "gpt-5.6-luna");
        assert_eq!(
            luna.short_context,
            TokenRates::new(200, 20, Some(250), 1_200)
        );
        assert_eq!(
            luna.long_context.expect("Luna long pricing").rates,
            TokenRates::new(400, 40, Some(500), 1_800)
        );
        assert_eq!(luna_alias.short_context, luna.short_context);
        assert_eq!(luna_alias.long_context, luna.long_context);

        assert!(repository.resolve("unknown-model", 0).is_none());
    }
}
