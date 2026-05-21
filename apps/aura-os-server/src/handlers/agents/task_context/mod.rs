//! Task-context resolver shared by the dev-loop and chat agent's
//! `get_task_context` tool surface.
//!
//! The harness exposes a `get_task_context` tool that returns the
//! task's `title`, `description`, `spec`, `status`, immediate
//! `parent` / `children`, recent `execution_notes`, and the
//! `task_version`. This module owns the pure shaping + caching layer
//! the server's tool wiring uses to populate the response.
//!
//! ## Layout
//!
//! * [`build_task_context`] — pure builder that takes a `&Task`,
//!   pre-fetched parent/children references, optional spec body, and
//!   a version stamp; performs no I/O.
//! * [`TaskContextResolver`] — bounded `(TaskId, version)`-keyed
//!   cache wrapping [`build_task_context`]. The server hands it a
//!   small `fetcher` closure that does the storage round-trip on
//!   miss; consecutive calls within one run hit the cache.
//! * [`TaskContext`] / [`TaskRef`] — wire types serialized straight
//!   into the tool result.

pub(crate) mod cache;
pub(crate) mod error;
pub(crate) mod resolver;

#[cfg(test)]
mod tests;

#[allow(unused_imports)]
pub(crate) use cache::{TaskContextCache, MAX_CACHE_ENTRIES};
#[allow(unused_imports)]
pub(crate) use error::TaskContextError;
#[allow(unused_imports)]
pub(crate) use resolver::{
    build_task_context, TaskContext, TaskContextInputs, TaskContextResolver, TaskRef,
    MAX_EXECUTION_NOTES_LEN,
};
