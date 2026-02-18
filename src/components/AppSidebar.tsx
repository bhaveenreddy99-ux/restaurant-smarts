import {
  LayoutDashboard,
  Package,
  ClipboardList,
  ShoppingCart,
  BookOpen,
  Truck,
  BarChart3,
  Users,
  ChefHat,
  LogOut,
  Receipt,
  Settings,
  Bell,
  AlertTriangle as AlertIcon,
  Clock,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const mainNav = [
  { title: "Dashboard", url: "/app/dashboard", icon: LayoutDashboard },
];

const inventoryNav = [
  { title: "List Management", url: "/app/inventory/lists", icon: ClipboardList },
  { title: "PAR List", url: "/app/par", icon: BookOpen },
  { title: "Inventory Management", url: "/app/inventory/enter", icon: Package },
  { title: "Smart Order", url: "/app/smart-order", icon: ShoppingCart },
  { title: "Purchase History", url: "/app/purchase-history", icon: Receipt },
];

const operationsNav = [
  { title: "Orders", url: "/app/orders", icon: Truck },
];

const insightsNav = [
  { title: "Reports", url: "/app/reports", icon: BarChart3 },
];

const notificationsNav = [
  { title: "Notifications", url: "/app/notifications", icon: Bell },
];

const adminNav = [
  { title: "Staff", url: "/app/staff", icon: Users },
  { title: "Settings", url: "/app/settings", icon: Settings },
  { title: "Alert Settings", url: "/app/settings/alerts", icon: AlertIcon },
  { title: "Reminders", url: "/app/settings/reminders", icon: Clock },
];

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { currentRestaurant } = useRestaurant();

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");
  const isOwner = currentRestaurant?.role === "OWNER";
  const isManagerPlus = isOwner || currentRestaurant?.role === "MANAGER";

  const renderGroup = (label: string, items: typeof mainNav) => (
    <SidebarGroup key={label}>
      <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] font-semibold uppercase tracking-[0.08em] px-3 mb-1">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.url)}
              >
                <NavLink
                  to={item.url}
                  end={item.url === "/app/dashboard"}
                  className="gap-3 px-3 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-lg transition-all duration-150"
                  activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                >
                  <item.icon className="h-4 w-4 shrink-0 opacity-70" />
                  <span>{item.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      <div className="p-4 pb-2">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary/10">
            <ChefHat className="h-4.5 w-4.5 text-sidebar-primary" />
          </div>
          <span className="text-[15px] font-bold text-sidebar-accent-foreground tracking-tight">
            Resta<span className="text-sidebar-primary">rentIQ</span>
          </span>
        </div>
      </div>

      <SidebarContent className="px-2 pt-2">
        {renderGroup("Overview", mainNav)}
        {renderGroup("Inventory", inventoryNav)}
        
        {renderGroup("Operations", operationsNav)}
        {renderGroup("Insights", insightsNav)}
        {renderGroup("Alerts", notificationsNav)}
        {isManagerPlus && renderGroup("Admin", isOwner ? adminNav : adminNav.filter(n => n.url === "/app/settings"))}
      </SidebarContent>

      <SidebarFooter className="p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 text-[13px] text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg h-9"
          onClick={() => { signOut(); navigate("/"); }}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}