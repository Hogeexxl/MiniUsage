use std::path::PathBuf;

use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

#[cfg(feature = "embedded-frontend")]
use axum::{
    body::Body,
    http::{HeaderValue, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};

#[cfg(feature = "embedded-frontend")]
const INDEX_CACHE_CONTROL: &str = "no-cache";
#[cfg(feature = "embedded-frontend")]
const ASSET_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

#[derive(Clone)]
pub(crate) enum FrontendSource {
    Filesystem(PathBuf),
    #[cfg(feature = "embedded-frontend")]
    Embedded,
}

pub(crate) fn with_fallback(router: Router, source: FrontendSource) -> Router {
    match source {
        FrontendSource::Filesystem(static_dir) => router.fallback_service(
            ServeDir::new(&static_dir).fallback(ServeFile::new(static_dir.join("index.html"))),
        ),
        #[cfg(feature = "embedded-frontend")]
        FrontendSource::Embedded => router.fallback(embedded_asset),
    }
}

#[cfg(feature = "embedded-frontend")]
#[derive(rust_embed::RustEmbed)]
#[folder = "frontend/dist/"]
struct EmbeddedFrontend;

#[cfg(feature = "embedded-frontend")]
async fn embedded_asset(uri: Uri) -> Response {
    let requested_path = uri.path().trim_start_matches('/');
    let requested_path = if requested_path.is_empty() {
        "index.html"
    } else {
        requested_path
    };
    let (asset_path, asset) = match EmbeddedFrontend::get(requested_path) {
        Some(asset) => (requested_path, asset),
        None => match EmbeddedFrontend::get("index.html") {
            Some(asset) => ("index.html", asset),
            None => return StatusCode::NOT_FOUND.into_response(),
        },
    };

    let mime = mime_guess::from_path(asset_path).first_or_octet_stream();
    let cache_control = if asset_path == "index.html" {
        INDEX_CACHE_CONTROL
    } else {
        ASSET_CACHE_CONTROL
    };
    let mut response = Response::new(Body::from(asset.data.into_owned()));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).expect("MIME type is a valid header value"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    response
}

#[cfg(all(test, feature = "embedded-frontend"))]
mod tests {
    use super::*;

    #[test]
    fn embedded_dist_contains_the_production_entrypoint() {
        assert!(EmbeddedFrontend::get("index.html").is_some());
    }
}
