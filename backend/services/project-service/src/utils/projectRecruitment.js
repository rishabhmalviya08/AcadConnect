const { createError } = require('./errors');

const RECRUITMENT_VALUES = ['full', 'looking_for_1', 'looking_for_2', 'looking_for_3'];

function isValidRecruitmentStatus(v) {
  return RECRUITMENT_VALUES.includes(v);
}

/**
 * Owner may set recruitment status for solo projects; value is not tied to collaborator count.
 */
async function assertOwnerRecruitmentUpdate(_trx, project, nextStatus) {
  if (!isValidRecruitmentStatus(nextStatus)) {
    throw createError(
      400,
      `recruitment_status must be one of: ${RECRUITMENT_VALUES.join(', ')}`
    );
  }
  if (project.group_id) {
    throw createError(400, 'Recruitment status only applies to individual (solo) projects');
  }
}

module.exports = {
  RECRUITMENT_VALUES,
  isValidRecruitmentStatus,
  assertOwnerRecruitmentUpdate,
};
