import { useId, useState } from 'react';
import { SERVICE_ICON_GROUPS, serviceIcon } from '@/lib/serviceIcons';

const searchKey = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export default function ServiceIconSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState('');
  const id = useId();
  const Selected = serviceIcon(value);
  const groups = SERVICE_ICON_GROUPS.map(group => ({ ...group, icons: group.icons.filter(icon => searchKey(`${group.name} ${icon.label} ${icon.id}`).includes(searchKey(search))) })).filter(group => group.icons.length);
  return <fieldset className="min-w-0 space-y-3">
    <legend className="text-sm">Icono</legend>
    <div className="flex items-center gap-2 text-sm"><Selected className="w-5 h-5 text-primary shrink-0" /><span>{value}</span></div>
    <label htmlFor={id} className="text-sm block">Buscar iconos</label>
    <input id={id} type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="Especialidad, nombre o identificador" className="w-full min-w-0 bg-surface-muted border border-border rounded px-3 py-2 text-sm" />
    <div className="max-h-72 overflow-y-auto space-y-4 border border-border rounded p-3">
      {groups.map(group => <div key={group.name}><p className="text-xs font-bold mb-2">{group.name}</p><div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">{group.icons.map(icon => {
        const Icon = serviceIcon(icon.id);
        return <button key={icon.id} type="button" aria-pressed={value === icon.id} onClick={() => onChange(icon.id)} title={`${icon.label} (${icon.id})`} className={`flex items-center gap-2 text-left text-xs p-2 rounded border min-w-0 ${value === icon.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'}`}><Icon className="w-5 h-5 text-primary shrink-0" /><span className="break-words">{icon.label}</span></button>;
      })}</div></div>)}
      {!groups.length && <p role="status" className="text-sm text-muted-foreground">No se encontraron iconos.</p>}
    </div>
  </fieldset>;
}
