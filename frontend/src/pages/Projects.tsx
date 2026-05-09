import { useState, useEffect, useCallback } from 'react';
import { projectApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Search, Plus, Loader2, Eye, Send, CheckCircle } from 'lucide-react';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { ProjectDetailsModal } from '../components/ProjectDetailsModal';

interface Project {
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  faculty_name: string | null;
  group_name: string | null;
}

export const Projects = () => {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await projectApi.get('/projects/me');
      setProjects(response.data.projects || []);
    } catch (err: any) {
      console.warn('Failed to fetch projects.', err);
      setError('Failed to load projects.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Search filter
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredProjects(projects);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredProjects(
        projects.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            (p.faculty_name || '').toLowerCase().includes(q) ||
            (p.group_name || '').toLowerCase().includes(q) ||
            p.status.toLowerCase().includes(q)
        )
      );
    }
  }, [searchQuery, projects]);

  const handleProjectCreated = () => {
    setSuccessMsg('Project created successfully!');
    setTimeout(() => setSuccessMsg(''), 4000);
    fetchProjects();
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Projects</h2>
          <p className="text-slate-500">
            {user?.role === 'faculty'
              ? 'Create and manage your academic projects.'
              : 'Browse and apply to open projects.'}
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Create Project
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

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Search Bar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/50">
          <div className="relative w-full max-w-sm">
            <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, faculty, or status..."
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
            />
          </div>
        </div>

        {/* Table */}
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
                  <th className="px-6 py-4">Group/Faculty</th>
                  <th className="px-6 py-4">Created</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredProjects.map((project) => (
                  <tr key={project.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">{project.title}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusBadge(project.status)}`}>
                        {project.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">{project.group_name || project.faculty_name || 'N/A'}</td>
                    <td className="px-6 py-4">{new Date(project.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => setSelectedProjectId(project.id)}
                          className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 font-medium text-sm"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredProjects.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                      {searchQuery ? 'No projects match your search.' : 'No projects found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onProjectCreated={handleProjectCreated}
      />

      <ProjectDetailsModal
        projectId={selectedProjectId}
        isOpen={!!selectedProjectId}
        onClose={() => setSelectedProjectId(null)}
      />
    </div>
  );
};
