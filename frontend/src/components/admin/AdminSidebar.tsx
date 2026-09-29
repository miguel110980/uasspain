import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft } from 'lucide-react';

export default function AdminSidebar({ groups, section, onSelect, isOpen, onClose, roleLabel = 'Admin' }) {
  const content = (
    <div className="h-full flex flex-col">
      {/* Brand */}
      <div className="h-16 shrink-0 flex items-center justify-between px-5 border-b border-border-subtle bg-surface-muted/60 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="font-heading text-base font-bold tracking-tighter text-foreground">
            UAS<span className="text-primary">SPAIN</span>
          </span>
             <span className="text-[10px] font-mono uppercase tracking-widest text-copy-tertiary border border-border-subtle px-1.5 py-0.5 rounded bg-surface-elevated/80">
            {roleLabel}
          </span>
        </div>
         <button onClick={onClose} className="lg:hidden text-copy-muted hover:text-copy-primary">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-6">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-2 text-[10px] font-mono uppercase tracking-widest text-copy-tertiary/70">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { onSelect(item.id); onClose?.(); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-all duration-200 ${
                      active
                        ? 'bg-primary/15 text-primary border border-primary/30 shadow-sm'
                        : 'text-copy-muted hover:text-copy-primary hover:bg-surface-muted border border-transparent shadow-xs'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 px-5 py-4 border-t border-border-subtle">
        <button
          onClick={onClose}
          className="hidden lg:flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-copy-muted hover:text-primary transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Contraer
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border-subtle bg-surface-muted/70 backdrop-blur-xl sticky top-0 h-screen">
        {content}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="lg:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 26, stiffness: 240 }}
              className="lg:hidden fixed top-0 left-0 z-50 w-64 h-screen bg-surface backdrop-blur-xl border-r border-border-subtle shadow-lg"
            >
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
