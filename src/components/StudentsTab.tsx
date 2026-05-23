import React, { useState, useRef } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, addDoc, updateDoc, deleteDoc, doc, writeBatch, getDocs, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { Upload, Users, Trash2, AlertTriangle, FileSpreadsheet, Plus, X } from 'lucide-react';
import { trackEvent, ANALYTICS_CATEGORIES, ANALYTICS_ACTIONS } from '../lib/analytics';
import { motion, AnimatePresence } from 'motion/react';
import { extractTextFromFile } from '../lib/fileParser';
import { ai } from '../lib/gemini';
import { cn } from '../lib/utils';

export function StudentsTab({ subjectId }: { subjectId: string }) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const studentsRef = collection(db, 'students');
  const studentsQuery = user?.uid ? query(studentsRef, where('subjectId', '==', subjectId), where('userId', '==', user?.uid), limit(500)) : null;
  const [students = []] = useCustomCollectionData(studentsQuery);

  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [newStudent, setNewStudent] = useState({ cedula: '', firstName: '', lastName: '', gender: '' as 'M' | 'F' | '' });

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudent.firstName.trim() || !newStudent.lastName.trim() || !user) return;

    try {
      await addDoc(collection(db, 'students'), {
        userId: user.uid,
        subjectId,
        cedula: newStudent.cedula.trim(),
        firstName: newStudent.firstName.trim(),
        lastName: newStudent.lastName.trim(),
        gender: newStudent.gender || null
      });
      setNewStudent({ cedula: '', firstName: '', lastName: '', gender: '' });
      setIsAddingStudent(false);
      trackEvent(ANALYTICS_CATEGORIES.STUDENT, ANALYTICS_ACTIONS.CREATE);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'students');
    }
  };

  const [isProcessingFile, setIsProcessingFile] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsProcessingFile(true);

    const reader = new FileReader();

    if (file.name.toLowerCase().endsWith('.pdf')) {
      reader.onload = async (event) => {
        try {
          const result = event.target?.result as string;
          const text = await extractTextFromFile(result, file.type);

          const prompt = `
Analiza la siguiente lista de participantes/estudiantes. Extrae los estudiantes devolviendo SOLAMENTE un JSON con un array llamado "students". 
Intenta encontrar el nombre ("firstName"), apellido ("lastName"), y número de documento/cédula ("cedula", aunque a veces puede no estar presente, pon "" en ese caso). Genero ('gender') en 'M' o 'F' si se deduce, sino "". 
Ejemplo de formato:
{"students": [{"cedula": "123456", "firstName": "Juan Pablo", "lastName": "Perez Gomez", "gender": "M"}]}

Documento:
${text}
          `;

          const aiResponse = await ai({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { 
              temperature: 0.1,
              responseMimeType: "application/json"
            }
          });
          
          if (!aiResponse.text) throw new Error("No response");
          const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error("No JSON found");
          
          const parsed = JSON.parse(jsonMatch[0]);
          const newStudents: Array<{ userId: string; subjectId: string; cedula: string; firstName: string; lastName: string; gender: 'M' | 'F' | null }> = parsed.students.filter((s: { firstName?: string; lastName?: string }) => s.firstName && s.lastName).map((s: { cedula?: string; firstName: string; lastName: string; gender?: string }) => ({
            userId: user.uid,
            subjectId,
            cedula: s.cedula || '',
            firstName: s.firstName,
            lastName: s.lastName,
            gender: s.gender === 'M' || s.gender === 'F' ? s.gender : null
          }));

          if (newStudents.length > 0) {
            const batch = writeBatch(db);
            newStudents.forEach((st) => {
              const docRef = doc(collection(db, 'students'));
              batch.set(docRef, st);
            });
            await batch.commit();
            setAlertMessage(`Se extrajeron y añadieron ${newStudents.length} estudiantes desde el PDF mediante IA.`);
            trackEvent(ANALYTICS_CATEGORIES.STUDENT, ANALYTICS_ACTIONS.IMPORT, undefined, newStudents.length);
          } else {
             setAlertMessage('La IA no pudo detectar estudiantes en el PDF. Intenta con un formato más claro.');
          }
        } catch (error) {
          console.error(error);
          setAlertMessage('Error procesando el PDF con IA. Asegúrate de tener configurada tu API Key de Gemini y que el PDF contenga texto legible.');
        } finally {
          setIsProcessingFile(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    } else {
      // Excel Flow
      reader.onload = async (event) => {
        try {
          const XLSX = await import('xlsx');
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
          const newStudents: Array<{ userId: string; subjectId: string; cedula: string; firstName: string; lastName: string; gender: 'M' | 'F' | null }> = [];
          
          for (let i = 7; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 2) continue;
            
            const cedula = String(row[1] || '').trim();
            const lastName1 = String(row[3] || '').trim();
            const lastName2 = String(row[4] || '').trim();
            const firstName1 = String(row[5] || '').trim();
            const firstName2 = String(row[6] || '').trim();
            
            let gender: 'M' | 'F' | null = null;
            const possibleGenders = [
              String(row[2] || ''), 
              String(row[7] || ''), 
              String(row[8] || ''),
              String(row[9] || ''),
              String(row[10] || '')
            ].map(s => s.trim().toUpperCase());
            
            for (const g of possibleGenders) {
              if (g === 'M' || g === 'MASCULINO' || g === 'HOMBRE' || g === 'MASC' || g === 'MAS' || g === '1') {
                gender = 'M';
                break;
              }
              if (g === 'F' || g === 'FEMENINO' || g === 'MUJER' || g === 'FEM' || g === 'FE' || g === '2') {
                gender = 'F';
                break;
              }
            }
            
            if (cedula && firstName1 && cedula !== 'Cédula') {
              newStudents.push({
                userId: user.uid,
                subjectId,
                cedula,
                firstName: `${firstName1} ${firstName2}`.trim(),
                lastName: `${lastName1} ${lastName2}`.trim(),
                gender
              });
            }
          }
          
          if (newStudents.length > 0) {
            const batch = writeBatch(db);
            newStudents.forEach((st) => {
              const docRef = doc(collection(db, 'students'));
              batch.set(docRef, st);
            });
            await batch.commit();

            setAlertMessage(`Se importaron ${newStudents.length} estudiantes correctamente desde el archivo Excel.`);
            trackEvent(ANALYTICS_CATEGORIES.STUDENT, ANALYTICS_ACTIONS.IMPORT, undefined, newStudents.length);
          } else {
            setAlertMessage('No se encontraron estudiantes válidos en el archivo. Asegúrate de usar el formato correcto.');
          }
        } catch (error) {
          console.error('Error parsing file:', error);
          setAlertMessage('Ocurrió un error al procesar el archivo Excel. Asegúrate de que sea un archivo .xlsx, .xls o .csv válido.');
        } finally {
          setIsProcessingFile(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const confirmDeleteStudent = async () => {
    if (!studentToDelete || !user) return;
    try {
      const batch = writeBatch(db);
      
      batch.delete(doc(db, 'students', studentToDelete));
      
      const gradesQ = query(collection(db, 'grades'), where('studentId', '==', studentToDelete), where('userId', '==', user.uid), limit(500));
      const gradesSnap = await getDocs(gradesQ);
      gradesSnap.docs.forEach(d => batch.delete(d.ref));
      
      const attendanceQ = query(collection(db, 'attendance'), where('studentId', '==', studentToDelete), where('userId', '==', user.uid), limit(500));
      const attendanceSnap = await getDocs(attendanceQ);
      attendanceSnap.docs.forEach(d => batch.delete(d.ref));
      
      await batch.commit();

      setStudentToDelete(null);
      trackEvent(ANALYTICS_CATEGORIES.STUDENT, ANALYTICS_ACTIONS.DELETE);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `students/${studentToDelete}`);
    }
  };

  const confirmDeleteAll = async () => {
    if (!user) return;
    try {
      const batch = writeBatch(db);
      
      students.forEach(s => {
        batch.delete(doc(db, 'students', s.id!));
      });
      
      const gradesQ = query(collection(db, 'grades'), where('subjectId', '==', subjectId), where('userId', '==', user.uid), limit(500));
      const gradesSnap = await getDocs(gradesQ);
      gradesSnap.docs.forEach(d => batch.delete(d.ref));
      
      const attendanceQ = query(collection(db, 'attendance'), where('subjectId', '==', subjectId), where('userId', '==', user.uid), limit(500));
      const attendanceSnap = await getDocs(attendanceQ);
      attendanceSnap.docs.forEach(d => batch.delete(d.ref));
      
      await batch.commit();

      setShowDeleteAllConfirm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `students`);
    }
  };

  return (
    <div className="space-y-8">
      {/* Modals */}
      {alertMessage && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-8 mx-auto">
              <Upload className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-4 text-center tracking-tight">Aviso</h3>
            <p className="text-neutral-500 mb-10 text-center font-medium leading-relaxed">{alertMessage}</p>
            <button onClick={() => setAlertMessage(null)} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest text-xs">
              Aceptar
            </button>
          </div>
        </div>
      )}

      {showDeleteAllConfirm && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-3xl p-8 max-md w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex items-center gap-4 text-red-500 mb-6">
              <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold text-neutral-900">Borrar todos</h3>
            </div>
            <p className="text-neutral-500 mb-8 leading-relaxed font-medium">
              ¿Estás seguro de eliminar TODOS los estudiantes de esta asignatura? También se eliminarán todas sus calificaciones y registros de asistencia. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-4">
              <button onClick={() => setShowDeleteAllConfirm(false)} className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 py-3.5 rounded-2xl font-bold transition-all active:scale-95">
                Cancelar
              </button>
              <button onClick={confirmDeleteAll} className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3.5 rounded-2xl font-bold transition-all shadow-xl shadow-red-500/20 active:scale-95">
                Sí, borrar todos
              </button>
            </div>
          </div>
        </div>
      )}

      {studentToDelete !== null && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-6">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-2xl font-bold text-neutral-900 mb-3">Eliminar estudiante</h3>
            <p className="text-neutral-500 mb-8 leading-relaxed font-medium">
              ¿Eliminar estudiante? También se eliminarán sus calificaciones y asistencia.
            </p>
            <div className="flex gap-4">
              <button onClick={() => setStudentToDelete(null)} className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 py-3.5 rounded-2xl font-bold transition-all active:scale-95">
                Cancelar
              </button>
              <button onClick={confirmDeleteStudent} className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3.5 rounded-2xl font-bold transition-all shadow-xl shadow-red-500/20 active:scale-95">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddingStudent && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black text-neutral-900 tracking-tight">Nuevo Participante</h3>
              <button onClick={() => setIsAddingStudent(false)} className="text-neutral-400 hover:text-neutral-900 transition-colors p-2 hover:bg-neutral-50 rounded-xl">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleAddStudent} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Cédula / ID</label>
                <input 
                  type="text" 
                  value={newStudent.cedula} 
                  onChange={e => setNewStudent({...newStudent, cedula: e.target.value})} 
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold placeholder:text-neutral-300" 
                  placeholder="Ej. 8-123-456" 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Nombres</label>
                <input 
                  required
                  type="text" 
                  value={newStudent.firstName} 
                  onChange={e => setNewStudent({...newStudent, firstName: e.target.value})} 
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold placeholder:text-neutral-300" 
                  placeholder="Ej. Juan Carlos" 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Apellidos</label>
                <input 
                  required
                  type="text" 
                  value={newStudent.lastName} 
                  onChange={e => setNewStudent({...newStudent, lastName: e.target.value})} 
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold placeholder:text-neutral-300" 
                  placeholder="Ej. Pérez Gómez" 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Género</label>
                <select
                  value={newStudent.gender}
                  onChange={e => setNewStudent({...newStudent, gender: e.target.value as 'M' | 'F' | ''})}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold cursor-pointer"
                >
                  <option value="">No especificado</option>
                  <option value="M">Masculino</option>
                  <option value="F">Femenino</option>
                </select>
              </div>
              <div className="pt-4 flex gap-4">
                <button type="button" onClick={() => setIsAddingStudent(false)} className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95">
                  Cancelar
                </button>
                <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-indigo-500/20 active:scale-95">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
        <div className="flex flex-wrap gap-6">
          <div className="bg-white border border-neutral-200 px-8 py-6 rounded-[2rem] shadow-sm flex items-center gap-6 hover:border-indigo-200 transition-all group">
            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
              <Users className="w-7 h-7 text-indigo-600" />
            </div>
            <div>
              <span className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em] block mb-1">Total Estudiantes</span>
              <span className="text-4xl font-black text-neutral-900 leading-none tracking-tight">{students.length}</span>
            </div>
          </div>
          <div className="bg-white border border-neutral-200 px-8 py-6 rounded-[2rem] shadow-sm flex items-center gap-8 hover:border-neutral-300 transition-all">
            <div className="flex items-center gap-4">
              <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)]" />
              <div>
                <span className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em] block mb-1">Masculino</span>
                <span className="text-2xl font-black text-neutral-900 leading-none tracking-tight">{students.filter(s => s.gender === 'M').length}</span>
              </div>
            </div>
            <div className="w-px h-12 bg-neutral-100" />
            <div className="flex items-center gap-4">
              <div className="w-3 h-3 rounded-full bg-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.4)]" />
              <div>
                <span className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em] block mb-1">Femenino</span>
                <span className="text-2xl font-black text-neutral-900 leading-none tracking-tight">{students.filter(s => s.gender === 'F').length}</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4 w-full lg:w-auto">
          {students.length > 0 && (
            <button
              onClick={() => setShowDeleteAllConfirm(true)}
              className="flex-1 lg:flex-none flex items-center justify-center gap-3 bg-red-50 hover:bg-red-100 text-red-600 px-8 py-4 rounded-2xl text-xs font-black transition-all border border-red-100 active:scale-95 uppercase tracking-widest"
            >
              <AlertTriangle className="w-5 h-5" />
              Borrar Todos
            </button>
          )}
          <input 
            type="file" 
            accept=".xlsx, .xls, .csv, .pdf" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            disabled={isProcessingFile}
          />
          <button
            onClick={() => setIsAddingStudent(true)}
            className="flex-1 lg:flex-none flex items-center justify-center gap-3 bg-white border border-neutral-200 hover:border-indigo-500 text-indigo-600 px-8 py-4 rounded-2xl text-xs font-black transition-all shadow-sm active:scale-95 uppercase tracking-widest disabled:opacity-50"
            disabled={isProcessingFile}
          >
            <Plus className="w-5 h-5" />
            Nuevo
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 lg:lg:flex-none flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white px-10 py-4 rounded-2xl text-xs font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest disabled:opacity-50"
            disabled={isProcessingFile}
          >
            <FileSpreadsheet className={`w-5 h-5 ${isProcessingFile ? 'animate-pulse' : ''}`} />
            {isProcessingFile ? "PROCESANDO..." : "IMPORTAR"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-neutral-200 rounded-[3rem] overflow-hidden shadow-sm">
        {students.length === 0 ? (
          <div className="p-32 text-center text-neutral-400">
            <div className="w-24 h-24 bg-neutral-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-neutral-100">
              <Users className="w-12 h-12 text-neutral-200" />
            </div>
            <p className="text-3xl font-black text-neutral-900 tracking-tight">No hay estudiantes registrados</p>
            <p className="text-lg mt-4 font-medium text-neutral-500">Importa un archivo Excel (.xlsx, .xls) para comenzar.</p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={() => setIsAddingStudent(true)}
                className="flex items-center justify-center gap-3 bg-white border border-neutral-200 hover:border-indigo-500 text-indigo-600 px-10 py-5 rounded-2xl text-sm font-black transition-all shadow-sm active:scale-95 uppercase tracking-widest w-full sm:w-auto"
              >
                <Plus className="w-6 h-6" />
                Añadir Manualmente
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white px-10 py-5 rounded-2xl text-sm font-black transition-all shadow-2xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest w-full sm:w-auto"
              >
                <FileSpreadsheet className="w-6 h-6" />
                Importar Excel
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-100">
                <tr>
                  <th className="px-10 py-6 font-black uppercase tracking-[0.2em] text-[10px]">Cédula</th>
                  <th className="px-10 py-6 font-black uppercase tracking-[0.2em] text-[10px]">Apellidos</th>
                  <th className="px-10 py-6 font-black uppercase tracking-[0.2em] text-[10px]">Nombres</th>
                  <th className="px-10 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-center">Género</th>
                  <th className="px-10 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {students.map(student => (
                  <tr key={student.id} className="hover:bg-neutral-50 transition-all group duration-300">
                    <td className="px-10 py-6 text-neutral-400 font-mono font-bold tracking-widest uppercase text-[10px]">{student.cedula}</td>
                    <td className="px-10 py-6 text-xl font-black text-neutral-900 group-hover:text-indigo-600 transition-colors tracking-tight">{student.lastName}</td>
                    <td className="px-10 py-6 text-xl font-black text-neutral-900 group-hover:text-indigo-600 transition-colors tracking-tight">{student.firstName}</td>
                    <td className="px-10 py-6">
                      <div className="flex justify-center">
                        <select
                          value={student.gender || ''}
                          onChange={async (e) => {
                            const val = e.target.value as 'M' | 'F' | '';
                            try {
                              if (val) {
                                await updateDoc(doc(db, 'students', student.id!), { gender: val });
                              } else {
                                await updateDoc(doc(db, 'students', student.id!), { gender: null });
                              }
                            } catch (error) {
                              handleFirestoreError(error, OperationType.UPDATE, `students/${student.id}`);
                            }
                          }}
                          className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2 text-xs font-black text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all cursor-pointer uppercase tracking-widest"
                        >
                          <option value="">-</option>
                          <option value="M">M</option>
                          <option value="F">F</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-10 py-6 text-right">
                      <button 
                        onClick={() => setStudentToDelete(student.id!)} 
                        className="text-neutral-400 hover:text-red-600 p-3 rounded-xl hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 active:scale-90"
                        title="Eliminar estudiante"
                      >
                        <Trash2 className="w-6 h-6" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
