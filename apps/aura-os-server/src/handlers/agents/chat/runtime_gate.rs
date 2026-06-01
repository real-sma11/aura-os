use aura_os_core::HarnessMode;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub(super) fn ensure_chat_runtime_allowed(
    state: &AppState,
    harness_mode: HarnessMode,
) -> ApiResult<()> {
    if state.remote_only && harness_mode == HarnessMode::Local {
        return Err(ApiError::bad_request(
            "local agents can only be used in the desktop app",
        ));
    }
    Ok(())
}
