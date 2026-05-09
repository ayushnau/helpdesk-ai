"use client";

import { Sidebar, DashboardTopstrip } from "@/components/sidebar";
import { RequireAuth } from "@/components/auth-provider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="app-shell">
        <Sidebar />
        <main className="app-main">
          <DashboardTopstrip />
          <div className="app-content">{children}</div>
        </main>
      </div>
    </RequireAuth>
  );
}
