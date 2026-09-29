import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, X, Loader2, ClipboardList } from 'lucide-react';

export default function BloqueoExamenesModal({ profile, examenes, estaBloqueado, onToggle, actionLoading, onClose }) {
  return (
    <AnimatePresence>
      {profile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-heading text-lg font-bold text-foreground">Acceso a Exámenes</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{profile.nombre} {profile.apellidos}</p>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {examenes.length === 0 ? (
              <div className="text-center py-10">
                <ClipboardList className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No hay exámenes creados aún.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {examenes.map((examen) => {
                  const bloqueado = estaBloqueado(profile.id, examen.id);
                  const key = `${profile.id}-${examen.id}`;
                  return (
                    <div key={examen.id} className="flex items-center justify-between gap-4 border border-border-subtle rounded p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{examen.nombre}</p>
                        <p className="text-xs text-muted-foreground">Categoría {examen.categoria}</p>
                      </div>
                      <button
                        onClick={() => onToggle(profile.id, examen.id)}
                        disabled={actionLoading[key]}
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all duration-200 disabled:opacity-50 ${
                          bloqueado
                            ? 'text-danger border-danger-border bg-danger-soft/60 hover:bg-danger hover:text-white'
                            : 'text-primary border-primary/30 bg-primary/5 hover:bg-primary hover:text-primary-foreground'
                        }`}
                      >
                        {actionLoading[key] ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : bloqueado ? (
                          <Lock className="w-3.5 h-3.5" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5" />
                        )}
                        {bloqueado ? 'Bloqueado' : 'Permitido'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}