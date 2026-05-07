import { useState, useEffect } from 'react';
import { projectApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import {
  X, Loader2, Calendar, Users, Target,
  Sparkles, ThumbsUp, AlertTriangle, Lightbulb, FileText, Gauge
} from 'lucide-react';

interface AiFeedback {
  relevance_score: number;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  summary: string;
}

interface Milestone {
  id: string;
  title: string;
  description?: string;
  due_date?: string;
  completed: boolean;
}

interface ProjectDetailsModalProps {
  projectId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectDetailsModal = ({ projectId, isOpen, onClose }: ProjectDetailsModalProps) => {
  const { user } = useAuthStore();
  const [project, setProject] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // AI Feedback state
  const [aiFeedback, setAiFeedback] = useState<AiFeedback | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [aiError, setAiError] = useState('');
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState('');
  const [isSavingMilestone, setIsSavingMilestone] = useState(false);
  const [milestoneError, setMilestoneError] = useState('');

  useEffect(() => {
    if (isOpen && projectId) {
      setAiFeedback(null);
      setAiError('');
      setMilestones([]);
      setMilestoneError('');
      const fetchProject = async () => {
        setIsLoading(true);
        setError('');
        try {
          const response = await projectApi.get(`/projects/${projectId}`);
          setProject(response.data.project);
        } catch (err: any) {
          setError(err.response?.data?.error || 'Failed to fetch project details');
        } finally {
          setIsLoading(false);
        }
      };

      fetchProject();
      fetchMilestones();
    }
  }, [isOpen, projectId]);

  const fetchMilestones = async () => {
    if (!projectId) return;
    try {
      const response = await projectApi.get(`/projects/${projectId}/progress`);
      setMilestones(response.data.milestones || []);
    } catch (err: any) {
      setMilestoneError(err.response?.data?.error || 'Failed to load milestones');
    }
  };

  const handleGetAiFeedback = async () => {
    if (!projectId) return;
    setIsLoadingAi(true);
    setAiError('');
    setAiFeedback(null);

    try {
      const response = await projectApi.post(`/projects/${projectId}/ai-feedback`);
      setAiFeedback(response.data);
    } catch (err: any) {
      setAiError(err.response?.data?.error || 'Failed to get AI feedback. The AI service may not be running.');
    } finally {
      setIsLoadingAi(false);
    }
  };

  if (!isOpen) return null;

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-emerald-600';
    if (score >= 6) return 'text-amber-600';
    return 'text-red-500';
  };

  const getScoreBg = (score: number) => {
    if (score >= 8) return 'bg-emerald-50 border-emerald-200';
    if (score >= 6) return 'bg-amber-50 border-amber-200';
    return 'bg-red-50 border-red-200';
  };

  const handleCreateMilestone = async () => {
    if (!projectId) return;
    if (!newMilestoneTitle.trim()) {
      setMilestoneError('Milestone title is required');
      return;
    }
    setIsSavingMilestone(true);
    setMilestoneError('');
    try {
      await projectApi.post(`/projects/${projectId}/progress`, {
        title: newMilestoneTitle.trim(),
        due_date: newMilestoneDueDate || null,
      });
      setNewMilestoneTitle('');
      setNewMilestoneDueDate('');
      await fetchMilestones();
    } catch (err: any) {
      setMilestoneError(err.response?.data?.error || 'Failed to create milestone');
    } finally {
      setIsSavingMilestone(false);
    }
  };

  const handleMarkComplete = async (milestoneId: string) => {
    if (!projectId) return;
    try {
      await projectApi.put(`/projects/${projectId}/progress/${milestoneId}`, { completed: true });
      await fetchMilestones();
    } catch (err: any) {
      setMilestoneError(err.response?.data?.error || 'Failed to update milestone');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 shrink-0">
          <h3 className="text-xl font-semibold text-slate-900">Project Details</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-center font-medium">
              {error}
            </div>
          ) : project ? (
            <>
              {/* Project Info */}
              <div>
                <h4 className="text-2xl font-bold text-slate-900 mb-2">{project.title}</h4>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    project.status === 'closed' ? 'bg-slate-100 text-slate-600' :
                    project.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                    'bg-emerald-100 text-emerald-800'
                  }`}>
                    {project.status?.replace('_', ' ').toUpperCase() || 'OPEN'}
                  </span>
                  <span className="text-sm text-slate-500 flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {new Date(project.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div>
                <h5 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-2">Description</h5>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <p className="text-slate-700 whitespace-pre-wrap">{project.description}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Group / Faculty</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {project.group_name || project.faculty_name || 'N/A'}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <Target className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Status</p>
                    <p className="text-sm font-semibold text-slate-900 capitalize">
                      {project.status?.replace('_', ' ')}
                    </p>
                  </div>
                </div>
              </div>

              {/* AI Feedback Section */}
              <div className="border-t border-slate-100 pt-6">
                {!aiFeedback && !isLoadingAi && (
                  <button
                    onClick={handleGetAiFeedback}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-purple-600 rounded-xl hover:from-violet-700 hover:to-purple-700 transition-all shadow-sm"
                  >
                    <Sparkles className="w-4 h-4" />
                    Get AI Feedback
                  </button>
                )}

                {isLoadingAi && (
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-violet-600 animate-spin" />
                    </div>
                    <p className="text-sm text-slate-500 font-medium">Analyzing project with AI...</p>
                  </div>
                )}

                {aiError && (
                  <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-medium border border-red-200">
                    {aiError}
                  </div>
                )}

                {aiFeedback && (
                  <div className="space-y-4">
                    <h5 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-violet-500" />
                      AI Feedback
                    </h5>

                    {/* Relevance Score */}
                    <div className={`p-4 rounded-xl border flex items-center gap-4 ${getScoreBg(aiFeedback.relevance_score)}`}>
                      <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm shrink-0">
                        <Gauge className="w-6 h-6 text-violet-600" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Relevance Score</p>
                        <p className={`text-3xl font-bold ${getScoreColor(aiFeedback.relevance_score)}`}>
                          {aiFeedback.relevance_score}<span className="text-lg text-slate-400">/10</span>
                        </p>
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-1.5 mb-2">
                        <FileText className="w-4 h-4 text-slate-500" />
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Summary</p>
                      </div>
                      <p className="text-sm text-slate-700">{aiFeedback.summary}</p>
                    </div>

                    {/* Strengths */}
                    {aiFeedback.strengths?.length > 0 && (
                      <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200">
                        <div className="flex items-center gap-1.5 mb-2">
                          <ThumbsUp className="w-4 h-4 text-emerald-600" />
                          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Strengths</p>
                        </div>
                        <ul className="space-y-1.5">
                          {aiFeedback.strengths.map((s, i) => (
                            <li key={i} className="text-sm text-emerald-800 flex items-start gap-2">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Gaps */}
                    {aiFeedback.gaps?.length > 0 && (
                      <div className="bg-amber-50 p-4 rounded-xl border border-amber-200">
                        <div className="flex items-center gap-1.5 mb-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Gaps</p>
                        </div>
                        <ul className="space-y-1.5">
                          {aiFeedback.gaps.map((g, i) => (
                            <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                              {g}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Suggestions */}
                    {aiFeedback.suggestions?.length > 0 && (
                      <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Lightbulb className="w-4 h-4 text-blue-600" />
                          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Suggestions</p>
                        </div>
                        <ul className="space-y-1.5">
                          {aiFeedback.suggestions.map((s, i) => (
                            <li key={i} className="text-sm text-blue-800 flex items-start gap-2">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-6 space-y-3">
                <h5 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">Milestones</h5>
                {milestoneError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">{milestoneError}</div>
                )}
                {user?.role === 'faculty' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      value={newMilestoneTitle}
                      onChange={(e) => setNewMilestoneTitle(e.target.value)}
                      placeholder="Milestone title"
                      className="sm:col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="date"
                      value={newMilestoneDueDate}
                      onChange={(e) => setNewMilestoneDueDate(e.target.value)}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <button
                      onClick={handleCreateMilestone}
                      disabled={isSavingMilestone}
                      className="sm:col-span-3 px-3 py-2 text-sm text-white bg-primary-600 rounded-lg disabled:opacity-50"
                    >
                      {isSavingMilestone ? 'Adding...' : 'Add Milestone'}
                    </button>
                  </div>
                )}
                {milestones.length === 0 ? (
                  <p className="text-sm text-slate-500">No milestones yet.</p>
                ) : (
                  <div className="space-y-2">
                    {milestones.map((m) => (
                      <div key={m.id} className="p-3 border border-slate-200 rounded-lg flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{m.title}</p>
                          <p className="text-xs text-slate-500">
                            {m.due_date ? `Due ${new Date(m.due_date).toLocaleDateString()}` : 'No due date'}
                          </p>
                        </div>
                        {m.completed ? (
                          <span className="text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">Completed</span>
                        ) : user?.role === 'faculty' ? (
                          <button
                            onClick={() => handleMarkComplete(m.id)}
                            className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-1 rounded-full"
                          >
                            Mark Complete
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">Pending</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="p-6 border-t border-slate-100 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
