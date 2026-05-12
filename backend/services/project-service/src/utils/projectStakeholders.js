/**
 * Resolve which student user_ids should receive project-related notifications.
 */
const getAcceptedGroupMemberIds = async (trx, groupId) => {
  const members = await trx('group_members')
    .select('student_id')
    .where({ group_id: groupId, status: 'accepted' });
  return members.map((m) => m.student_id);
};

const getProjectStakeholderStudentIds = async (trx, project) => {
  if (project.group_id) {
    return getAcceptedGroupMemberIds(trx, project.group_id);
  }
  const ids = new Set();
  if (project.creator_student_id) ids.add(project.creator_student_id);
  const collab = await trx('project_members')
    .select('student_id')
    .where({ project_id: project.id });
  collab.forEach((r) => ids.add(r.student_id));
  return [...ids];
};

/** Student can act on behalf of the project (view progress, solo mentor request, etc.). */
const isStudentProjectParticipant = async (trx, project, studentId) => {
  if (!project || !studentId) return false;
  if (project.creator_student_id === studentId) return true;
  if (project.group_id) {
    const m = await trx('group_members')
      .where({ group_id: project.group_id, student_id: studentId, status: 'accepted' })
      .first();
    return !!m;
  }
  const pm = await trx('project_members')
    .where({ project_id: project.id, student_id: studentId })
    .first();
  return !!pm;
};

module.exports = {
  getAcceptedGroupMemberIds,
  getProjectStakeholderStudentIds,
  isStudentProjectParticipant,
};
