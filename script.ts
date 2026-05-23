import * as fs from 'fs';
import * as path from 'path';

const filesToPatch = [
  'src/App.tsx',
  'src/components/AttendanceReport.tsx',
  'src/components/AttendanceTab.tsx',
  'src/components/CalendarSection.tsx',
  'src/components/Dashboard.tsx',
  'src/components/GradesSummary.tsx',
  'src/components/GradesTab.tsx',
  'src/components/ModulesTab.tsx',
  'src/components/ProgressWidget.tsx',
  'src/components/StudentsTab.tsx'
];

for (const file of filesToPatch) {
  const filePath = path.join(process.cwd(), file);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/, \{ idField: 'id' \}/g, ' as any');
  fs.writeFileSync(filePath, content, 'utf8');
}
console.log('Fixed');
