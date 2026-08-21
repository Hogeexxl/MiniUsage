pub(crate) mod estimator;
pub(crate) mod pricing;
pub(crate) mod registry;

pub use estimator::{CostEstimateOutcome, CostEstimator, UnknownCostReason};
pub use pricing::BundledPricingRepository;
pub use registry::ModelRegistry;

/// Cost algorithm version used by the derived estimate.
pub const COST_ALGORITHM_VERSION: i64 = 1;

/// Bundled pricing catalog version.
pub const PRICING_CATALOG_VERSION: i64 = 3;

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
