import { useState } from 'react';
import { recommendationApi } from '../services/api';
import { Search, Loader2, Star, BookOpen, Sparkles, GraduationCap, Send, CheckCircle } from 'lucide-react';
import { RequestMentorModal } from '../components/RequestMentorModal';

interface FacultyRecommendation {
  faculty_id?: string;
  faculty_name: string;
  name?: string;
  research_areas: string[];
  score: number;
  [key: string]: any;
}

export const Recommendations = () => {
  const [skills, setSkills] = useState('');
  const [interests, setInterests] = useState('');
  const [results, setResults] = useState<FacultyRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  // Request Mentor modal
  const [requestFaculty, setRequestFaculty] = useState<{ id: string; name: string } | null>(null);
  const [requestedFaculty, setRequestedFaculty] = useState<Set<string>>(new Set());

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccessMsg('');
    setHasSearched(true);

    try {
      const params: Record<string, string> = {};
      if (skills.trim()) params.skills = skills.trim();
      if (interests.trim()) params.interests = interests.trim();

      const response = await recommendationApi.get('/recommend/faculty', { params });
      const data = response.data;
      const rawRecs: FacultyRecommendation[] = Array.isArray(data) ? data : data.recommendations || data.results || [];
      const normalized = rawRecs.map((rec) => ({
        ...rec,
        faculty_name: rec.faculty_name || rec.name || 'Unknown Faculty',
      }));
      setResults(normalized);
    } catch (err: any) {
      console.error('Recommendation error:', err);
      setError(err.response?.data?.error || 'Failed to fetch recommendations. The recommendation service may not be running.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestSubmitted = (facultyName: string) => {
    setRequestedFaculty((prev) => new Set(prev).add(facultyName));
    setSuccessMsg(`Mentorship request sent to ${facultyName}!`);
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'text-emerald-600';
    if (score >= 0.5) return 'text-amber-600';
    return 'text-slate-500';
  };

  const getScoreBarColor = (score: number) => {
    if (score >= 0.8) return 'bg-emerald-500';
    if (score >= 0.5) return 'bg-amber-500';
    return 'bg-slate-400';
  };

  const getScoreBg = (score: number) => {
    if (score >= 0.8) return 'bg-emerald-50';
    if (score >= 0.5) return 'bg-amber-50';
    return 'bg-slate-50';
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Faculty Recommendations</h2>
        <p className="text-slate-500">Find faculty mentors that match your skills and interests.</p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1">
              <Sparkles className="w-4 h-4 text-slate-400" />
              Skills
            </label>
            <input
              type="text"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              placeholder="E.g., Python, Machine Learning, NLP"
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1">
              <BookOpen className="w-4 h-4 text-slate-400" />
              Interests
            </label>
            <input
              type="text"
              value={interests}
              onChange={(e) => setInterests(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              placeholder="E.g., Computer Vision, Distributed Systems"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-purple-600 rounded-lg hover:from-violet-700 hover:to-purple-700 disabled:opacity-50 transition-all shadow-sm"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {isLoading ? 'Searching...' : 'Find Faculty'}
          </button>
        </div>
      </form>

      {/* Feedback */}
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

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-14 h-14 rounded-full bg-violet-100 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-violet-600 animate-spin" />
          </div>
          <p className="text-sm text-slate-500 font-medium">Finding the best faculty matches...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && hasSearched && results.length === 0 && !error && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
          <GraduationCap className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">No matches found</h3>
          <p className="text-slate-500 text-sm">Try broadening your skills or interests to find more faculty.</p>
        </div>
      )}

      {/* Results */}
      {!isLoading && results.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-500">
            Showing top {results.length} result{results.length > 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {results.map((faculty, index) => {
              const rawScore = faculty.score;
              const normalizedScore = rawScore > 1 ? rawScore : rawScore * 100;
              const barWidth = rawScore > 1 ? rawScore : rawScore * 100;
              const isRequested = requestedFaculty.has(faculty.faculty_name);

              return (
                <div
                  key={index}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col"
                >
                  <div className="p-5 pb-4 flex-1">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-lg shrink-0">
                          {faculty.faculty_name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <h4 className="text-base font-semibold text-slate-900">{faculty.faculty_name}</h4>
                          <p className="text-xs text-slate-500">Faculty Mentor</p>
                        </div>
                      </div>
                      <div className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold ${getScoreBg(rawScore > 1 ? rawScore / 100 : rawScore)} ${getScoreColor(rawScore > 1 ? rawScore / 100 : rawScore)}`}>
                        <Star className="w-3 h-3" />
                        {normalizedScore.toFixed(0)}%
                      </div>
                    </div>

                    {/* Score Bar */}
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-4">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${getScoreBarColor(rawScore > 1 ? rawScore / 100 : rawScore)}`}
                        style={{ width: `${Math.min(barWidth, 100)}%` }}
                      />
                    </div>

                    {/* Research Areas */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Research Areas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(faculty.research_areas || []).length > 0 ? (
                          faculty.research_areas.map((area, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs font-medium"
                            >
                              {area}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">No research areas listed</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Request Mentor Button */}
                  <div className="px-5 pb-5">
                    {isRequested ? (
                      <div className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl">
                        <CheckCircle className="w-4 h-4" />
                        Request Sent
                      </div>
                    ) : (
                      <button
                        onClick={() => setRequestFaculty({ id: faculty.faculty_id || '', name: faculty.faculty_name })}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors shadow-sm"
                      >
                        <Send className="w-4 h-4" />
                        Request Mentor
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Request Mentor Modal */}
      <RequestMentorModal
        isOpen={!!requestFaculty}
        onClose={() => setRequestFaculty(null)}
        onRequested={() => requestFaculty && handleRequestSubmitted(requestFaculty.name)}
        facultyName={requestFaculty?.name || ''}
        facultyId={requestFaculty?.id || ''}
      />
    </div>
  );
};
