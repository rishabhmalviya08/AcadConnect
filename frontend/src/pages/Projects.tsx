import { useState, useEffect, useCallback } from 'react';
import { projectApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Search, Plus, Loader2, Eye, Send, CheckCircle, Compass, FolderOpen } from 'lucide-react';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { ProjectDetailsModal } from '../components/ProjectDetailsModal';
import { formatRecruitmentStatus } from '../lib/recruitmentLabels';

interface GroupMemberRow {
  student_id: string;
  name: string;
  email: string;
  status: string;
}

interface SoloTeamMemberRow {
  student_id: string;
  name: string;
  email: string;
  member_role?: string;
  status?: string;
}

interface Project {
  id: string;
  title: string;
  description: string;
  abstract?: string | null;
  status: string;
  recruitment_status?: string | null;
  group_id?: string | null;
  group_members?: GroupMemberRow[];
  solo_team_members?: SoloTeamMemberRow[];
  created_at: string;
  faculty_name: string | null;
  group_name: string | null;
  creator_student_id?: string;
  creator_name?: string;
}

export const Projects = () => {
  const { user } = useAuthStore();
  const isStudent = user?.role === 'student';
  const isAdmin = user?.role === 'admin';

  const [listTab, setListTab] = useState<'mine' | 'discover'>(() => (isStudent ? 'mine' : 'mine'));
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [discoverProjects, setDiscoverProjects] = useState<Project[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const fetchMine = useCallback(async () => {
    if (!user?.role) {
      setMyProjects([]);
      return;
    }
    const endpoint = user.role === 'admin' ? '/projects' : '/projects/me';
    const response = await projectApi.get(endpoint);
    setMyProjects(response.data.projects || []);
  }, [user?.role]);

  const fetchDiscover = useCallback(async () => {
    const response = await projectApi.get('/projects', {
      params: { discoverable: 'true' },
    });
    setDiscoverProjects(response.data.projects || []);
  }, []);

  const refreshLists = useCallback(async () => {
    setError('');
    try {
      await fetchMine();
      if (isStudent && !isAdmin) await fetchDiscover();
    } catch (err: any) {
      console.warn('Failed to fetch projects.', err);
      setError('Failed to load projects.');
    }
  }, [fetchMine, fetchDiscover, isStudent, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError('');
      try {
        await fetchMine();
        if (isStudent && !isAdmin) await fetchDiscover();
      } catch (err: any) {
        if (!cancelled) {
          console.warn('Failed to fetch projects.', err);
          setError('Failed to load projects.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMine, fetchDiscover, isStudent, isAdmin]);

  const sourceProjects =
    isAdmin ? myProjects : isStudent && listTab === 'discover' ? discoverProjects : myProjects;

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredProjects(sourceProjects);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredProjects(
        sourceProjects.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            (p.description || '').toLowerCase().includes(q) ||
            (p.abstract || '').toLowerCase().includes(q) ||
            (p.faculty_name || '').toLowerCase().includes(q) ||
            (p.group_name || '').toLowerCase().includes(q) ||
            (p.creator_name || '').toLowerCase().includes(q) ||
            p.status.toLowerCase().includes(q) ||
            (p.recruitment_status && formatRecruitmentStatus(p.recruitment_status).toLowerCase().includes(q)) ||
            (p.group_members || []).some(
              (m) =>
                m.name.toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q)
            ) ||
            (p.solo_team_members || []).some(
              (m) =>
                m.name.toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q)
            )
        )
      );
    }
  }, [searchQuery, sourceProjects]);

  const handleProjectCreated = () => {
    setSuccessMsg('Project created successfully!');
    setTimeout(() => setSuccessMsg(''), 4000);
    refreshLists();
  };

  const handleRequestJoin = async (projectId: string) => {
    setJoiningId(projectId);
    setError('');
    setSuccessMsg('');
    try {
      await projectApi.post(`/projects/${projectId}/join-request`, {});
      setSuccessMsg('Join request sent to the project owner.');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchDiscover();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not send join request.');
    } finally {
      setJoiningId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'closed':
        return 'bg-slate-100 text-slate-600';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'open':
      default:
        return 'bg-emerald-100 text-emerald-800';
    }
  };

  const showDiscover = isStudent;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Projects</h2>
          <p className="text-slate-500">
            {isAdmin
              ? 'All projects with group and assigned mentor (accepted faculty).'
              : user?.role === 'faculty'
                ? 'Projects you mentor.'
                : 'Your projects and Discover (solo projects with space for collaborators, or groups with fewer than 4 members).'}
          </p>
        </div>
        {isStudent && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Create Project
          </button>
        )}
      </div>

      {showDiscover && (
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setListTab('mine')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              listTab === 'mine' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
            My projects
          </button>
          <button
            type="button"
            onClick={() => setListTab('discover')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              listTab === 'discover' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Compass className="w-4 h-4" />
            Discover
          </button>
        </div>
      )}

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

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50">
          <div className="relative w-full max-w-sm">
            <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isAdmin
                  ? 'Search by title, owner, group, mentor, status…'
                  : listTab === 'discover'
                    ? 'Search by title, owner, group, mentor, status…'
                    : 'Search by title, faculty, group, status…'
              }
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 flex justify-center items-center">
            <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">Project Name</th>
                  <th className="px-6 py-4">Status</th>
                  {isAdmin && <th className="px-6 py-4">Owner</th>}
                  {!isAdmin && listTab === 'discover' && <th className="px-6 py-4">Owner</th>}
                  <th className="px-6 py-4">Group</th>
                  <th className="px-6 py-4">Mentor</th>
                  <th className="px-6 py-4">Recruiting</th>
                  <th className="px-6 py-4">Created</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredProjects.map((project) => {
                  const soloNotFull =
                    !project.group_id && project.recruitment_status && project.recruitment_status !== 'full';
                  const groupProject = !!project.group_id;
                  const canRequestJoin =
                    isStudent &&
                    listTab === 'discover' &&
                    project.status === 'open' &&
                    project.creator_student_id &&
                    project.creator_student_id !== user?.id &&
                    (groupProject || soloNotFull);
                  return (
                    <tr key={project.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 max-w-xs">
                        <div className="font-medium text-slate-900">{project.title}</div>
                        {project.abstract ? (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2 whitespace-pre-wrap">
                            {project.abstract}
                          </p>
                        ) : null}
                        {!project.group_id &&
                          Array.isArray(project.solo_team_members) &&
                          project.solo_team_members.length > 0 && (
                            <p className="text-xs text-slate-600 mt-1.5">
                              <span className="font-medium text-slate-500">Team:</span>{' '}
                              {project.solo_team_members.map((m) => m.name).join(', ')}
                            </p>
                          )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusBadge(project.status)}`}
                        >
                          {project.status.replace('_', ' ')}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-6 py-4 text-slate-700">{project.creator_name || '—'}</td>
                      )}
                      {!isAdmin && listTab === 'discover' && (
                        <td className="px-6 py-4 text-slate-700">{project.creator_name || '—'}</td>
                      )}
                      <td className="px-6 py-4 max-w-[14rem]">
                        <div className="font-medium text-slate-900">{project.group_name || '—'}</div>
                        {project.group_id &&
                          Array.isArray(project.group_members) &&
                          project.group_members.length > 0 && (
                            <ul className="mt-1.5 text-xs text-slate-600 space-y-0.5 list-none">
                              {project.group_members.map((m) => (
                                <li key={m.student_id || m.email} className="truncate" title={m.email}>
                                  {m.name}
                                  {m.status !== 'accepted' && (
                                    <span className="text-amber-700 font-medium"> · {m.status}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                      </td>
                      <td className="px-6 py-4">{project.faculty_name || '—'}</td>
                      <td className="px-6 py-4 text-slate-700">
                        {formatRecruitmentStatus(project.recruitment_status)}
                      </td>
                      <td className="px-6 py-4">{new Date(project.created_at).toLocaleDateString()}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setSelectedProjectId(project.id)}
                            className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 font-medium text-sm"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </button>
                          {canRequestJoin && (
                            <button
                              type="button"
                              disabled={joiningId === project.id}
                              onClick={() => handleRequestJoin(project.id)}
                              className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-800 font-medium text-sm disabled:opacity-50"
                            >
                              {joiningId === project.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                              Request to join
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredProjects.length === 0 && (
                  <tr>
                    <td
                      colSpan={
                        isAdmin ? 8 : listTab === 'discover' ? 8 : 7
                      }
                      className="px-6 py-12 text-center text-slate-500"
                    >
                      {searchQuery ? 'No projects match your search.' : 'No projects found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isStudent && (
        <CreateProjectModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onProjectCreated={handleProjectCreated}
        />
      )}

      <ProjectDetailsModal
        projectId={selectedProjectId}
        isOpen={!!selectedProjectId}
        onOpenProjectInModal={(id) => setSelectedProjectId(id)}
        onClose={() => {
          setSelectedProjectId(null);
          refreshLists();
        }}
      />
    </div>
  );
};
