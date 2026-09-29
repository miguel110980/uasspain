import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function KpiCard({ icon: Icon, label, value, delta = undefined, trend = 'up', accent = 'primary', loading }) {
  const accentClass =
    accent === 'primary'
      ? 'text-primary bg-primary/10 border-primary/20'
      : accent === 'orange'
      ? 'text-warning bg-warning-soft border-warning-border'
      : 'text-info bg-info-soft border-info-border';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 relative overflow-hidden group"
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 flex items-center justify-center border ${accentClass} rounded-md`}>
          <Icon className="w-5 h-5" />
        </div>
        {delta != null && (
          <span className={`flex items-center gap-1 text-xs font-mono ${trend === 'up' ? 'text-success' : 'text-danger'}`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {delta}
          </span>
        )}
      </div>
      <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground/70 mb-1">{label}</p>
      {loading ? (
        <div className="h-7 w-16 bg-surface-muted rounded animate-pulse" />
      ) : (
        <p className="font-heading text-2xl font-bold text-foreground">{value}</p>
      )}
    </motion.div>
  );
}
