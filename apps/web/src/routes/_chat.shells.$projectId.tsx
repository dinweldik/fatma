import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/shells/$projectId")({
  component: Outlet,
});
