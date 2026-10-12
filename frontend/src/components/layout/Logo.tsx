import React from 'react';
import { Link } from 'react-router-dom';

import { IMAGES } from '@/lib/images';

const SIZES = {
  footer: {
    badge: 'w-[44px] h-[44px]',
    img: 'h-[32px]',
    word: 'text-[18px]',
    tag: 'text-[8px]',
    gap: 'gap-[10px]',
  },
  sm: {
    badge: 'w-[clamp(88px,8.4vw,132px)] h-[clamp(88px,8.4vw,132px)]',
    img: 'h-[clamp(68px,6.4vw,100px)]',
    word: 'text-[clamp(36px,2.8vw,50px)]',
    tag: 'text-[9px]',
    gap: 'gap-[clamp(20px,2.2vw,32px)]',
  },
  header: {
    badge: 'w-[clamp(44px,6.2vw,88px)] h-[clamp(44px,6.2vw,88px)]',
    img: 'h-[clamp(34px,4.8vw,68px)]',
    word: 'text-[clamp(20px,2.5vw,36px)]',
    tag: 'text-[8px]',
    gap: 'gap-[clamp(8px,1.1vw,16px)]',
  },
  md: {
    badge: 'w-[88px] h-[88px]',
    img: 'h-[64px]',
    word: 'text-[32px]',
    tag: 'text-[10px]',
    gap: 'gap-[15px]',
  },
  lg: {
    badge: 'w-[112px] h-[112px]',
    img: 'h-[82px]',
    word: 'text-[40px]',
    tag: 'text-[12px]',
    gap: 'gap-[18px]',
  },
};

export default function Logo({ size = 'md', withTagline = true, to = '/', className = '' }) {
  const s = SIZES[size] || SIZES.md;
  return (
    <Link to={to} className={`group flex items-center ${s.gap} ${className}`}>
      <span
        className={`relative flex items-center justify-center ${s.badge} rounded-lg border border-transparent overflow-hidden`}
      >
        <img
          src={IMAGES.logo}
          srcSet="/images/logo-64.webp 64w, /images/logo-128.webp 128w, /images/logo-256.webp 256w"
          sizes={size === 'footer' ? '48px' : size === 'header' ? '(max-width: 767px) 56px, 104px' : '152px'}
          width={256}
          height={171}
          loading={size === 'footer' ? 'lazy' : 'eager'}
          alt="UASSPAIN"
          className={`${s.img} w-auto object-contain relative z-10`}
        />
      </span>
      <span className="flex flex-col leading-none">
        <span className={`font-heading ${s.word} font-bold tracking-tighter text-foreground`}>
          UAS<span className="text-primary text-glow-cyan">SPAIN</span>
        </span>
        {withTagline && (
          <span className={`font-mono ${s.tag} uppercase tracking-[0.28em] text-muted-foreground/55 mt-1`}>
            Aerial Intelligence
          </span>
        )}
      </span>
    </Link>
  );
}
