import { useState, useEffect, useCallback } from 'react';
import { projectApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Plus, Loader2, Users, Crown, CheckCircle, Clock, Mail, UserPlus } from 'lucide-react';
import { CreateGroupModal } from '../components/CreateGroupModal';
import { MAX_GROUP_MEMBERS } from '../constants/groupLimits';

interface Member {
  name: string;
  email: string;
  status: 'accepted' | 'pending';
}

interface Group {
  group_id: string;
  name: string;
  leader_id: string;
  leader_name: string;
  my_status: string;
  created_at: string;
  members: Member[];
}

export const Groups = () => {
  const { user } = useAuthStore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [acceptingGroupId, setAcceptingGroupId] = useState<string | null>(null);
  const [inviteEmails, setInviteEmails] = useState<Record<string, string>>({});
  const [invitingGroupId, setInvitingGroupId] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await projectApi.get('/groups/me');
      setGroups(response.data.groups || []);
    } catch (err: any) {
      console.warn('Failed to fetch groups.', err);
      setError('Failed to load groups.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleInviteMember = async (groupId: string) => {
    const email = (inviteEmails[groupId] || '').trim();
    if (!email) {
      setError('Enter a student email to invite.');
      return;
    }
    setInvitingGroupId(groupId);
    setError('');
    setSuccessMsg('');
    try {
      await projectApi.post(`/groups/${groupId}/invite`, { member_email: email });
      setSuccessMsg('Invitation sent.');
      setInviteEmails((prev) => ({ ...prev, [groupId]: '' }));
      fetchGroups();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send invite');
    } finally {
      setInvitingGroupId(null);
    }
  };

  const handleAcceptInvite = async (groupId: string, groupName: string) => {
    setAcceptingGroupId(groupId);
    setError('');
    setSuccessMsg('');
    try {
      await projectApi.put(`/groups/${groupId}/accept-invite`);
      setSuccessMsg(`You've joined "${groupName}" successfully!`);
      fetchGroups();
      // Clear success after 4 seconds
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to accept invite');
    } finally {
      setAcceptingGroupId(null);
    }
  };

  const pendingGroups = groups.filter(g => g.my_status === 'pending');
  const joinedGroups = groups.filter(g => g.my_status === 'accepted');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">My Groups</h2>
          <p className="text-slate-500">View and manage your student groups.</p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Group
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-medium border border-red-200">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl text-sm font-medium border border-emerald-200 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">No groups yet</h3>
          <p className="text-slate-500 text-sm">Create a new group or wait for an invite from a classmate.</p>
        </div>
      ) : (
        <>
          {/* ── Pending Invites Section ────────────────────────── */}
          {pendingGroups.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Mail className="w-4 h-4 text-amber-500" />
                Pending Invites ({pendingGroups.length})
              </h3>
              {pendingGroups.map((group) => (
                <div key={group.group_id} className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-base font-semibold text-slate-900">{group.name}</h4>
                    <p className="text-sm text-slate-600 mt-0.5">
                      Invited by <span className="font-medium">{group.leader_name}</span> · {group.members.length} members
                    </p>
                  </div>
                  <button
                    onClick={() => handleAcceptInvite(group.group_id, group.name)}
                    disabled={acceptingGroupId === group.group_id}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm shrink-0"
                  >
                    {acceptingGroupId === group.group_id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    {acceptingGroupId === group.group_id ? 'Accepting...' : 'Accept Invite'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Joined Groups Section ─────────────────────────── */}
          {joinedGroups.length > 0 && (
            <div className="space-y-4">
              {pendingGroups.length > 0 && (
                <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary-500" />
                  My Groups ({joinedGroups.length})
                </h3>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {joinedGroups.map((group) => (
                  <div key={group.group_id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Header */}
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{group.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Led by {group.leader_name} · Created {new Date(group.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                        <CheckCircle className="w-3 h-3" />
                        Joined
                      </span>
                    </div>

                    {/* Members List */}
                    <div className="p-5">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                        Members ({group.members.length})
                      </p>
                      {user?.id === group.leader_id && group.members.length < MAX_GROUP_MEMBERS && (
                        <div className="mb-4 p-3 rounded-xl bg-primary-50 border border-primary-100">
                          <p className="text-xs font-semibold text-primary-800 uppercase tracking-wider mb-2 flex items-center gap-1">
                            <UserPlus className="w-3.5 h-3.5" />
                            Invite a teammate (max {MAX_GROUP_MEMBERS} in group)
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="email"
                              placeholder="student@university.edu"
                              value={inviteEmails[group.group_id] || ''}
                              onChange={(e) =>
                                setInviteEmails((prev) => ({ ...prev, [group.group_id]: e.target.value }))
                              }
                              className="flex-1 text-sm px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                            <button
                              type="button"
                              disabled={invitingGroupId === group.group_id}
                              onClick={() => handleInviteMember(group.group_id)}
                              className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 shrink-0"
                            >
                              {invitingGroupId === group.group_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <UserPlus className="w-4 h-4" />
                              )}
                              Invite
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2.5">
                        {group.members.map((member) => (
                          <div key={member.email} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold text-sm shrink-0">
                                {member.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
                                  {member.name}
                                  {member.name === group.leader_name && (
                                    <Crown className="w-3.5 h-3.5 text-amber-500" />
                                  )}
                                </p>
                                <p className="text-xs text-slate-500">{member.email}</p>
                              </div>
                            </div>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                              member.status === 'accepted'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {member.status === 'accepted' ? (
                                <CheckCircle className="w-3 h-3" />
                              ) : (
                                <Clock className="w-3 h-3" />
                              )}
                              {member.status === 'accepted' ? 'Accepted' : 'Pending'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <CreateGroupModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onGroupCreated={fetchGroups}
      />
    </div>
  );
};
