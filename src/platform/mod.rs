//! Small platform adapters shared by storage and scanner.

pub mod browser;
pub mod file_identity;
pub mod paths;

pub use file_identity::{FileMetadata, PlatformFileIdentity};
