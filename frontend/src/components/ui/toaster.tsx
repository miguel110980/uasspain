import { useToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider>
      {toasts
        .filter((t) => t.open !== false)
        .map(({ id, title, description, action, open: _open, duration: _duration, onOpenChange: _onOpenChange, ...props }) => (
          <Toast key={id} role={props.variant === 'destructive' ? 'alert' : 'status'} aria-live={props.variant === 'destructive' ? 'assertive' : 'polite'} aria-atomic="true" {...props}>
            <div className="grid min-w-0 gap-1 break-words pr-6">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose onClick={() => dismiss(String(id))} aria-label="Cerrar notificación" />
          </Toast>
        ))}
      <ToastViewport />
    </ToastProvider>
  );
}
