import { useState, useEffect } from 'react';
import { projectApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { X, Loader2, Users } from 'lucide-react';
import { MAX_GROUP_MEMBERS } from '../constants/groupLimits';

interface Group {
  group_id: string;
  name: string;
  leader_id: string;
  my_status: string;
  members: { name: string; email: string; status: string }[];
}

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: () => void;
}

export const CreateProjectModal = ({ isOpen, onClose, onProjectCreated }: CreateProjectModalProps) => {
  const { user } = useAuthStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [abstract, setAbstract] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setAbstract('');
      setGroupId('');
      setError('');
      fetchGroups();
    }
  }, [isOpen, user?.id]);

  const isLeaderOf = (g: Group) => String(g.leader_id) === String(user?.id);

  const fetchGroups = async () => {
    setIsLoadingGroups(true);
    try {
      const response = await projectApi.get('/groups/me');
      const allGroups: Group[] = response.data.groups || [];
      // Show every group with accepted membership; only the leader can select it (matches API).
      setGroups(allGroups.filter((g) => g.my_status === 'accepted'));
    } catch {
      setGroups([]);
    } finally {
      setIsLoadingGroups(false);
    }
  };

  if (!isOpen) return null;

  const selectedGroup = groups.find((g) => g.group_id === groupId);
  const acceptedMemberCount = selectedGroup?.members.filter((m) => m.status === 'accepted').length ?? 0;
  const groupEligible =
    !!selectedGroup && isLeaderOf(selectedGroup) && acceptedMemberCount <= MAX_GROUP_MEMBERS;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (groupId) {
      if (!selectedGroup || !isLeaderOf(selectedGroup)) {
        setError('Only the group leader can link that group to a project.');
        return;
      }
      if (!groupEligible) {
        setError(
          `Selected group has too many accepted members (max ${MAX_GROUP_MEMBERS} including you). Remove members on the Groups page or pick another group.`
        );
        return;
      }
    }

    setIsLoading(true);
    try {
      await projectApi.post('/projects', {
        title,
        description,
        ...(abstract.trim() ? { abstract: abstract.trim() } : {}),
        ...(groupId ? { group_id: groupId } : {}),
      });
      onProjectCreated();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create project');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 shrink-0">
          <h3 className="text-xl font-semibold text-slate-900">Create New Project</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Project Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="E.g., AI Ethics in Healthcare"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              placeholder="Describe the project objectives and scope..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Abstract <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={abstract}
              onChange={(e) => setAbstract(e.target.value)}
              rows={3}
              maxLength={8000}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              placeholder="Short summary for listings and discovery (a few sentences)…"
            />
          </div>

          {/* Group Selection (optional) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Link to a group <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            {isLoadingGroups ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading groups...
              </div>
            ) : groups.length === 0 ? (
              <div className="bg-slate-50 text-slate-600 p-3 rounded-lg text-sm border border-slate-100">
                You are not in any group with accepted membership yet. Create a group from the Groups page,
                accept invites, then return here — or create an individual project without a group.
              </div>
            ) : (
              <>
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                >
                  <option value="">No group — individual project</option>
                  {groups.map((group) => {
                    const accepted = group.members.filter((m) => m.status === 'accepted').length;
                    const leader = isLeaderOf(group);
                    return (
                      <option key={group.group_id} value={group.group_id} disabled={!leader}>
                        {group.name} ({accepted} accepted)
                        {!leader ? ' — only the leader can link this group' : ''}
                      </option>
                    );
                  })}
                </select>
                {groups.some((g) => !isLeaderOf(g)) && (
                  <p className="text-xs text-slate-500 mt-1.5">
                    Groups where you are not the leader are shown so you can see the roster, but only the
                    leader can attach the group to a project.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Show selected group members */}
          {selectedGroup && (
            <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                Group Members ({acceptedMemberCount} accepted)
              </p>
              {!groupEligible && acceptedMemberCount > MAX_GROUP_MEMBERS && (
                <div className="bg-red-50 text-red-600 p-2 rounded-lg text-xs font-medium mb-2">
                  This group has more than {MAX_GROUP_MEMBERS} accepted members; unlink people on the Groups page or
                  choose another group.
                </div>
              )}
              <div className="space-y-1.5">
                {selectedGroup.members.map((m) => (
                  <div key={m.email} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{m.name}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      m.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {m.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || (!!groupId && !groupEligible)}
              title={groupId && !groupEligible ? 'Only the leader can link this group, with at most four accepted members' : undefined}
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isLoading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
