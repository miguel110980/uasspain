export default function DataLoadNotice({ error, retry }: { error: string; retry: () => unknown }) {
  if (!error) return null;
  return <div role="alert" className="mb-4 rounded border border-danger-border bg-danger-soft p-3 text-sm text-danger">{error} <button type="button" onClick={retry} className="underline">Reintentar</button></div>;
}
