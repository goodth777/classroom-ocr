// Pure: turns raw Classroom lists into the teacher's student x assignment grid.
function buildGrid(students, works, subs) {
  const cells = {};
  subs.forEach(s => {
    const files = ((s.assignmentSubmission || {}).attachments || []).filter(a => a.driveFile);
    const last = files[files.length - 1];
    (cells[s.userId] = cells[s.userId] || {})[s.courseWorkId] = {
      state: s.state,
      late: !!s.late,
      updated: s.updateTime || '',
      docId: last ? last.driveFile.id : null,
      link: last ? last.driveFile.alternateLink || '' : '',
    };
  });
  return {
    students: students
      .map(s => ({ id: s.userId, name: s.profile.name.fullName }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    works: works
      .map(w => ({ id: w.id, title: w.title, app: !!w.associatedWithDeveloper, created: w.creationTime }))
      .sort((a, b) => a.created.localeCompare(b.created)),
    cells,
  };
}

if (typeof module !== 'undefined') module.exports = { buildGrid };
