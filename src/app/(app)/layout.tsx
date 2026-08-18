import { AppNav } from "@/components/app/AppNav";
import { Toast } from "@/components/app/Toast";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <AppNav />
      <main className="max-w-[1536px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
      <Toast />
    </div>
  );
}
