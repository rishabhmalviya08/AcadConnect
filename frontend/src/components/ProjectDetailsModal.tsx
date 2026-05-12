import { useState, useEffect } from 'react';
import { projectApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import {
  X, Loader2, Calendar, Users, Target,
  Sparkles, ThumbsUp, AlertTriangle, Lightbulb, FileText, Gauge, UserPlus, CheckCircle, XCircle,
  GraduationCap,
  UserCog,
  FolderKanban,
} from 'lucide-react';
import { formatRecruitmentStatus, RECRUITMENT_OPTIONS } from '../lib/recruitmentLabels';
import { MAX_GROUP_MEMBERS } from '../constants/groupLimits';

interface SimilarProjectMatch {
  project_id: string;
  title: string;
  match_percent: number;
  breakdown: {
    combined: number;
    abstract: number | null;
    description: number | null;
  };
}

interface AiFeedback {
  relevance_score: number;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  summary: string;
  similar_projects?: SimilarProjectMatch[];
  projects_compared?: number;
  similarity_method?: string;
}

interface Milestone {
  id: string;
  title: string;
  description?: string;
  due_date?: string;
  completed: boolean;
}

interface JoinRequestRow {
  request_id: string;
  requester_name: string;
  requester_email: string;
  message: string | null;
  created_at: string;
}

interface GroupForLink {
  group_id: string;
  name: string;
  leader_id: string;
  my_status: string;
  members: { name: string; email: string; status: string }[];
}

interface FacultyPick {
  faculty_id?: string;
  name: string;
  email?: string;
  /** True when this row is matched to a registered faculty user (same email as faculty.json). */
  in_database?: boolean;
}

interface MentorshipRequestRow {
  id: string;
  status: string;
  snippet?: string;
  created_at: string;
  faculty_id: string;
  faculty_name: string;
  faculty_email?: string;
}

interface ProjectDetailsModalProps {
  projectId: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** Open another project in this modal (e.g. from similar-project links). */
  onOpenProjectInModal?: (id: string) => void;
}

function parseMembersJsonField(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeProjectFromApi(p: Record<string, unknown> | null) {
  if (!p) return p;
  const mr = p.mentorship_requests;
  const mentorship_requests = Array.isArray(mr) ? mr : [];
  return {
    ...p,
    group_members: parseMembersJsonField(p.group_members),
    solo_team_members: parseMembersJsonField(p.solo_team_members),
    mentorship_requests,
  };
}

/** Faculty with app accounts only; stable order; one row per user id. */
function linkableFacultyFromPickList(list: FacultyPick[]): FacultyPick[] {
  const seen = new Set<string>();
  const out: FacultyPick[] = [];
  for (const f of list) {
    if (!f.faculty_id) continue;
    const id = String(f.faculty_id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(f);
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  return out;
}

/** Everyone in the API list (e.g. full faculty.json merge), directory-only rows deduped by email. */
function directoryFacultyWithoutAccount(list: FacultyPick[]): FacultyPick[] {
  const seenEmail = new Set<string>();
  const out: FacultyPick[] = [];
  for (const f of list) {
    if (f.faculty_id) continue;
    const em = (f.email && String(f.email).trim().toLowerCase()) || '';
    if (em) {
      if (seenEmail.has(em)) continue;
      seenEmail.add(em);
    }
    out.push(f);
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  return out;
}

export const ProjectDetailsModal = ({
  projectId,
  isOpen,
  onClose,
  onOpenProjectInModal,
}: ProjectDetailsModalProps) => {
  const { user } = useAuthStore();
  const isLeaderOfGroup = (g: GroupForLink) => String(g.leader_id) === String(user?.id);
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

  const [joinNote, setJoinNote] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState('');
  const [joinErr, setJoinErr] = useState('');
  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>([]);
  const [joinReqLoading, setJoinReqLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [recruitmentSaving, setRecruitmentSaving] = useState(false);
  const [recruitmentErr, setRecruitmentErr] = useState('');
  const [abstractDraft, setAbstractDraft] = useState('');
  const [abstractSaving, setAbstractSaving] = useState(false);
  const [abstractErr, setAbstractErr] = useState('');

  const [leaderLinkGroups, setLeaderLinkGroups] = useState<GroupForLink[]>([]);
  const [linkedGroupIdDraft, setLinkedGroupIdDraft] = useState('');
  const [groupLinkSaving, setGroupLinkSaving] = useState(false);
  const [groupLinkErr, setGroupLinkErr] = useState('');

  const [facultyPickList, setFacultyPickList] = useState<FacultyPick[]>([]);
  const [mentorFacultyId, setMentorFacultyId] = useState('');
  const [mentorSnippet, setMentorSnippet] = useState('');
  const [mentorWordCount, setMentorWordCount] = useState(0);
  const [mentorSubmitting, setMentorSubmitting] = useState(false);
  const [mentorErr, setMentorErr] = useState('');

  useEffect(() => {
    if (!isOpen || !projectId || user?.role !== 'student') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await projectApi.get('/groups/me');
        if (cancelled) return;
        const all: GroupForLink[] = res.data.groups || [];
        setLeaderLinkGroups(all.filter((g) => g.my_status === 'accepted'));
      } catch {
        if (!cancelled) setLeaderLinkGroups([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, user?.role, user?.id]);

  useEffect(() => {
    if (!isOpen || user?.role !== 'student') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await projectApi.get('/faculty');
        if (cancelled) return;
        setFacultyPickList(res.data.faculty || []);
      } catch {
        if (!cancelled) setFacultyPickList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, user?.role]);

  useEffect(() => {
    if (project?.id) setLinkedGroupIdDraft(project.group_id ? String(project.group_id) : '');
  }, [project?.id, project?.group_id]);

  useEffect(() => {
    if (isOpen && projectId) {
      setAiFeedback(null);
      setAiError('');
      setMilestones([]);
      setMilestoneError('');
      setJoinNote('');
      setJoinFeedback('');
      setJoinErr('');
      setJoinRequests([]);
      setMentorFacultyId('');
      setMentorSnippet('');
      setMentorWordCount(0);
      setMentorErr('');
      setGroupLinkErr('');
      const fetchProject = async () => {
        setIsLoading(true);
        setError('');
        try {
          const response = await projectApi.get(`/projects/${projectId}`);
          const p = normalizeProjectFromApi(response.data.project) as typeof response.data.project;
          setProject(p);
          setAbstractDraft(typeof p.abstract === 'string' ? p.abstract : '');
          setAbstractErr('');

          if (user?.role === 'student' && p?.creator_student_id === user?.id) {
            setJoinReqLoading(true);
            try {
              const jr = await projectApi.get(`/projects/${projectId}/join-requests`);
              setJoinRequests(jr.data.requests || []);
            } catch {
              setJoinRequests([]);
            } finally {
              setJoinReqLoading(false);
            }
          }
        } catch (err: any) {
          setError(err.response?.data?.error || 'Failed to fetch project details');
        } finally {
          setIsLoading(false);
        }
      };

      fetchProject();
      fetchMilestones();
    }
  }, [isOpen, projectId, user?.id, user?.role]);

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

  const handleSendJoinRequest = async () => {
    if (!projectId) return;
    setJoinLoading(true);
    setJoinErr('');
    setJoinFeedback('');
    try {
      await projectApi.post(`/projects/${projectId}/join-request`, {
        message: joinNote.trim() || undefined,
      });
      setJoinFeedback('Request sent to the project owner.');
      setJoinNote('');
    } catch (err: any) {
      setJoinErr(err.response?.data?.error || 'Could not send join request.');
    } finally {
      setJoinLoading(false);
    }
  };

  const handleReviewJoin = async (requestId: string, status: 'accepted' | 'rejected') => {
    if (!projectId) return;
    setReviewingId(requestId);
    setJoinErr('');
    try {
      await projectApi.put(`/projects/${projectId}/join-requests/${requestId}`, { status });
      const jr = await projectApi.get(`/projects/${projectId}/join-requests`);
      setJoinRequests(jr.data.requests || []);
      const pr = await projectApi.get(`/projects/${projectId}`);
      setProject(normalizeProjectFromApi(pr.data.project) as typeof pr.data.project);
    } catch (err: any) {
      setJoinErr(err.response?.data?.error || 'Could not update request.');
    } finally {
      setReviewingId(null);
    }
  };

  const refreshProjectDetail = async () => {
    if (!projectId) return;
    const response = await projectApi.get(`/projects/${projectId}`);
    const p = normalizeProjectFromApi(response.data.project) as typeof response.data.project;
    setProject(p);
  };

  const handleSaveLinkedGroup = async () => {
    if (!projectId) return;
    setGroupLinkSaving(true);
    setGroupLinkErr('');
    try {
      await projectApi.put(`/projects/${projectId}/group`, {
        group_id: linkedGroupIdDraft || null,
      });
      await refreshProjectDetail();
    } catch (err: any) {
      setGroupLinkErr(err.response?.data?.error || 'Could not update linked group.');
    } finally {
      setGroupLinkSaving(false);
    }
  };

  const handleMentorSnippetChange = (v: string) => {
    setMentorSnippet(v);
    setMentorWordCount(v.trim().split(/\s+/).filter(Boolean).length);
  };

  const handleSubmitMentorRequest = async () => {
    if (!projectId) return;
    setMentorErr('');
    if (!mentorFacultyId) {
      setMentorErr(
        'Choose someone under “Can receive requests” (registered with the same email as in the directory).',
      );
      return;
    }
    if (!mentorSnippet.trim()) {
      setMentorErr('Add a short pitch (snippet) for the faculty.');
      return;
    }
    if (mentorWordCount > 200) {
      setMentorErr('Snippet must be 200 words or fewer.');
      return;
    }
    setMentorSubmitting(true);
    try {
      await projectApi.post('/requests', {
        project_id: projectId,
        faculty_id: mentorFacultyId,
        snippet: mentorSnippet.trim(),
      });
      setMentorSnippet('');
      setMentorWordCount(0);
      setMentorFacultyId('');
      await refreshProjectDetail();
    } catch (err: any) {
      setMentorErr(err.response?.data?.error || 'Could not send mentorship request.');
    } finally {
      setMentorSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const isOwner = user?.role === 'student' && project?.creator_student_id === user?.id;
  const soloNotFull =
    project &&
    !project.group_id &&
    project.recruitment_status &&
    project.recruitment_status !== 'full';
  const canRequestJoin =
    user?.role === 'student' &&
    project?.status === 'open' &&
    project?.creator_student_id &&
    project.creator_student_id !== user?.id &&
    (!!project.group_id || !!soloNotFull);

  const mentorshipRows: MentorshipRequestRow[] =
    Array.isArray(project?.mentorship_requests) ? (project.mentorship_requests as MentorshipRequestRow[]) : [];
  const acceptedMentorRow = mentorshipRows.find((r) => r.status === 'accepted');
  const registeredFaculty = linkableFacultyFromPickList(facultyPickList);
  const directoryOnlyFaculty = directoryFacultyWithoutAccount(facultyPickList);

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

  const handleSaveRecruitment = async (next: string) => {
    if (!projectId) return;
    setRecruitmentSaving(true);
    setRecruitmentErr('');
    try {
      await projectApi.put(`/projects/${projectId}/recruitment-status`, {
        recruitment_status: next,
      });
      const pr = await projectApi.get(`/projects/${projectId}`);
      setProject(normalizeProjectFromApi(pr.data.project) as typeof pr.data.project);
    } catch (err: any) {
      setRecruitmentErr(err.response?.data?.error || 'Could not update recruiting status.');
    } finally {
      setRecruitmentSaving(false);
    }
  };

  const handleSaveAbstract = async () => {
    if (!projectId) return;
    setAbstractSaving(true);
    setAbstractErr('');
    try {
      await projectApi.put(`/projects/${projectId}/recruitment-status`, {
        abstract: abstractDraft,
      });
      const pr = await projectApi.get(`/projects/${projectId}`);
      const normalized = normalizeProjectFromApi(pr.data.project) as typeof pr.data.project;
      setProject(normalized);
      const a = normalized?.abstract;
      setAbstractDraft(typeof a === 'string' ? a : '');
    } catch (err: any) {
      setAbstractErr(err.response?.data?.error || 'Could not save abstract.');
    } finally {
      setAbstractSaving(false);
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

              <div>
                <h5 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-slate-500" />
                  Abstract
                </h5>
                {isOwner ? (
                  <div className="space-y-2">
                    <textarea
                      value={abstractDraft}
                      onChange={(e) => setAbstractDraft(e.target.value)}
                      rows={4}
                      maxLength={8000}
                      placeholder="Short summary for discovery and listings…"
                      className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                    />
                    {abstractErr && (
                      <p className="text-xs text-red-600 font-medium">{abstractErr}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          abstractSaving ||
                          abstractDraft === (typeof project.abstract === 'string' ? project.abstract : '')
                        }
                        onClick={handleSaveAbstract}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
                      >
                        {abstractSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Save abstract
                      </button>
                    </div>
                  </div>
                ) : project.abstract ? (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <p className="text-slate-700 whitespace-pre-wrap text-sm">{project.abstract}</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No abstract provided.</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Project owner</p>
                    <p className="text-sm font-semibold text-slate-900">{project.creator_name || '—'}</p>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Group</p>
                    <p className="text-sm font-semibold text-slate-900">{project.group_name || '—'}</p>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <GraduationCap className="w-5 h-5 text-amber-700" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Mentor</p>
                    <p className="text-sm font-semibold text-slate-900">{project.faculty_name || '—'}</p>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <Target className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Progress</p>
                    <p className="text-sm font-semibold text-slate-900 capitalize">
                      {project.status?.replace('_', ' ')}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-start gap-3 sm:col-span-2">
                  <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                    <UserCog className="w-5 h-5 text-sky-700" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Team recruiting</p>
                    {project.group_id ? (
                      <p className="text-sm font-semibold text-slate-900">
                        Group project — add people from the Groups page (invites / roster).
                      </p>
                    ) : user?.role === 'student' && isOwner && project.status === 'open' ? (
                      <>
                        <p className="text-xs text-slate-500">
                          Set whether you are still accepting join requests (independent of team size).
                        </p>
                        {recruitmentErr && (
                          <p className="text-xs text-red-600 font-medium">{recruitmentErr}</p>
                        )}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <select
                            value={project.recruitment_status || 'looking_for_3'}
                            disabled={recruitmentSaving}
                            onChange={(e) => handleSaveRecruitment(e.target.value)}
                            className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white max-w-md disabled:opacity-50"
                          >
                            {RECRUITMENT_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          {recruitmentSaving && (
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm font-semibold text-slate-900">
                        {formatRecruitmentStatus(project.recruitment_status)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {user?.role === 'student' && isOwner && project.status === 'open' && (
                <div className="space-y-4">
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <h5 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <FolderKanban className="w-4 h-4 text-blue-600" />
                      Linked group (owner only)
                    </h5>
                    <p className="text-xs text-slate-500">
                      Link any group you lead (accepted roster up to {MAX_GROUP_MEMBERS} members), or keep this as an
                      individual project. Faculty must accept mentorship before you can change the link after
                      assignment.
                    </p>
                    {groupLinkErr && <p className="text-xs text-red-600 font-medium">{groupLinkErr}</p>}
                    {leaderLinkGroups.length === 0 ? (
                      <p className="text-sm text-slate-600">
                        No accepted groups on your account. Create one on the Groups page, then pick it here.
                      </p>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                        <div className="flex-1 min-w-0">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Group</label>
                          <select
                            value={linkedGroupIdDraft}
                            onChange={(e) => setLinkedGroupIdDraft(e.target.value)}
                            className="block w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                          >
                            <option value="">Individual project (no linked group)</option>
                            {leaderLinkGroups.map((group) => {
                              const accepted = group.members.filter((m) => m.status === 'accepted').length;
                              const leader = isLeaderOfGroup(group);
                              const ok = leader && accepted <= MAX_GROUP_MEMBERS;
                              return (
                                <option key={group.group_id} value={group.group_id} disabled={!ok}>
                                  {group.name} ({accepted} accepted)
                                  {!leader
                                    ? ' — you must be the leader'
                                    : !ok
                                      ? ` — at most ${MAX_GROUP_MEMBERS} accepted`
                                      : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <button
                          type="button"
                          disabled={
                            groupLinkSaving ||
                            String(linkedGroupIdDraft || '') === String(project.group_id || '')
                          }
                          onClick={handleSaveLinkedGroup}
                          className="shrink-0 inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
                        >
                          {groupLinkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save group link'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-4 space-y-3">
                    <h5 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <GraduationCap className="w-4 h-4 text-amber-700" />
                      Faculty mentor
                    </h5>
                    <p className="text-xs text-slate-600">
                      The list includes everyone from <code className="bg-white/80 px-1 rounded">faculty.json</code>.
                      You can only send a request to people who have registered (same email as in the file). They
                      accept or decline from their Requests page.
                    </p>
                    {mentorshipRows.length > 0 && (
                      <ul className="rounded-lg border border-amber-100 divide-y divide-amber-100 bg-white text-sm">
                        {mentorshipRows.map((r) => (
                          <li key={r.id} className="px-3 py-2 flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-900 truncate">{r.faculty_name}</span>
                            <span
                              className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                                r.status === 'accepted'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : r.status === 'rejected'
                                    ? 'bg-slate-100 text-slate-600'
                                    : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {r.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {acceptedMentorRow ? (
                      <p className="text-sm text-emerald-800 font-medium">
                        Mentor assigned: {acceptedMentorRow.faculty_name}. They can manage milestones and mark the
                        project complete when ready.
                      </p>
                    ) : (
                      <>
                        {mentorErr && <p className="text-xs text-red-600 font-medium">{mentorErr}</p>}
                        <div>
                          <label
                            htmlFor="project-mentor-faculty"
                            className="block text-xs font-medium text-slate-600 mb-1"
                          >
                            Faculty to request
                          </label>
                          <select
                            id="project-mentor-faculty"
                            value={mentorFacultyId}
                            onChange={(e) => setMentorFacultyId(e.target.value)}
                            className="block w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                          >
                            <option value="">Select a faculty mentor…</option>
                            {registeredFaculty.length > 0 && (
                              <optgroup label="Can receive requests (registered)">
                                {registeredFaculty.map((f) => (
                                  <option
                                    key={String(f.faculty_id)}
                                    value={String(f.faculty_id)}
                                    title={f.email ? String(f.email) : undefined}
                                  >
                                    {f.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {directoryOnlyFaculty.length > 0 && (
                              <optgroup label="Directory only (not registered yet)">
                                {directoryOnlyFaculty.map((f, i) => (
                                  <option
                                    key={`dir-${f.email || 'no-email'}-${f.name}-${i}`}
                                    value={`__dir__${i}`}
                                    disabled
                                    title={
                                      f.email
                                        ? `${f.email} — register with this email to receive mentorship requests`
                                        : 'Add an email in faculty.json and register to receive requests'
                                    }
                                  >
                                    {f.name}
                                    {f.email ? ` (${f.email})` : ''}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          {facultyPickList.length === 0 && (
                            <p className="text-xs text-amber-900 mt-1">
                              No faculty directory loaded. Add{' '}
                              <code className="bg-white/80 px-1 rounded">faculty.json</code> next to the project service
                              or set <code className="bg-white/80 px-1 rounded">FACULTY_JSON_PATH</code>.
                            </p>
                          )}
                          {facultyPickList.length > 0 && registeredFaculty.length === 0 && (
                            <p className="text-xs text-amber-900 mt-1">
                              No one in this list has registered yet. Faculty should sign up with the same email as in{' '}
                              <code className="bg-white/80 px-1 rounded">faculty.json</code> to appear under “Can
                              receive requests”.
                            </p>
                          )}
                        </div>
                        <div>
                          <div className="flex justify-between mb-1">
                            <label className="text-xs font-medium text-slate-600">Pitch to faculty (snippet)</label>
                            <span className={`text-xs ${mentorWordCount > 200 ? 'text-red-600' : 'text-slate-400'}`}>
                              {mentorWordCount}/200 words
                            </span>
                          </div>
                          <textarea
                            value={mentorSnippet}
                            onChange={(e) => handleMentorSnippetChange(e.target.value)}
                            rows={4}
                            className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg resize-none focus:ring-2 focus:ring-amber-500"
                            placeholder="Why this project is a good fit for their mentorship…"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={mentorSubmitting || !mentorFacultyId}
                          onClick={handleSubmitMentorRequest}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-700 rounded-lg hover:bg-amber-800 disabled:opacity-50"
                        >
                          {mentorSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          Send mentorship request
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {!project.group_id && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                  <h5 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-violet-600" />
                    Team members (individual project)
                  </h5>
                  <p className="text-xs text-slate-500">
                    Owner plus students accepted via join requests. Invite collaborators from Discover or
                    accept requests below.
                  </p>
                  <ul className="rounded-lg border border-slate-100 divide-y divide-slate-100 overflow-hidden bg-white">
                    {(Array.isArray(project.solo_team_members) ? project.solo_team_members : []).length ===
                    0 ? (
                      <li className="px-3 py-3 text-sm text-slate-500">No team data yet.</li>
                    ) : (
                      (Array.isArray(project.solo_team_members) ? project.solo_team_members : []).map(
                        (m: {
                          student_id: string;
                          name: string;
                          email: string;
                          member_role?: string;
                          status?: string;
                        }) => (
                          <li
                            key={m.student_id || m.email}
                            className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 truncate">{m.name}</p>
                              <p className="text-xs text-slate-500 truncate">{m.email}</p>
                            </div>
                            <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full capitalize bg-slate-100 text-slate-800">
                              {(m.member_role || 'member').replace('_', ' ')}
                            </span>
                          </li>
                        )
                      )
                    )}
                  </ul>
                </div>
              )}

              {project.group_id && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                  <h5 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    Linked group members ({(project.group_members || []).length} / {MAX_GROUP_MEMBERS} max)
                  </h5>
                  <p className="text-xs text-slate-500">
                    This project is tied to exactly one group. Add or remove people from the Groups page; up to{' '}
                    {MAX_GROUP_MEMBERS} students can be in the group.
                  </p>
                  <ul className="rounded-lg border border-slate-100 divide-y divide-slate-100 overflow-hidden bg-white">
                    {(Array.isArray(project.group_members) ? project.group_members : []).map(
                      (m: { student_id: string; name: string; email: string; status: string }) => (
                        <li
                          key={m.student_id || m.email}
                          className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 truncate">{m.name}</p>
                            <p className="text-xs text-slate-500 truncate">{m.email}</p>
                          </div>
                          <span
                            className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                              m.status === 'accepted'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {m.status}
                          </span>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {user?.role === 'student' && isOwner && project.status === 'open' && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <h5 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-primary-600" />
                    Requests to join this project
                  </h5>
                  {joinReqLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  ) : joinRequests.length === 0 ? (
                    <p className="text-sm text-slate-500">No pending requests.</p>
                  ) : (
                    <ul className="space-y-3">
                      {joinRequests.map((jr) => (
                        <li
                          key={jr.request_id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg bg-slate-50 border border-slate-100"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-900">{jr.requester_name}</p>
                            <p className="text-xs text-slate-500">{jr.requester_email}</p>
                            {jr.message && <p className="text-xs text-slate-600 mt-1">&ldquo;{jr.message}&rdquo;</p>}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={reviewingId === jr.request_id}
                              onClick={() => handleReviewJoin(jr.request_id, 'accepted')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={reviewingId === jr.request_id}
                              onClick={() => handleReviewJoin(jr.request_id, 'rejected')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Decline
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {user?.role === 'student' && canRequestJoin && (
                <div className="border border-violet-200 bg-violet-50/40 rounded-xl p-4 space-y-3">
                  <h5 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-violet-600" />
                    Request to join this project
                  </h5>
                  <p className="text-xs text-slate-600">
                    The owner ({project.creator_name}) will get a notification and can add you to the team.
                  </p>
                  <textarea
                    value={joinNote}
                    onChange={(e) => setJoinNote(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Optional note (why you want to join, skills you bring…)"
                    className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 resize-none"
                  />
                  {joinErr && <p className="text-xs text-red-600">{joinErr}</p>}
                  {joinFeedback && <p className="text-xs text-emerald-700">{joinFeedback}</p>}
                  <button
                    type="button"
                    disabled={joinLoading}
                    onClick={handleSendJoinRequest}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50"
                  >
                    {joinLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Send request
                  </button>
                </div>
              )}

              {/* AI Feedback Section - Students only */}
              {user?.role === 'student' && (
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
                      <p className="text-sm text-slate-500 font-medium">Analyzing project with AI and comparing to open projects…</p>
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

                      {/* Similar projects (lexical overlap vs other open projects in DB) */}
                      {(aiFeedback.similar_projects?.length ?? 0) > 0 && (
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5">
                              <Target className="w-4 h-4 text-slate-600" />
                              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Similar projects in the directory
                              </p>
                            </div>
                            {typeof aiFeedback.projects_compared === 'number' && (
                              <span className="text-[10px] text-slate-500 uppercase">
                                Compared {aiFeedback.projects_compared} · {aiFeedback.similarity_method || 'overlap'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mb-3">
                            Percentages use word overlap (Jaccard) between your abstract+description and each other
                            project&apos;s abstract+description in the database (up to the scan limit).{' '}
                            <strong>Combined</strong> merges both fields; abstract/description lines show overlap when both
                            sides have text in that field.
                          </p>
                          <ul className="space-y-2">
                            {(aiFeedback.similar_projects as SimilarProjectMatch[]).map((sp) => (
                              <li
                                key={sp.project_id}
                                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm border border-slate-100 rounded-lg px-3 py-2 bg-white"
                              >
                                <div className="min-w-0">
                                  <p className="font-medium text-slate-900 truncate">{sp.title}</p>
                                  <p className="text-[11px] text-slate-500">
                                    Combined {sp.breakdown.combined}%
                                    {sp.breakdown.abstract != null ? ` · Abstract ${sp.breakdown.abstract}%` : ''}
                                    {sp.breakdown.description != null
                                      ? ` · Description ${sp.breakdown.description}%`
                                      : ''}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <div className="w-24 h-2 rounded-full bg-slate-200 overflow-hidden">
                                    <div
                                      className="h-full bg-violet-500 rounded-full"
                                      style={{ width: `${Math.min(100, sp.match_percent)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-semibold text-violet-700 w-10 text-right">
                                    {sp.match_percent}%
                                  </span>
                                  {onOpenProjectInModal && sp.project_id !== projectId ? (
                                    <button
                                      type="button"
                                      onClick={() => onOpenProjectInModal(sp.project_id)}
                                      className="text-xs font-medium text-primary-600 hover:text-primary-800"
                                    >
                                      View
                                    </button>
                                  ) : null}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(!aiFeedback.similar_projects || aiFeedback.similar_projects.length === 0) &&
                        typeof aiFeedback.projects_compared === 'number' &&
                        aiFeedback.projects_compared > 0 && (
                          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                            No other projects scored above 0% word overlap (checked{' '}
                            {aiFeedback.projects_compared} most recently updated project
                            {aiFeedback.projects_compared === 1 ? '' : 's'}; increase SIMILARITY_SCAN_MAX to scan more).
                          </p>
                        )}

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
              )}

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
