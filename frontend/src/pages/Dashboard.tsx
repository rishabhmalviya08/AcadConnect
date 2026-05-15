import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { authApi, projectApi } from '../services/api';
import { Users, FolderKanban, Loader2, UserCircle, Mail, ShieldAlert } from 'lucide-react';

interface UserProfile {
  name: string;
  email: string;
  role: string;
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export const Dashboard = () => {
  const { user, token } = useAuthStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [groupsCount, setGroupsCount] = useState<number>(0);
  const [projectsCount, setProjectsCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchNotifications = async () => {
    const notificationsRes = await authApi.get('/users/notifications?limit=5');
    setNotifications(notificationsRes.data.notifications || []);
    setUnreadCount(notificationsRes.data.unread_count || 0);
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      setIsLoading(true);
      setError('');
      try {
        const profileRes = await authApi.get('/users/me');
        setProfile(profileRes.data.user);

        try {
          const groupsRes = await projectApi.get('/groups/me');
          setGroupsCount(groupsRes.data.groups?.length || 0);
        } catch {
          setGroupsCount(0);
        }

        const projectsRes = await projectApi.get('/projects/me');
        setProjectsCount(projectsRes.data.projects?.length || 0);

        await fetchNotifications();
      } catch (err: any) {
        console.error('Dashboard fetch error:', err);
        setError(err.response?.data?.error || 'Failed to load dashboard data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  useEffect(() => {
    if (!token) return;
    const wsUrl = import.meta.env.VITE_USER_SERVICE_WS_URL || `ws://${window.location.hostname}:3001/ws`;
    const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.type === 'notifications:update') {
          setNotifications(message.payload?.notifications || []);
          setUnreadCount(message.payload?.unread_count || 0);
        }
      } catch {
        // Ignore malformed messages.
      }
    };

    return () => ws.close();
  }, [token]);

  const handleMarkRead = async (id: string) => {
    try {
      await authApi.put(`/users/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // No-op for dashboard quick action.
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-medium border border-red-200">
        {error}
      </div>
    );
  }

  const stats = [
    { name: 'My Groups', value: groupsCount, icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { name: 'My Projects', value: projectsCount, icon: FolderKanban, color: 'text-blue-600', bg: 'bg-blue-100' },
    { name: 'Unread Alerts', value: unreadCount, icon: ShieldAlert, color: 'text-violet-600', bg: 'bg-violet-100' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-slate-900">
          Welcome back, {profile?.name || user?.name || 'User'}!
        </h2>
        <p className="text-slate-500">
          Here's what's happening in your academic portal today.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* User Profile Card */}
        <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="bg-slate-50 p-6 border-b border-slate-100 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-3xl font-bold mb-4 shadow-sm">
              {profile?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <h3 className="text-xl font-bold text-slate-900">{profile?.name}</h3>
            <span className="mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize bg-primary-50 text-primary-700">
              {profile?.role}
            </span>
          </div>
          <div className="p-6 space-y-4 flex-1">
            <div className="flex items-center gap-3">
              <UserCircle className="w-5 h-5 text-slate-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Full Name</p>
                <p className="text-sm font-semibold text-slate-900">{profile?.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-slate-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Email Address</p>
                <p className="text-sm font-semibold text-slate-900">{profile?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-slate-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Account Role</p>
                <p className="text-sm font-semibold text-slate-900 capitalize">{profile?.role}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats and Activity */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.name} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${stat.bg}`}>
                    <Icon className={`w-7 h-7 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{stat.name}</p>
                    <p className="text-3xl font-bold text-slate-900 mt-1">{stat.value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Recent Notifications</h3>
            {notifications.length === 0 ? (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-8 text-center">
                <p className="text-sm text-slate-500">No notifications yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => !n.is_read && handleMarkRead(n.id)}
                    className={`w-full text-left p-3 rounded-xl border ${n.is_read ? 'bg-white border-slate-200' : 'bg-violet-50 border-violet-200'}`}
                  >
                    <p className="text-sm font-medium text-slate-900">{n.title}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{n.message}</p>
                    <p className="text-xs text-slate-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
