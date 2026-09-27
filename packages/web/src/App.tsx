import "./css/tailwind.css";
import { RouterProvider } from "@tanstack/react-router";
import { ServiceProvider } from "./contexts/ServiceContext";
import { AuthProvider } from "./contexts/AuthContext";
import { UIStateProvider } from "./contexts/UIStateContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ThemeSync } from "./contexts/ThemeSync";
import { UserConfigProvider } from "./contexts/UserConfigProvider";
import { ToastProvider } from "./contexts/ToastContext";
import type { createAppRouter } from "./router";

interface AppProps {
  router: ReturnType<typeof createAppRouter>;
}

function App({ router }: AppProps) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ServiceProvider>
          <AuthProvider>
            <UserConfigProvider>
              <ThemeSync />
              <UIStateProvider>
                <RouterProvider router={router} />
              </UIStateProvider>
            </UserConfigProvider>
          </AuthProvider>
        </ServiceProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
