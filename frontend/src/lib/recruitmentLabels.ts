/** Solo-project recruitment_status values from API */
/** Labels are owner-facing visibility, not headcount limits (API values unchanged). */
export const RECRUITMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'looking_for_3', label: 'Actively recruiting collaborators' },
  { value: 'looking_for_2', label: 'Recruiting collaborators' },
  { value: 'looking_for_1', label: 'Open to selective additions' },
  { value: 'full', label: 'Not accepting join requests' },
];

export function formatRecruitmentStatus(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const hit = RECRUITMENT_OPTIONS.find((o) => o.value === value);
  return hit?.label ?? value.replace(/_/g, ' ');
}
