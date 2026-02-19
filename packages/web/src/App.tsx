import "./css/tailwind.css";
import { RouterProvider } from "@tanstack/react-router";
import { ServiceProvider } from "./contexts/ServiceContext";
import { AuthProvider } from "./contexts/AuthContext";
import { UIStateProvider } from "./contexts/UIStateContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import type { createAppRouter } from "./router";

interface AppProps {
  router: ReturnType<typeof createAppRouter>;
}

function App({ router }: AppProps) {
  return (
    <ThemeProvider>
      <ServiceProvider>
        <AuthProvider>
          <UIStateProvider>
            <RouterProvider router={router} />
          </UIStateProvider>
        </AuthProvider>
      </ServiceProvider>
    </ThemeProvider>
  );
}

export default App;
