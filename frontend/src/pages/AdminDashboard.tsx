import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/api';
import {
  Loader2,
  Users,
  ScrollText,
  Shield,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface RowUser {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
  eligibility_status: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  details: string | Record<string, unknown>;
  created_at: string;
  admin_name?: string;
  admin_email?: string;
  target_name?: string | null;
  target_email?: string | null;
}

export const AdminDashboard = () => {
  const { user } = useAuthStore();

  const [users, setUsers] = useState<RowUser[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'created_at' | 'role'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState('');

  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const [logLimit] = useState(15);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState('');

  const [eligibilityUser, setEligibilityUser] = useState<RowUser | null>(null);
  const [eligibilityStatus, setEligibilityStatus] = useState<'eligible' | 'probation' | 'ineligible'>('eligible');
  const [eligibilityReason, setEligibilityReason] = useState('');
  const [eligibilitySaving, setEligibilitySaving] = useState(false);
  const [eligibilityError, setEligibilityError] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const params: Record<string, string> = {
        sort_by: sortBy,
        sort_dir: sortDir,
      };
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.eligibility_status = statusFilter;
      const res = await authApi.get('/admin/users', { params });
      setUsers(res.data.users || []);
    } catch (err: any) {
      setUsersError(err.response?.data?.error || 'Failed to load users.');
    } finally {
      setUsersLoading(false);
    }
  }, [roleFilter, statusFilter, sortBy, sortDir]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError('');
    try {
      const res = await authApi.get('/admin/audit-logs', {
        params: { page: logPage, limit: logLimit },
      });
      setLogs(res.data.logs || []);
      setLogTotal(res.data.total || 0);
    } catch (err: any) {
      setLogsError(err.response?.data?.error || 'Failed to load audit logs.');
    } finally {
      setLogsLoading(false);
    }
  }, [logPage, logLimit]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  const studentCount = users.filter((u) => u.role === 'student').length;
  const facultyCount = users.filter((u) => u.role === 'faculty').length;
  const adminCount = users.filter((u) => u.role === 'admin').length;

  const formatDetails = (d: AuditRow['details']) => {
    if (typeof d === 'string') {
      try {
        return JSON.stringify(JSON.parse(d), null, 2);
      } catch {
        return d;
      }
    }
    return JSON.stringify(d, null, 2);
  };

  const handleSaveEligibility = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eligibilityUser) return;
    setEligibilitySaving(true);
    setEligibilityError('');
    setActionMsg('');
    try {
      await authApi.put(`/admin/users/${eligibilityUser.id}/eligibility`, {
        eligibility_status: eligibilityStatus,
        reason: eligibilityReason.trim() || undefined,
      });
      setActionMsg(`Eligibility updated for ${eligibilityUser.name}.`);
      setEligibilityUser(null);
      setEligibilityReason('');
      fetchUsers();
      fetchLogs();
      setTimeout(() => setActionMsg(''), 5000);
    } catch (err: any) {
      setEligibilityError(err.response?.data?.error || 'Update failed.');
    } finally {
      setEligibilitySaving(false);
    }
  };

  const logPages = Math.max(1, Math.ceil(logTotal / logLimit));

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-primary-600" />
            Admin dashboard
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            User directory, student eligibility, and audit log monitoring.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            fetchUsers();
            fetchLogs();
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh all
        </button>
      </div>

      {actionMsg && (
        <div className="bg-emerald-50 text-emerald-800 text-sm font-medium px-4 py-3 rounded-xl border border-emerald-200">
          {actionMsg}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Counts and the table reflect the selected filters. Student status is eligibility (faculty and admins
        stay listed when a status filter is on). Use &quot;All roles&quot; and clear status for full directory
        totals.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total users</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{users.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Students</p>
          <p className="text-3xl font-bold text-emerald-700 mt-1">{studentCount}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Faculty</p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{facultyCount}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Admins</p>
          <p className="text-3xl font-bold text-violet-700 mt-1">{adminCount}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-slate-500" />
              Users
            </h3>
          </div>
          <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[10rem]">
              <label htmlFor="admin-filter-role" className="text-xs font-medium text-slate-500">
                Role
              </label>
              <select
                id="admin-filter-role"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
              >
                <option value="">All roles</option>
                <option value="student">Students</option>
                <option value="faculty">Faculty</option>
                <option value="admin">Admins</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 min-w-[12rem]">
              <label htmlFor="admin-filter-status" className="text-xs font-medium text-slate-500">
                Student status
              </label>
              <select
                id="admin-filter-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
              >
                <option value="">All statuses</option>
                <option value="eligible">Eligible</option>
                <option value="probation">Probation</option>
                <option value="ineligible">Ineligible</option>
              </select>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 flex-1 lg:justify-end">
              <div className="flex flex-col gap-1 min-w-[11rem]">
                <label htmlFor="admin-sort-by" className="text-xs font-medium text-slate-500">
                  Sort by
                </label>
                <select
                  id="admin-sort-by"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'created_at' | 'role')}
                  className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
                >
                  <option value="created_at">Joined date</option>
                  <option value="role">Role</option>
                </select>
              </div>
              <div className="flex flex-col gap-1 min-w-[9rem]">
                <label htmlFor="admin-sort-dir" className="text-xs font-medium text-slate-500">
                  Order
                </label>
                <select
                  id="admin-sort-dir"
                  value={sortDir}
                  onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
                  className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
                >
                  {sortBy === 'role' ? (
                    <>
                      <option value="asc">A → Z (admin, faculty, student)</option>
                      <option value="desc">Z → A (student, faculty, admin)</option>
                    </>
                  ) : (
                    <>
                      <option value="desc">Newest first</option>
                      <option value="asc">Oldest first</option>
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>
        </div>

        {usersError && (
          <div className="m-5 text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-xl p-3">
            {usersError}
          </div>
        )}

        {usersLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-600">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold border-t border-slate-200">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Joined</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-medium text-slate-900">{u.name}</td>
                    <td className="px-5 py-3">{u.email}</td>
                    <td className="px-5 py-3 capitalize">{u.role}</td>
                    <td className="px-5 py-3 capitalize text-slate-700">
                      {u.eligibility_status ? u.eligibility_status.replace('_', ' ') : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-right">
                      {u.role === 'student' ? (
                        <button
                          type="button"
                          onClick={async () => {
                            setEligibilityUser(u);
                            setEligibilityReason('');
                            setEligibilityError('');
                            try {
                              const res = await authApi.get(`/admin/users/${u.id}`);
                              const cur =
                                res.data.user?.profile?.eligibility_status || 'eligible';
                              setEligibilityStatus(cur);
                            } catch {
                              setEligibilityStatus('eligible');
                            }
                          }}
                          className="text-xs font-semibold text-primary-600 hover:text-primary-800"
                        >
                          Eligibility
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                      No users for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-slate-500" />
            Audit log
          </h3>
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              disabled={logPage <= 1 || logsLoading}
              onClick={() => setLogPage((p) => Math.max(1, p - 1))}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-600 font-medium px-2">
              Page {logPage} / {logPages}
            </span>
            <button
              type="button"
              disabled={logPage >= logPages || logsLoading}
              onClick={() => setLogPage((p) => p + 1)}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {logsError && (
          <div className="m-5 text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-xl p-3">
            {logsError}
          </div>
        )}

        {logsLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-600">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold border-t border-slate-200">
                <tr>
                  <th className="px-5 py-3">When</th>
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Admin</th>
                  <th className="px-5 py-3">Target</th>
                  <th className="px-5 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-800">{log.action}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">{log.admin_name}</div>
                      <div className="text-xs text-slate-500">{log.admin_email}</div>
                    </td>
                    <td className="px-5 py-3">
                      {log.target_name ? (
                        <>
                          <div className="font-medium text-slate-900">{log.target_name}</div>
                          <div className="text-xs text-slate-500">{log.target_email}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 max-w-md">
                      <pre className="text-xs bg-slate-50 border border-slate-100 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
                        {formatDetails(log.details)}
                      </pre>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                      No audit entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {eligibilityUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h4 className="text-lg font-semibold text-slate-900">Student eligibility</h4>
              <p className="text-sm text-slate-500 mt-0.5">
                {eligibilityUser.name} · {eligibilityUser.email}
              </p>
            </div>
            <form onSubmit={handleSaveEligibility} className="p-5 space-y-4">
              {eligibilityError && (
                <div className="text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-lg p-3">
                  {eligibilityError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={eligibilityStatus}
                  onChange={(e) =>
                    setEligibilityStatus(e.target.value as 'eligible' | 'probation' | 'ineligible')
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="eligible">Eligible</option>
                  <option value="probation">Probation</option>
                  <option value="ineligible">Ineligible</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason (optional)</label>
                <textarea
                  value={eligibilityReason}
                  onChange={(e) => setEligibilityReason(e.target.value)}
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none"
                  placeholder="Internal note for audit log…"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEligibilityUser(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={eligibilitySaving}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {eligibilitySaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
