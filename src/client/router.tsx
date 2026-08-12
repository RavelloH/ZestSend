import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import Home from "./pages/Home";
import Room from "./pages/Room";

const rootRoute = createRootRoute({ component: Outlet });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

const englishHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/en",
  component: () => <Home locale="en" />,
});

const chineseHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/zh",
  component: () => <Home locale="zh" />,
});

const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/room/$roomId",
  component: Room,
  validateSearch: (search: Record<string, unknown>) => search,
});

const routeTree = rootRoute.addChildren([homeRoute, englishHomeRoute, chineseHomeRoute, roomRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
