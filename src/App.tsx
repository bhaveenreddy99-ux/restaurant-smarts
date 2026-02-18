import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RestaurantProvider } from "@/contexts/RestaurantContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import LandingPage from "@/pages/Landing";
import LoginPage from "@/pages/Login";
import SignupPage from "@/pages/Signup";
import DemoPage from "@/pages/Demo";
import CreateRestaurantPage from "@/pages/onboarding/CreateRestaurant";
import AppLayout from "@/layouts/AppLayout";
import DashboardPage from "@/pages/app/Dashboard";
import ListManagementPage from "@/pages/app/ListManagement";
import EnterInventoryPage from "@/pages/app/inventory/EnterInventory";
// Review and Approved pages removed from sidebar — redirects handle old URLs
import ImportPage from "@/pages/app/inventory/Import";
import SmartOrderPage from "@/pages/app/SmartOrder";
import PARManagementPage from "@/pages/app/PARManagement";

import OrdersPage from "@/pages/app/Orders";
import ReportsPage from "@/pages/app/Reports";
import StaffPage from "@/pages/app/Staff";
import PurchaseHistoryPage from "@/pages/app/PurchaseHistory";
import SettingsPage from "@/pages/app/Settings";
import NotificationsPage from "@/pages/app/Notifications";
import AlertSettingsPage from "@/pages/app/settings/AlertSettings";
import ReminderSettingsPage from "@/pages/app/settings/ReminderSettings";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <RestaurantProvider>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/demo" element={<DemoPage />} />
              <Route path="/onboarding/create-restaurant" element={<CreateRestaurantPage />} />
              <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="inventory/lists" element={<ListManagementPage />} />
                <Route path="inventory/enter" element={<EnterInventoryPage />} />
                {/* Review and Approved routes kept for backward compat but redirect */}
                <Route path="inventory/review" element={<Navigate to="/app/inventory/enter" replace />} />
                <Route path="inventory/approved" element={<Navigate to="/app/inventory/enter" replace />} />
                <Route path="inventory/import/:listId" element={<ImportPage />} />
                <Route path="smart-order" element={<SmartOrderPage />} />
                <Route path="par" element={<PARManagementPage />} />
                
                <Route path="orders" element={<OrdersPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="staff" element={<StaffPage />} />
                <Route path="purchase-history" element={<PurchaseHistoryPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="settings/alerts" element={<AlertSettingsPage />} />
                <Route path="settings/reminders" element={<ReminderSettingsPage />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </RestaurantProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
