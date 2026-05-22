/**
 * Smoke test for `LoginOverlay`. Verifies the modal mounts as a
 * `role="dialog"` over the public chat surface and that the close
 * button surfaces in the corner. Heavy zui chrome and the login
 * form internals are exercised in `LoginView`'s own suite — this
 * file only covers the overlay framing.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@cypher-asi/zui", () => ({
  Panel: ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div {...(rest as Record<string, unknown>)}>{children}</div>
  ),
  Text: ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div {...(rest as Record<string, unknown>)}>{children}</div>
  ),
}));

vi.mock("../../LoginView/use-login-form", () => ({
  useLoginForm: () => ({
    showResetPassword: false,
    activeTab: "signin",
    email: "",
    setEmail: vi.fn(),
    password: "",
    setPassword: vi.fn(),
    confirmPassword: "",
    setConfirmPassword: vi.fn(),
    name: "",
    setName: vi.fn(),
    inviteCode: "",
    setInviteCode: vi.fn(),
    error: null,
    loading: false,
    handleTabChange: vi.fn(),
    handleSubmit: vi.fn(),
    openResetPassword: vi.fn(),
    resetEmail: "",
    setResetEmail: vi.fn(),
    resetStatus: "idle",
    resetError: null,
    handleResetSubmit: vi.fn(),
    closeResetPassword: vi.fn(),
  }),
}));

vi.mock("../../LoginView/LoginForm", () => ({
  LoginForm: () => <form data-testid="login-form-stub" />,
}));

vi.mock("../../LoginView/ResetPasswordForm", () => ({
  ResetPasswordForm: () => <form data-testid="reset-password-form-stub" />,
}));

vi.mock("../../LoginView/LoginView.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { LoginOverlay } from "./LoginOverlay";

describe("LoginOverlay", () => {
  it("renders as a labelled dialog with a close button", () => {
    render(
      <MemoryRouter>
        <LoginOverlay />
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close login" })).toBeInTheDocument();
    expect(screen.getByTestId("login-form-stub")).toBeInTheDocument();
  });
});
