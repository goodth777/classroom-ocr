// Seat layouts for homeroom classes. The app keeps its own copy and saves here in the background,
// so these routes never sit in front of the teacher. Newer `updated` wins.
const MAX_LAYOUT_ = 45000;

function seats_(req) {
  return rows_('Seats').filter(s => s.classId === req.classId)
    .map(s => ({ id: s.id, name: s.name, layout: s.layout, updated: s.updated }));
}

function seatPut_(req) {
  const id = String(req.id || '');
  const layout = String(req.layout || '');
  if (!id || !layout || layout.length > MAX_LAYOUT_) throw err_('좌석 배치를 저장하지 못했어요.');
  if (!rows_('Classes').some(c => c.id === req.classId)) throw err_('클래스를 찾을 수 없어요.', 'notfound');
  const updated = String(req.updated || now_());
  return withLock_(() => {
    const row = rows_('Seats').find(s => s.id === id);
    if (row) {
      if (String(row.updated) >= updated) return row.updated; // an older save arriving late
      Object.assign(row, { name: String(req.name || ''), layout: layout, updated: updated });
      update_('Seats', row._row, row);
    } else {
      append_('Seats', { id: id, classId: req.classId, name: String(req.name || ''), layout: layout, updated: updated });
    }
    return updated;
  });
}

function seatDel_(req) {
  return withLock_(() => {
    deleteRows_('Seats', rows_('Seats').filter(s => s.id === String(req.id)));
    return true;
  });
}
