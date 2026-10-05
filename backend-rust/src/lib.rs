#![forbid(unsafe_code)]

pub mod api;
pub mod app;
pub mod auth;
pub mod backups;
pub mod cache;
pub mod chat;
pub mod connections;
pub mod content;
pub mod dashboard;
pub mod db;
pub mod email;
pub mod error;
pub mod exam_admin;
pub mod exam_import;
pub mod exams;
pub mod google_oidc;
pub mod instructor_access;
pub mod instructors;
pub mod materials;
pub mod observability;
pub mod registration;
pub mod runtime_config;
pub mod security;
pub mod seo;
pub mod system_status;
pub mod uploads;
pub mod users;
pub mod video;
pub mod vpn;

pub use app::{AppState, build_router};
