import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, X, Loader2, BookOpen, ClipboardList, Shield } from 'lucide-react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { useToast } from '@/components/ui/use-toast';
import { extractErrorMessage } from '@/lib/errors';

export default function InstructorAccesos({ profile, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState({});
  const [tab, setTab] = useState('materiales');
  const { toast } = useToast();

  useEffect(() => {
    if (!profile) return;
    setLoading(true);
    apiClient.get(endpoints.functions.instructorAccessList(profile.id))
      .then((res) => setData(res.data))
      .catch((err) => toast({ title: 'Error al cargar accesos', description: extractErrorMessage(err), variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [profile?.id]);

  const toggleAccess = async (type, itemId, currentAccess) => {
    const key = `${type}-${itemId}`;
    setToggling((prev) => ({ ...prev, [key]: true }));
    try {
      await apiClient.post(endpoints.functions.instructorAccessToggle, {
        alumno_id: profile.id,
        type,
        item_id: itemId,
        acceso: !currentAccess,
      });
      setData((prev) => {
        if (!prev) return prev;
        const listKey = type === 'material' ? 'materiales' : 'examenes';
        return {
          ...prev,
          [listKey]: prev[listKey].map((item) =>
            item.id === itemId ? { ...item, acceso: !currentAccess } : item
          ),
        };
      });
      toast({ title: !currentAccess ? 'Acceso concedido' : 'Acceso revocado' });
    } catch (err) {
      toast({ title: 'Error al cambiar acceso', description: extractErrorMessage(err), variant: 'destructive' });
    } finally {
      setToggling((prev) => ({ ...prev, [key]: false }));
    }
  };

  const items = data ? (tab === 'materiales' ? data.materiales : data.examenes) : [];

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
            className="glass-card w-full max-w-2xl p-6 max-h-[85vh] flex flex-col"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-heading text-lg font-bold text-foreground flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  Gestionar Accesos
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">{profile.nombre} {profile.apellidos}</p>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setTab('materiales')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all ${
                  tab === 'materiales'
                    ? 'text-primary border-primary/30 bg-primary/10'
                    : 'text-muted-foreground border-border-subtle hover:border-primary/20'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Materiales
              </button>
              <button
                onClick={() => setTab('examenes')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all ${
                  tab === 'examenes'
                    ? 'text-primary border-primary/30 bg-primary/10'
                    : 'text-muted-foreground border-border-subtle hover:border-primary/20'
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5" />
                Exámenes
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm text-muted-foreground">
                    No hay {tab === 'materiales' ? 'materiales' : 'exámenes'} disponibles.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => {
                    const key = `${tab === 'materiales' ? 'material' : 'examen'}-${item.id}`;
                    const isBlocked = !item.acceso;
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 border border-border-subtle rounded p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {item.titulo || item.nombre}
                          </p>
                          <p className="text-xs text-muted-foreground">Categoría {item.categoria}</p>
                        </div>
                        <button
                          onClick={() => toggleAccess(
                            tab === 'materiales' ? 'material' : 'examen',
                            item.id,
                            item.acceso,
                          )}
                          disabled={toggling[key]}
                          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all duration-200 disabled:opacity-50 ${
                            isBlocked
                              ? 'text-danger border-danger-border bg-danger-soft/60 hover:bg-danger hover:text-white'
                              : 'text-primary border-primary/30 bg-primary/5 hover:bg-primary hover:text-primary-foreground'
                          }`}
                        >
                          {toggling[key] ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : isBlocked ? (
                            <Lock className="w-3.5 h-3.5" />
                          ) : (
                            <Unlock className="w-3.5 h-3.5" />
                          )}
                          {isBlocked ? 'Bloqueado' : 'Permitido'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
