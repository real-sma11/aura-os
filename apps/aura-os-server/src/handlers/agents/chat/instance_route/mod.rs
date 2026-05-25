//! `POST /v1/projects/:project_id/agents/:instance_id/chat/stream` route. Runs an agent instance chat turn — resolves the agent template + project metadata, forwards typed identity / skills / system prompt / project info wire fields, and hands off to the SSE driver.

mod client_retry;
mod helpers;
mod route;

pub(super) use client_retry::header_indicates_client_retry;
pub(crate) use route::send_event_stream;
