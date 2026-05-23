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
  
  if (file === 'src/App.tsx') {
    content = content.replace(/import \{ useCollectionData \} from "react-firebase-hooks\/firestore";/, 'import { useCustomCollectionData } from "./lib/firestoreUtils";');
  } else {
    // Some use useDocumentData, so only replace useCollectionData
    content = content.replace(/import \{ useCollectionData \} from 'react-firebase-hooks\/firestore';/, 'import { useCustomCollectionData } from "../lib/firestoreUtils";');
    content = content.replace(/import \{ useCollectionData, useDocumentData \} from "react-firebase-hooks\/firestore";/, 'import { useDocumentData } from "react-firebase-hooks/firestore";\nimport { useCustomCollectionData } from "../lib/firestoreUtils";');
  }
  
  content = content.replace(/useCollectionData\(/g, 'useCustomCollectionData(');
  content = content.replace(/ as any\)/g, ')');
  
  fs.writeFileSync(filePath, content, 'utf8');
}
console.log('Fixed hook');
