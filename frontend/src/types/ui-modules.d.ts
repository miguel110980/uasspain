declare module '@/components/ui/input' {
  import * as React from 'react';
  export const Input: React.ForwardRefExoticComponent<
    React.InputHTMLAttributes<HTMLInputElement> & React.RefAttributes<HTMLInputElement>
  >;
}

declare module '@/components/ui/label' {
  import * as React from 'react';
  export const Label: React.ForwardRefExoticComponent<
    React.LabelHTMLAttributes<HTMLLabelElement> & React.RefAttributes<HTMLLabelElement>
  >;
}

declare module '@/components/ui/textarea' {
  import * as React from 'react';
  export const Textarea: React.ForwardRefExoticComponent<
    React.TextareaHTMLAttributes<HTMLTextAreaElement> & React.RefAttributes<HTMLTextAreaElement>
  >;
}

declare module '@/components/ui/select' {
  import * as React from 'react';
  export const Select: React.ComponentType<any>;
  export const SelectGroup: React.ComponentType<any>;
  export const SelectValue: React.ComponentType<any>;
  export const SelectTrigger: React.ComponentType<any>;
  export const SelectContent: React.ComponentType<any>;
  export const SelectLabel: React.ComponentType<any>;
  export const SelectItem: React.ComponentType<any>;
  export const SelectSeparator: React.ComponentType<any>;
  export const SelectScrollUpButton: React.ComponentType<any>;
  export const SelectScrollDownButton: React.ComponentType<any>;
}

declare module '@/components/ui/toast' {
  import * as React from 'react';
  export const ToastProvider: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  export const ToastViewport: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  export const Toast: React.ComponentType<any>;
  export const ToastTitle: React.ComponentType<any>;
  export const ToastDescription: React.ComponentType<any>;
  export const ToastClose: React.ComponentType<any>;
  export const ToastAction: React.ComponentType<any>;
}

declare module '@/components/ui/toaster' {
  export function Toaster(): import('react').JSX.Element;
}

declare module '@/components/ui/use-toast' {
  export function useToast(): {
    toast: (props: Record<string, unknown>) => void;
    dismiss: (toastId?: string) => void;
    toasts: Array<Record<string, unknown>>;
  };
}

declare module '@/components/ui/button' {
  import * as React from 'react';
  export const Button: React.ForwardRefExoticComponent<any>;
  export function buttonVariants(props?: {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon';
    className?: string;
  }): string;
}

declare module '@/components/ui/checkbox' {
  export const Checkbox: React.ComponentType<any>;
}

declare module '@/components/ui/alert-dialog' {
  export const AlertDialog: React.ComponentType<any>;
  export const AlertDialogTrigger: React.ComponentType<any>;
  export const AlertDialogContent: React.ComponentType<any>;
  export const AlertDialogHeader: React.ComponentType<any>;
  export const AlertDialogTitle: React.ComponentType<any>;
  export const AlertDialogDescription: React.ComponentType<any>;
  export const AlertDialogFooter: React.ComponentType<any>;
  export const AlertDialogAction: React.ComponentType<any>;
  export const AlertDialogCancel: React.ComponentType<any>;
}
