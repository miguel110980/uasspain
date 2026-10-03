import PanelModal from '@/components/ui/PanelModal';
import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import AlumnoResultados from '@/pages/alumno/AlumnoResultados';



export default function ResultadosAlumnoModal({ profile, onClose }) {
  return (
    <AnimatePresence>
      {profile && (
        <PanelModal label="Resultados del alumno" onClose={onClose} className="glass-card max-w-3xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-heading text-lg font-bold text-foreground">Resultados del Alumno</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{profile.nombre} {profile.apellidos}</p>
              </div>
              <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <AlumnoResultados alumnoId={profile.id} />
          </PanelModal>
      )}
    </AnimatePresence>
  );
}