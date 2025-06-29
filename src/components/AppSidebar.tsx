
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Calendar, Send, Users, BarChart3, CreditCard, LogOut } from 'lucide-react';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';

const navigation = [
  { name: 'לוח בקרה', href: '/dashboard', icon: BarChart3 },
  { name: 'כתיבת הודעה', href: '/compose', icon: MessageSquare },
  { name: 'הודעות מתוזמנות', href: '/scheduled', icon: Calendar },
  { name: 'הודעות שנשלחו', href: '/sent', icon: Send },
  { name: 'קבוצות', href: '/segments', icon: Users },
  { name: 'חיבור WhatsApp', href: '/connect', icon: MessageSquare },
];

export function AppSidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: profile } = useUserProfile();
  const { state, isMobile, setOpen } = useSidebar();

  const handleSignOut = async () => {
    await logout();
    navigate('/');
  };

  const getUserInitials = () => {
    if (profile?.name) {
      return profile.name.split(' ').map(n => n[0]).join('').toUpperCase();
    }
    if (user?.email) {
      return user.email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  const isCollapsed = state === 'collapsed';

  const handleSidebarClick = () => {
    if (isMobile) {
      setOpen(false);
    }
  };

  return (
    <Sidebar 
      side="right" 
      collapsible="icon"
      className={isCollapsed ? "w-14" : "w-64"}
    >
      <SidebarHeader className="p-4">
        <div className="flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2" onClick={handleSidebarClick}>
            <MessageSquare className="h-8 w-8 text-green-600 flex-shrink-0" />
            {!isCollapsed && (
              <span className="text-xl font-bold text-gray-900">WhatsApp Manager</span>
            )}
          </Link>
          {!isCollapsed && <SidebarTrigger className="h-7 w-7" />}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive}
                      tooltip={isCollapsed ? item.name : undefined}
                    >
                      <Link to={item.href} className="flex items-center gap-3" onClick={handleSidebarClick}>
                        <item.icon className="h-5 w-5 flex-shrink-0" />
                        {!isCollapsed && <span>{item.name}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="space-y-4">
          <SidebarSeparator />
          
          {!isCollapsed && (
            <div className="flex items-center gap-3 mb-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-green-100 text-green-700 text-sm">
                  {getUserInitials()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {profile?.name || user?.email || 'משתמש'}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {user?.email}
                </p>
              </div>
            </div>
          )}
          
          {isCollapsed && (
            <div className="flex justify-center mb-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-green-100 text-green-700 text-sm">
                  {getUserInitials()}
                </AvatarFallback>
              </Avatar>
            </div>
          )}
          
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton 
                asChild
                tooltip={isCollapsed ? "תשלום" : undefined}
              >
                <Link to="/billing" className="flex items-center gap-2" onClick={handleSidebarClick}>
                  <CreditCard className="h-4 w-4 flex-shrink-0" />
                  {!isCollapsed && "תשלום"}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton 
                onClick={handleSignOut}
                tooltip={isCollapsed ? "התנתק" : undefined}
              >
                <LogOut className="h-4 w-4 flex-shrink-0" />
                {!isCollapsed && "התנתק"}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
