import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TestServiceProvider } from "../../contexts/ServiceContext";
import { AuthProvider } from "../../contexts/AuthContext";
import { ToastProvider } from "../../contexts/ToastContext";
import { UserConfigProvider } from "../../contexts/UserConfigProvider";
import { MockAuthService } from "../../services/auth/MockAuthService";

/**
 * The config store as a signed-out visitor has it: the demo's, over this device's storage.
 * Use it as a render `wrapper` for a page or hook that reads or saves the demo's config.
 */
export function DemoStore({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  const [authService] = useState(() => new MockAuthService(null));
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TestServiceProvider authService={authService}>
          <AuthProvider>
            <UserConfigProvider>{children}</UserConfigProvider>
          </AuthProvider>
        </TestServiceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
