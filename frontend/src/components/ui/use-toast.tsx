// Inspired by react-hot-toast library
import { useState, useEffect } from "react";
import { SUCCESS_FEEDBACK_DURATION } from "@/lib/successFeedback";

const TOAST_LIMIT = 1;

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
};

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

const toastTimeouts = new Map();

export const reducer = (state, action) => {
  switch (action.type) {
    case actionTypes.ADD_TOAST:
      state.toasts.forEach(t => { clearTimeout(toastTimeouts.get(t.id)); toastTimeouts.delete(t.id); });
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case actionTypes.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case actionTypes.DISMISS_TOAST: {
      const targets = state.toasts.filter(t => action.toastId === undefined || t.id === action.toastId);
      targets.forEach(t => { clearTimeout(toastTimeouts.get(t.id)); toastTimeouts.delete(t.id); });
      return { ...state, toasts: state.toasts.filter(t => !targets.includes(t)) };
    }
    case actionTypes.REMOVE_TOAST:
      if (action.toastId === undefined) {
        return { ...state, toasts: [] };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners = [];

let memoryState = { toasts: [] };

function dispatch(action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

function toast({ duration: requestedDuration, ...props }) {
  const duration = requestedDuration ?? (props.variant === 'destructive' ? 1500 : SUCCESS_FEEDBACK_DURATION);
  const id = genId();
  const titleKey = props.title || '';

  const existing = memoryState.toasts.find(
    (t) => t.open !== false && (t.title === titleKey)
  );

  if (existing) {
    clearTimeout(toastTimeouts.get(existing.id));
    toastTimeouts.delete(existing.id);

    const update = (newProps) =>
      dispatch({
        type: actionTypes.UPDATE_TOAST,
        toast: { ...newProps, id: existing.id },
      });

    const dismiss = () =>
      dispatch({ type: actionTypes.DISMISS_TOAST, toastId: existing.id });

    dispatch({
      type: actionTypes.UPDATE_TOAST,
      toast: {
        ...props,
        id: existing.id,
        open: true,
        duration,
        onOpenChange: (open) => {
          if (!open) dismiss();
        },
      },
    });

    const dismissTimeout = setTimeout(() => {
      dismiss();
    }, duration);

    toastTimeouts.set(existing.id, dismissTimeout);

    return { id: existing.id, dismiss, update };
  }

  const update = (newProps) =>
    dispatch({
      type: actionTypes.UPDATE_TOAST,
      toast: { ...newProps, id },
    });

  const dismiss = () =>
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId: id });

  dispatch({
    type: actionTypes.ADD_TOAST,
    toast: {
      ...props,
      id,
      open: true,
      duration,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  const dismissTimeout = setTimeout(() => {
    dismiss();
  }, duration);

  toastTimeouts.set(id, dismissTimeout);

  return { id, dismiss, update };
}

function dismiss(toastId) {
  dispatch({ type: actionTypes.DISMISS_TOAST, toastId });
}

function useToast() {
  const [state, setState] = useState(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss,
  };
}

export { useToast, toast };
