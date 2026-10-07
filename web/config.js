export const CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
export const SCRIPT_ID = 'YOUR_API_EXECUTABLE_DEPLOYMENT_ID';
export const SCOPES = [
  'classroom.courses.readonly',
  'classroom.rosters.readonly',
  'classroom.coursework.me',
  'classroom.coursework.students',
  'documents',
  'drive.file',
].map(s => 'https://www.googleapis.com/auth/' + s).join(' ');
