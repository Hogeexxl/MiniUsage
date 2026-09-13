import DashboardPage from "./dashboard/DashboardPage";
import { TrayPanelPage } from "./tray/TrayPanelPage";
import { TrayPanelMeasurementPage } from "./tray/TrayPanelMeasurementPage";

type ViteImportMeta = ImportMeta & { env: { MODE: string } };

export default function App() {
  const pathname = window.location.pathname;
  if ((import.meta as ViteImportMeta).env.MODE === "tray-measure" && (pathname === "/tray-measure" || pathname === "/tray-measure/")) {
    return <TrayPanelMeasurementPage />;
  }
  if (pathname === "/tray" || pathname === "/tray/") {
    return <TrayPanelPage />;
  }
  return <DashboardPage />;
}
