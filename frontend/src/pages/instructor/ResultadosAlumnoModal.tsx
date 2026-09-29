import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import AlumnoResultados from '@/pages/alumno/AlumnoResultados';



export default function ResultadosAlumnoModal({ profile, onClose }) {
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
            className="glass-card w-full max-w-3xl p-6 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-heading text-lg font-bold text-foreground">Resultados del Alumno</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{profile.nombre} {profile.apellidos}</p>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <AlumnoResultados alumnoId={profile.id} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}