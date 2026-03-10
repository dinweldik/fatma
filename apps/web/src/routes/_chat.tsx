import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import MobileBottomNav, { mobileBottomNavHeight } from "../components/MobileBottomNav";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import ThreadSidebar from "../components/Sidebar";
import { MobileViewportProvider } from "../mobileViewport";
import { isElectron } from "../env";
import { Sidebar, SidebarProvider } from "~/components/ui/sidebar";
import { useMobileViewport } from "../mobileViewport";

function ChatRouteLayout() {
  const navigate = useNavigate();
  const mobileViewport = useMobileViewport();
  const showMobileBottomNav = mobileViewport.isMobile && !mobileViewport.isKeyboardOpen && !isElectron;

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          "--app-mobile-bottom-nav-height": mobileBottomNavHeight(showMobileBottomNav),
        } as React.CSSProperties
      }
    >
      {mobileViewport.isMobile ? null : (
        <Sidebar
          side="left"
          collapsible="offcanvas"
          className="border-r border-border bg-card text-foreground"
        >
          <ThreadSidebar />
        </Sidebar>
      )}
      <DiffWorkerPoolProvider>
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
          <MobileBottomNav />
        </div>
      </DiffWorkerPoolProvider>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: function ChatRouteLayoutWithViewport() {
    return (
      <MobileViewportProvider>
        <ChatRouteLayout />
      </MobileViewportProvider>
    );
  },
});
