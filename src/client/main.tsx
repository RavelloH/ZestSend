import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { GlobalLiquidBackground } from "./components/GlobalLiquidBackground";
import { GlobalScrollbars } from "./components/GlobalScrollbars";
import { ThemeProvider } from "./components/theme";
import { router } from "./router";
import "./styles.css";

document.documentElement.classList.add("dark");
document.documentElement.style.colorScheme = "dark";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <GlobalScrollbars />
    <GlobalLiquidBackground />
    <div className="relative z-10 min-h-screen">
      <RouterProvider router={router} />
    </div>
  </ThemeProvider>,
);
