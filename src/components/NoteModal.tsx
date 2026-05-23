import { format } from 'date-fns';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Paperclip, FileText, Trash2, Loader2 } from 'lucide-react';
import { trackEvent, ANALYTICS_CATEGORIES, ANALYTICS_ACTIONS } from '../lib/analytics';
import type { NoteDoc, AttachmentDoc } from '../types/firestore';
import { cn } from '../lib/utils';
import { useAuth } from './AuthProvider';
import { collection, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjectId: string;
  moduleId?: string;
  noteToEdit?: NoteDoc | null;
}

export function NoteModal({ isOpen, onClose, subjectId, moduleId, noteToEdit }: NoteModalProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [attachment, setAttachment] = useState<AttachmentDoc | undefined>(undefined);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (noteToEdit) {
      setTitle(noteToEdit.title);
      setContent(noteToEdit.content);
      setDate(noteToEdit.date);
      setAttachment(noteToEdit.attachment);
    } else {
      setTitle('');
      setContent('');
      setDate(new Date().toISOString().split('T')[0]);
      setAttachment(undefined);
    }
    setSelectedFile(null);
    setShowDeleteConfirm(false);
  }, [noteToEdit, isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setAttachment({
      name: file.name,
      type: file.type,
      data: null // URL will be set upon upload
    });

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
    if (!user) return;
    const now = Date.now();
    setIsUploading(true);
    
    try {
      let finalAttachment = attachment;
      
      if (selectedFile) {
        // Fallback a Firebase Storage para archivos > 800KB
        const fileRef = ref(storage, `users/${user.uid}/notes/${now}_${selectedFile.name}`);
        const snapshot = await uploadBytes(fileRef, selectedFile);
        const downloadURL = await getDownloadURL(snapshot.ref);
        finalAttachment = {
          name: selectedFile.name,
          type: selectedFile.type,
          data: downloadURL
        };
      }

      if (noteToEdit?.id) {
        await updateDoc(doc(db, 'notes', noteToEdit.id), { 
          title, 
          content, 
          date,
          attachment: finalAttachment || null,
          updatedAt: now 
        });
        trackEvent(ANALYTICS_CATEGORIES.NOTE, ANALYTICS_ACTIONS.EDIT);
      } else {
        await addDoc(collection(db, 'notes'), { 
          userId: user.uid,
          subjectId, 
          moduleId: moduleId || null,
          title, 
          content, 
          date,
          attachment: finalAttachment || null,
          createdAt: now, 
          updatedAt: now 
        });
        trackEvent(ANALYTICS_CATEGORIES.NOTE, ANALYTICS_ACTIONS.CREATE);
      }
      setIsUploading(false);
      onClose();
    } catch (error: unknown) {
      setIsUploading(false);
      alert(`No se pudo guardar: ${error instanceof Error ? error.message : 'Error desconocido'}\nSi estás subiendo archivos y recibes permisos denegados, asegúrate de activar y configurar Firebase Storage correctamente.`);
      handleFirestoreError(error, OperationType.WRITE, 'notes');
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
              {noteToEdit ? 'Editar Apunte' : 'Nuevo Apunte'}
            </h2>
            <button type="button" aria-label="Cerrar" onClick={onClose} className="text-neutral-400 hover:text-neutral-900 transition-colors p-2 hover:bg-neutral-50 rounded-xl">
              <X className="w-6 h-6" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-8 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
            <div className="flex gap-6 flex-col sm:flex-row">
              <div className="flex-1">
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Título del tema</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold placeholder:text-neutral-300"
                  placeholder="Ej. Introducción a las Derivadas"
                />
              </div>
              <div className="sm:w-48">
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Fecha</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold [color-scheme:light]"
                />
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-[300px]">
              <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">Contenido / Apuntes</label>
              <textarea
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full flex-1 bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-5 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all resize-none font-mono text-sm leading-relaxed font-bold placeholder:text-neutral-300"
                placeholder="Escribe tus apuntes aquí..."
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

            <div className="pt-8 flex justify-between items-center border-t border-neutral-100 shrink-0">
              <div>
                {noteToEdit && !showDeleteConfirm && (
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-red-500 hover:bg-red-50 transition-all text-xs font-black uppercase tracking-widest disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Eliminar
                  </button>
                )}
              </div>

              {showDeleteConfirm ? (
                <div className="flex-1 flex items-center justify-between bg-red-50 p-4 rounded-2xl border border-red-100 animate-in fade-in slide-in-from-right-4">
                  <span className="text-xs font-black text-red-600 uppercase tracking-widest">¿Confirmar?</span>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="text-xs font-black text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-widest"
                    >
                      No
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await deleteDoc(doc(db, 'notes', noteToEdit!.id!));
                          trackEvent(ANALYTICS_CATEGORIES.NOTE, ANALYTICS_ACTIONS.DELETE);
                          onClose();
                        } catch (error) {
                          handleFirestoreError(error, OperationType.DELETE, `notes/${noteToEdit!.id}`);
                        }
                      }}
                      className="text-xs font-black text-red-600 hover:text-red-700 uppercase tracking-widest"
                    >
                      Sí, eliminar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-4">
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
                      'Guardar Apunte'
                    )}
                  </button>
                </div>
              )}
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
