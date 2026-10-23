import PanelModal from '@/components/ui/PanelModal';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, ChevronLeft, ChevronRight, CheckCircle, XCircle, AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import examenesService from '@/services/examenesService';

const DURACION_TIEMPO = 40 * 60; // 40 minutos en segundos

export default function ExamenActivo({ examen, modalidad, onFinalizar }) {
  const [preguntas, setPreguntas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [respuestas, setRespuestas] = useState({});
  const [preguntaActual, setPreguntaActual] = useState(0);
  const [tiempoRestante, setTiempoRestante] = useState(DURACION_TIEMPO);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [vistaRevision, setVistaRevision] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const attemptRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const handleFinalizarRef = useRef<(automatico?: boolean) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const attempt = await examenesService.iniciarIntento(examen.id, modalidad);
        if (cancelled) return;
        attemptRef.current = attempt.id;
        setPreguntas(attempt.preguntas);
        setRespuestas(attempt.respuestas || {});
        const serverNow = Date.parse(attempt.server_now);
        const remainingMs = attempt.expires_at ? Math.max(0, Date.parse(attempt.expires_at) - serverNow) : null;
        deadlineRef.current = remainingMs === null ? null : performance.now() + remainingMs;
        setTiempoRestante(remainingMs === null ? DURACION_TIEMPO : Math.ceil(remainingMs / 1000));
      } catch {
        if (!cancelled) setError('No se pudo iniciar el examen. Comprueba tu conexión y los permisos con tu instructor.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; if (timerRef.current) clearInterval(timerRef.current); };
  }, [examen.id, modalidad]);

  useEffect(() => {
    if (loading || resultado || modalidad !== 'tiempo') return;
    timerRef.current = setInterval(() => {
      const remaining = Math.ceil(((deadlineRef.current ?? performance.now()) - performance.now()) / 1000);
      if (remaining <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        setTiempoRestante(0);
        handleFinalizarRef.current(true);
      } else {
        setTiempoRestante(remaining);
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading, resultado, modalidad]);

  useEffect(() => {
    const id = attemptRef.current;
    if (loading || resultado || finalizando || !id || tiempoRestante <= 0) return;
    const timer = setTimeout(() => {
      saveChainRef.current = saveChainRef.current
        .then(() => examenesService.guardarRespuestas(id, respuestas))
        .then(() => setErrorGuardado(false))
        .catch(() => setErrorGuardado(true));
    }, 400);
    return () => clearTimeout(timer);
  }, [respuestas, loading, resultado, finalizando, tiempoRestante <= 0]);

  const handleRespuesta = (pregId, opcion) => {
    if (resultado || submittingRef.current || (modalidad === 'tiempo' && tiempoRestante <= 0)) return;
    setRespuestas((prev) => ({ ...prev, [pregId]: opcion }));
  };

  const handleFinalizar = useCallback(async (_automatico = false) => {
    if (submittingRef.current || resultado || !attemptRef.current) return;
    submittingRef.current = true;
    setFinalizando(true);
    setErrorEnvio(null);
    const payload = {
      attempt_id: attemptRef.current,
      examen_id: examen.id,
      modalidad,
      respuestas,
    };

    try {
      const saved = await examenesService.resultados.create(payload);
      setResultado(saved);
      setVistaRevision(false);
    } catch (err) {
      console.error('Error finalizando examen:', err);
      setErrorEnvio(
        'No se pudo enviar el examen. Tus respuestas siguen en pantalla: inténtalo de nuevo.',
      );
    } finally {
      submittingRef.current = false;
      setFinalizando(false);
    }
  }, [respuestas, examen, modalidad, resultado]);

  useEffect(() => {
    handleFinalizarRef.current = handleFinalizar;
  }, [handleFinalizar]);

  const formatTiempo = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const respondidas = Object.keys(respuestas).length;
  const progreso = preguntas.length ? Math.round((respondidas / preguntas.length) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 glass-card">
        <ShieldAlert className="w-10 h-10 text-warning mb-3" />
        <p className="text-sm text-muted-foreground text-center mb-4">{error}</p>
        <button onClick={() => onFinalizar()} className="text-primary text-xs font-mono uppercase tracking-widest hover:text-foreground transition-colors">
          ← Volver
        </button>
      </div>
    );
  }

  if (preguntas.length === 0) {
    return (
      <div className="text-center py-20 glass-card">
        <p className="text-muted-foreground">Este examen no tiene preguntas configuradas todavía.</p>
        <button onClick={() => onFinalizar()} className="mt-6 text-primary text-xs font-mono uppercase tracking-widest hover:text-foreground transition-colors">
          ← Volver
        </button>
      </div>
    );
  }

  // Vista de resultado
  if (resultado && !vistaRevision) {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
        <div className="glass-card p-10 text-center">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${resultado.aprobado ? 'bg-primary/10 border-2 border-primary/30' : 'bg-danger-soft border-2 border-danger-border'}`}>
            {resultado.aprobado
              ? <CheckCircle className="w-10 h-10 text-primary" />
              : <XCircle className="w-10 h-10 text-danger" />}
          </div>

          <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
            {examen.nombre}
          </div>

          <h2 className="font-heading text-4xl font-bold text-foreground mb-1">
            <span className={resultado.aprobado ? 'text-primary' : 'text-danger'}>{resultado.nota}/10</span>
          </h2>
          <p className={`font-heading text-lg font-semibold mb-8 ${resultado.aprobado ? 'text-primary' : 'text-danger'}`}>
            {resultado.aprobado ? '¡Aprobado!' : 'Suspendido'}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
            {[
              { label: 'Preguntas', value: preguntas.length, color: 'text-foreground' },
              { label: 'Aciertos', value: resultado.aciertos, color: 'text-success' },
              { label: 'Errores', value: resultado.errores, color: 'text-danger' },
              { label: 'Porcentaje', value: `${resultado.porcentaje}%`, color: 'text-foreground' },
              { label: 'Tiempo', value: formatTiempo(resultado.tiempo_empleado), color: 'text-foreground' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface-muted border border-border-subtle p-4 rounded-sm">
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
                <p className={`font-heading text-xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => setVistaRevision(true)}
              className="px-6 py-3 border border-border-subtle text-muted-foreground text-xs font-bold uppercase tracking-widest hover:border-primary/30 hover:text-primary transition-all duration-200"
            >
              Revisar examen
            </button>
            <button
              onClick={() => onFinalizar()}
              className="px-6 py-3 bg-primary text-primary-foreground font-bold uppercase tracking-tighter text-xs hover:bg-primary/80 transition-all duration-300"
            >
              Volver a exámenes
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  // Vista de revisión
  if (resultado && vistaRevision) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-heading text-xl font-bold text-foreground">Revisión del examen</h2>
          <button
            onClick={() => setVistaRevision(false)}
            className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            ← Volver a resultados
          </button>
        </div>
        {preguntas.map((p, i) => {
          const detalle = resultado.detalle_revision?.[p.id];
          const respAlumno = detalle?.respuesta_alumno ?? resultado.respuestas?.[p.id];
          const opciones = { a: p.opcion_a, b: p.opcion_b, c: p.opcion_c, ...(p.opcion_d ? { d: p.opcion_d } : {}) };
          const acerto = detalle?.acerto === true;
          return (
            <div key={p.id} className={`glass-card p-6 border-l-4 ${acerto ? 'border-l-success' : 'border-l-danger'}`}>
              <div className="flex items-start gap-3 mb-4">
                <span className="text-xs font-mono text-muted-foreground shrink-0 mt-0.5">{i + 1}.</span>
                <p className="text-sm text-foreground">{p.enunciado}</p>
              </div>
              <div className="space-y-2 ml-5">
                {Object.entries(opciones).map(([key, text]) => {
                  const isSelected = key === respAlumno;
                  const isCorrectSelected = isSelected && acerto;
                  const isIncorrectSelected = isSelected && !acerto;
                  return (
                    <div
                      key={key}
        className={`px-4 py-2 text-sm rounded-sm flex items-center gap-3 ${
          isCorrectSelected
            ? 'bg-success-soft border border-success-border text-success'
            : isIncorrectSelected
            ? 'bg-danger-soft border border-danger-border text-danger'
            : 'border border-border-subtle text-muted-foreground'
        }`}
                    >
                      <span className="text-xs font-mono uppercase">{key})</span>
                      {text}
                      {isCorrectSelected && <CheckCircle className="w-3.5 h-3.5 ml-auto shrink-0" />}
                      {isIncorrectSelected && <XCircle className="w-3.5 h-3.5 ml-auto shrink-0" />}
                    </div>
                  );
                })}
                {!respAlumno && (
                  <p className="text-xs text-muted-foreground/60 mt-2 font-mono">Sin respuesta</p>
                )}
              </div>
            </div>
          );
        })}
      </motion.div>
    );
  }

  // Examen activo
  const pregunta = preguntas[preguntaActual];
  const opciones = [
    { key: 'a', text: pregunta.opcion_a },
    { key: 'b', text: pregunta.opcion_b },
    { key: 'c', text: pregunta.opcion_c },
    ...(pregunta.opcion_d ? [{ key: 'd', text: pregunta.opcion_d }] : []),
  ];

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header examen */}
      <div className="glass-card px-6 py-4 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="font-heading text-sm font-semibold text-foreground">{examen.nombre}</p>
          <p className="text-xs text-muted-foreground">Categoría {examen.categoria} · {modalidad === 'tiempo' ? 'Por tiempo' : 'Libre'}</p>
        </div>
        {modalidad === 'tiempo' && (
          <div className={`flex items-center gap-2 px-4 py-2 border ${tiempoRestante < 300 ? 'border-danger-border bg-danger-soft text-danger' : 'border-primary/20 bg-primary/5 text-primary'}`}>
            <Clock className="w-4 h-4" />
            <span className="font-mono font-bold text-lg">{formatTiempo(tiempoRestante)}</span>
          </div>
        )}
      </div>

      {/* Progreso */}
      <div className="glass-card px-6 py-4 mb-6">
        {errorGuardado && (
          <p role="status" className="text-xs text-warning mb-3">
            No se han podido guardar las últimas respuestas. Comprueba tu conexión antes de que termine el tiempo.
          </p>
        )}
        {errorEnvio && (
          <p className="text-xs text-danger font-mono mb-3 border border-danger-border bg-danger-soft px-3 py-2">
            {errorEnvio}
          </p>
        )}
        <div className="flex items-center justify-between text-xs font-mono text-muted-foreground mb-2">
          <span>{respondidas} respondidas de {preguntas.length}</span>
          <span>{progreso}%</span>
        </div>
        <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            animate={{ width: `${progreso}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Pregunta */}
      <AnimatePresence mode="wait">
        <motion.div
          key={preguntaActual}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="glass-card p-8 mb-6"
        >
          <div className="flex items-start gap-3 mb-6">
            <span className="text-xs font-mono text-primary border border-primary/20 bg-primary/5 px-2 py-0.5 shrink-0">
              {preguntaActual + 1}/{preguntas.length}
            </span>
            <p className="text-base text-foreground leading-relaxed">{pregunta.enunciado}</p>
          </div>

          <div className="space-y-3">
            {opciones.map(({ key, text }) => {
              const seleccionada = respuestas[pregunta.id] === key;
              return (
                <button
                  key={key}
                  disabled={finalizando || (modalidad === 'tiempo' && tiempoRestante <= 0)}
                  aria-pressed={seleccionada}
                  onClick={() => handleRespuesta(pregunta.id, key)}
                  className={`w-full text-left flex items-center gap-3 px-5 py-4 border transition-all duration-200 ${
                    seleccionada
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-foreground'
                  }`}
                >
                  <span className={`text-xs font-mono uppercase shrink-0 w-5 h-5 flex items-center justify-center border rounded-full ${seleccionada ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong'}`}>
                    {key}
                  </span>
                  <span className="text-sm">{text}</span>
                </button>
              );
            })}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Navegación */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => setPreguntaActual((p) => Math.max(0, p - 1))}
          disabled={preguntaActual === 0}
          className="flex items-center gap-2 px-5 py-3 border border-border-subtle text-muted-foreground text-xs font-bold uppercase tracking-widest hover:border-primary/30 hover:text-primary transition-all duration-200 disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" /> Anterior
        </button>

        {/* Minigrid de preguntas */}
        <div className="hidden sm:flex flex-wrap gap-1 justify-center max-w-xs">
          {preguntas.map((_, i) => (
            <button
              key={i}
              onClick={() => setPreguntaActual(i)}
              className={`w-7 h-7 text-xs font-mono transition-all duration-150 ${
                i === preguntaActual
                  ? 'bg-primary text-primary-foreground'
                  : respuestas[preguntas[i].id]
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'bg-surface-muted text-muted-foreground border border-border-subtle hover:border-primary/30'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {preguntaActual < preguntas.length - 1 ? (
          <button
            onClick={() => setPreguntaActual((p) => Math.min(preguntas.length - 1, p + 1))}
            className="flex items-center gap-2 px-5 py-3 border border-border-subtle text-muted-foreground text-xs font-bold uppercase tracking-widest hover:border-primary/30 hover:text-primary transition-all duration-200"
          >
            Siguiente <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => modalidad === 'libre' ? setConfirmFinish(true) : handleFinalizar()}
            disabled={finalizando}
            className="flex items-center gap-2 px-5 py-3 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-tighter hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
          >
            {finalizando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Finalizar
          </button>
        )}
      </div>

      {/* Botón finalizar libre en cualquier momento */}
      {modalidad === 'libre' && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setConfirmFinish(true)}
            disabled={finalizando}
            className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors border border-border-subtle px-6 py-2 hover:border-primary/30"
          >
            Finalizar examen
          </button>
        </div>
      )}

      {/* Confirm modal */}
      {confirmFinish && (
        <PanelModal label="Finalizar examen" onClose={() => setConfirmFinish(false)} className="max-w-sm glass-card p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-warning mx-auto mb-4" />
            <h3 className="font-heading text-lg font-bold text-foreground mb-2">¿Finalizar el examen?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Has respondido <strong className="text-foreground">{respondidas}</strong> de{' '}
              <strong className="text-foreground">{preguntas.length}</strong> preguntas.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmFinish(false)}
                className="flex-1 px-4 py-3 border border-border-subtle text-muted-foreground text-xs font-bold uppercase tracking-widest hover:border-primary/30 hover:text-primary transition-all duration-200"
              >
                Cancelar
              </button>
              <button
                onClick={() => { setConfirmFinish(false); handleFinalizar(); }}
                className="flex-1 px-4 py-3 bg-primary text-primary-foreground font-bold uppercase tracking-tighter text-xs hover:bg-primary/80 transition-all duration-300"
              >
                Finalizar
              </button>
            </div>
          </PanelModal>
      )}
    </div>
  );
}
