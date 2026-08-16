import { Shell } from "@/components/Shell";
import { APP_NAME } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell appName={APP_NAME}>{children}</Shell>;
}
