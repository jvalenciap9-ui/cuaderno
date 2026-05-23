import { format } from 'date-fns';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Paperclip, FileText, Loader2 } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { MaterialDoc } from '../types/firestore';
import { useAuth } from './AuthProvider';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { trackEvent, ANALYTICS_CATEGORIES, ANALYTICS_ACTIONS } from '../lib/analytics';

type Attachment = {
  name: string;
  type: string;
  data: string | null;
};

interface MaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjectId: string;
  moduleId?: string;
  materialToEdit?: MaterialDoc | null;
}

export function MaterialModal({ isOpen, onClose, subjectId, moduleId, materialToEdit }: MaterialModalProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'book' | 'link' | 'video' | 'document' | 'other'>('document');
  const [description, setDescription] = useState('');
  const [observations, setObservations] = useState('');
  const [date, setDate] = useState('');
  const [attachment, setAttachment] = useState<Attachment | undefined>(undefined);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (materialToEdit) {
      setTitle(materialToEdit.title);
      setType(materialToEdit.type);
      setDescription(materialToEdit.description || '');
      setObservations(materialToEdit.observations || '');
      setDate(materialToEdit.date || '');
      setAttachment(materialToEdit.attachment);
    } else {
      setTitle('');
      setType('document');
      setDescription('');
      setObservations('');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setAttachment(undefined);
    }
    setSelectedFile(null);
  }, [materialToEdit, isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setAttachment({
      name: file.name,
      type: file.type,
      data: null // URL will be set upon upload
    });
    if (!title) {
      setTitle(file.name);
    }
    
    // Leer el archivo como Base64 para evitar Storage si es menor de 800KB
    if (file.size <= 800 * 1024) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachment({
          name: file.name,
          type: file.type,
          data: event.target?.result as string
        });
        setSelectedFile(null); // No subir a Storage si lo guardamos como Base64
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !user) return;

    setIsUploading(true);
    const now = Date.now();

    try {
      let finalAttachment = attachment;
      
      if (selectedFile) {
        // Fallback a Firebase Storage para archivos > 800KB
        const fileRef = ref(storage, `users/${user.uid}/materials/${now}_${selectedFile.name}`);
        const snapshot = await uploadBytes(fileRef, selectedFile);
        const downloadURL = await getDownloadURL(snapshot.ref);
        finalAttachment = {
          name: selectedFile.name,
          type: selectedFile.type,
          data: downloadURL
        };
      }

      if (materialToEdit?.id) {
        await updateDoc(doc(db, 'materials', materialToEdit.id), {
          title,
          type,
          description,
          observations,
          date,
          attachment: finalAttachment || null
        });
        trackEvent(ANALYTICS_CATEGORIES.MATERIAL, ANALYTICS_ACTIONS.EDIT);
      } else {
        await addDoc(collection(db, 'materials'), {
          userId: user.uid,
          subjectId,
          moduleId: moduleId || null,
          title,
          type,
          description,
          observations,
          date: date || new Date().toISOString().split('T')[0],
          attachment: finalAttachment || null
        });
        trackEvent(ANALYTICS_CATEGORIES.MATERIAL, ANALYTICS_ACTIONS.CREATE);
      }
      setIsUploading(false);
      onClose();
    } catch (error: unknown) {
      setIsUploading(false);
      alert(`No se pudo guardar: ${error instanceof Error ? error.message : 'Error desconocido'}\nSi estás subiendo archivos y recibes permisos denegados, asegúrate de activar y configurar Firebase Storage correctamente.`);
      handleFirestoreError(error, OperationType.WRITE, 'materials');
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white border border-neutral-200 rounded-[2.5rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          <div className="flex items-center justify-between p-8 border-b border-neutral-100 shrink-0">
            <h2 className="text-2xl font-black text-neutral-900 tracking-tight">
              {materialToEdit ? 'Editar Material' : 'Nuevo Material'}
            </h2>
            <button aria-label="Cerrar" onClick={onClose} className="text-neutral-400 hover:text-neutral-900 transition-colors p-2 hover:bg-neutral-50 rounded-xl">
              <X className="w-6 h-6" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-8 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Título del Material</label>
                <input 
                  required 
                  type="text" 
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold placeholder:text-neutral-300" 
                  placeholder="Ej. Libro de Cálculo" 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Tipo de Recurso</label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value as any)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold cursor-pointer"
                 >
                  <option value="document">Documento</option>
                  <option value="book">Libro</option>
                  <option value="link">Enlace</option>
                  <option value="video">Video</option>
                  <option value="other">Otro</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Descripción (Opcional)</label>
              <textarea 
                value={description} 
                onChange={e => setDescription(e.target.value)} 
                className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold resize-none h-28 placeholder:text-neutral-300" 
                placeholder="Detalles sobre el material..." 
              />
            </div>
            
            <div>
              <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Fecha</label>
              <input 
                type="date"
                value={date} 
                onChange={e => setDate(e.target.value)} 
                className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold" 
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Observaciones (Opcional)</label>
              <textarea 
                value={observations} 
                onChange={e => setObservations(e.target.value)} 
                className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold resize-none h-20 placeholder:text-neutral-300" 
                placeholder="Observaciones adicionales, notas importantes..." 
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Archivo Adjunto</label>
              <div className="flex flex-wrap items-center gap-4">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-3 px-6 py-3.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-2xl text-xs font-black transition-all active:scale-95 uppercase tracking-widest shadow-lg shadow-neutral-900/10"
                >
                  <Paperclip className="w-5 h-5" />
                  Adjuntar Archivo
                </button>
                {attachment && (
                  <div className="flex items-center gap-3 bg-indigo-50 text-indigo-600 px-5 py-3 rounded-2xl border border-indigo-100 text-sm font-bold shadow-sm animate-in zoom-in duration-300">
                    <FileText className="w-5 h-5" />
                    <span className="truncate max-w-[200px]">{attachment.name}</span>
                    <button 
                      type="button" 
                      onClick={() => setAttachment(undefined)}
                      className="ml-2 p-1 hover:bg-indigo-100 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-8 flex justify-end gap-4 border-t border-neutral-100 shrink-0">
              <button
                type="button"
                disabled={isUploading}
                onClick={onClose}
                className="px-6 py-4 text-xs font-black text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-widest disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isUploading}
                className="px-10 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest text-xs disabled:opacity-50 disabled:scale-100 flex items-center gap-2"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Guardar Material'
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
