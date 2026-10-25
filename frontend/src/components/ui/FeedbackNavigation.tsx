import { useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { CLEAR_SUCCESS_FEEDBACK } from '@/lib/successFeedback';

// Panel sections stay mounted when hidden, so unmount cleanup alone is insufficient.
export default function FeedbackNavigation({ value }: { value: string }) {
  const { dismiss } = useToast();
  useEffect(() => () => {
    window.dispatchEvent(new Event(CLEAR_SUCCESS_FEEDBACK));
    dismiss();
  }, [value, dismiss]);
  return null;
}
