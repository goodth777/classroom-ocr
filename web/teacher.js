import { render } from './ui.js';
import { esc } from './lib.js';
export function teacherHome(me) { render(`<p class="card">교사: ${esc(me.teaching.map(c => c.name).join(', '))} (Task 8)</p>`); }
export async function teacherCourse() { render('<p class="card">대시보드 (Task 8)</p>'); }
