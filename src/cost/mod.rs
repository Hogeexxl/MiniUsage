pub(crate) mod estimator;
pub(crate) mod pricing;

pub use estimator::{
    CostEstimateError, CostEstimateOutcome, CostEstimationError, CostEstimator, EstimatedCost,
    UnknownCostReason,
};
pub use pricing::{
    BUNDLED_PRICING_CATALOG, BundledPricingRepository, GPT_5_6_LUNA_PRICING, GPT_5_6_SOL_PRICING,
    GPT_5_6_TERRA_PRICING, LongContextPolicy, ModelPricing, PricingRepository, TokenRates,
};

/// Cost algorithm version used by the derived estimate.
pub const COST_ALGORITHM_VERSION: i64 = 1;

/// Bundled pricing catalog version.
pub const PRICING_CATALOG_VERSION: i64 = 2;

/// Whether usage represents one model request or a compensation over events.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UsageCostGranularity {
    RequestScoped,
    AggregateCompensation,
}

/// Context tier selected for one usage estimate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContextTier {
    Short,
    Long,
}
