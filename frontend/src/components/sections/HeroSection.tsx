import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Shield, Cpu, Globe } from 'lucide-react';
import { HERO_IMAGE } from '@/lib/images';

const badges = [
  { icon: Shield, text: 'Certificado AESA' },
  { icon: Cpu, text: 'Tecnología RTK' },
  { icon: Globe, text: 'Cobertura Nacional' },
];

// Every HUD element uses this same circular coordinate system. Angles are
// measured clockwise from the right-hand axis, in SVG user units.
const RADAR_CENTER_X = 1395 / 2;
const RADAR_CENTER_Y = 1127 / 2;
const RADAR_OUTER_RADIUS = 510;
const RADAR_TRACK_RADIUS = 480;
const RADAR_INNER_TRACK_RADIUS = 284;
const RADAR_SIDE_TRACK_OFFSET = 8;
const RADAR_SIDE_TRACK_RADIUS = RADAR_TRACK_RADIUS - RADAR_SIDE_TRACK_OFFSET;
// All highlighted segments have the same physical length, including the
// inset side rail. Its angle follows its radius instead of shortening the arc.
const RADAR_ACCENT_LENGTH = RADAR_TRACK_RADIUS * 16 * Math.PI / 180;
const RADAR_SWEEP_ANGLE = -63;
// Foreground silhouette in the original photograph's 1672 x 941 coordinates.
// Include the camera, landing legs and blurred propellers, not just the fuselage.
const DRONE_OUTLINE = 'M594 224L596 209Q609 199 625 209L631 227L708 227Q711 214 738 205L789 192Q826 187 846 198L872 207L878 198L881 185Q895 176 909 185L916 216L1039 224L1041 213Q1057 201 1072 212L1075 245L1067 252L1062 284L1048 285L1052 253L923 257L917 277L906 294L897 296L891 312L880 313L874 301L823 304L814 314L801 320L785 322L765 319L751 315L742 306L741 286L748 276L750 266L737 259L732 253L632 250L628 252L625 302L613 304L606 278L601 253L594 247Z';
const radarPoint = (radius: number, angle: number) => {
  const radians = angle * Math.PI / 180;
  return { x: RADAR_CENTER_X + radius * Math.cos(radians), y: RADAR_CENTER_Y + radius * Math.sin(radians) };
};
const radarMove = (radius: number, angle: number) => {
  const { x, y } = radarPoint(radius, angle);
  return `${x} ${y}`;
};
const radarArc = (radius: number, start: number, end: number) =>
  `M${radarMove(radius, start)}A${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${radarMove(radius, end)}`;
const radarLine = (inner: number, outer: number, angle: number) =>
  `M${radarMove(inner, angle)}L${radarMove(outer, angle)}`;
const sweepTip = radarPoint(RADAR_TRACK_RADIUS, RADAR_SWEEP_ANGLE);
const sweepDot = radarPoint(345, RADAR_SWEEP_ANGLE);
const sectorEnd = radarPoint(RADAR_TRACK_RADIUS, RADAR_SWEEP_ANGLE + 10);
const radarDotPattern = (radius: number, count: number) => {
  const mark = 0.1 * count / (2 * Math.PI * radius);
  // Normalize the circumference to an integer number of periods. This closes
  // the seam exactly and gives all four quadrants the same dot distribution.
  return { pathLength: count, strokeDasharray: `${mark} ${1 - mark}`, strokeDashoffset: mark / 2, strokeLinecap: 'round' as const };
};
const radarRings = [
  { radius: RADAR_OUTER_RADIUS, opacity: 0.25 },
  { radius: RADAR_TRACK_RADIUS, opacity: 0.6 },
  { radius: 440, opacity: 0.8, dots: 228, width: 2 },
  { radius: 393, opacity: 0.55 },
  { radius: 313, opacity: 0.4, dots: 384 },
  { radius: RADAR_INNER_TRACK_RADIUS, opacity: 0.5 },
  { radius: 250, opacity: 0.35, dots: 308 },
];
const radarAccents = [
  ...[RADAR_SIDE_TRACK_RADIUS, RADAR_TRACK_RADIUS].flatMap(radius => [0, 180].map(angle => ({ radius, angle }))),
  ...[-120, -60, 60, 120].map(angle => ({ radius: RADAR_TRACK_RADIUS, angle })),
].map(({ radius, angle }) => {
  const halfAngle = RADAR_ACCENT_LENGTH / (2 * radius) * 180 / Math.PI;
  return { radius, start: angle - halfAngle, end: angle + halfAngle };
});
const radarTicks = [
  ...[393, 440].flatMap(radius => [-90, 90].map(angle => ({ radius, angle }))),
  ...[440, RADAR_SIDE_TRACK_RADIUS].flatMap(radius => [-160, -20, 20, 160].map(angle => ({ radius, angle }))),
];
const radarMarkers = [
  { ...radarPoint(RADAR_OUTER_RADIUS, -148), width: 10, height: 10, opacity: 1 },
  ...[0, 180].map(angle => ({ ...radarPoint(534, angle), width: 10, height: 5, opacity: 1 })),
  ...[-90, 90].map(angle => ({ ...radarPoint(453, angle), width: 4, height: 6, opacity: 0.5 })),
];
const radarNodes = [
  { ...radarPoint(305, -36), glow: 7, radius: 3.5, bright: true },
  { ...radarPoint(RADAR_OUTER_RADIUS, -32), glow: 4, radius: 2.8, bright: false },
  { ...radarPoint(496, 50), glow: 4, radius: 3.5, bright: false },
];

export default function HeroSection() {
  return (
    <section id="inicio" className="hero-shell relative w-full overflow-hidden bg-background">
      <div className="hero-stage">
        <div className="hero-background">
          <div className="hero-background-images">
            <img {...HERO_IMAGE} width={1672} height={941} alt="" fetchPriority="high" className="hero-panorama" />
            <div className="hero-sky" aria-hidden="true">
              <img {...HERO_IMAGE} width={1672} height={941} alt="" fetchPriority="high" />
            </div>
            <div className="hero-art absolute">
              <picture>
                <img {...HERO_IMAGE} width={1672} height={941} alt="Drone aéreo profesional" fetchPriority="high" className="hero-image w-full h-full object-contain" />
              </picture>
            </div>
          </div>
          <div className="hero-background-shade" aria-hidden="true" />
        </div>

        <div className="hero-radar-layer absolute pointer-events-none select-none" aria-hidden="true">
          <svg className="hero-radar" fill="none" focusable="false" style={{ '--hero-radar-center-x': `${RADAR_CENTER_X}px`, '--hero-radar-center-y': `${RADAR_CENTER_Y}px` } as React.CSSProperties}>
            <defs>
              <linearGradient id="hero-radar-sector" x1={sweepTip.x} y1={sweepTip.y} x2={sectorEnd.x} y2={sectorEnd.y} gradientUnits="userSpaceOnUse">
                <stop stopColor="currentColor" stopOpacity="0.5" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="hero-radar-ray" x1={RADAR_CENTER_X} y1={RADAR_CENTER_Y} x2={sweepTip.x} y2={sweepTip.y} gradientUnits="userSpaceOnUse">
                <stop stopColor="currentColor" stopOpacity="0" />
                <stop offset="0.65" stopColor="currentColor" stopOpacity="0.85" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0.45" />
              </linearGradient>
              <filter id="hero-radar-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3" />
              </filter>
              <radialGradient id="hero-radar-flare">
                <stop stopColor="currentColor" stopOpacity="0.8" />
                <stop offset="0.16" stopColor="currentColor" stopOpacity="0.45" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
            </defs>
            <g>
              <svg className="hero-radar-dial" width="100%" height="100%" viewBox="0 0 1395 1127" preserveAspectRatio="xMidYMid meet">
                <g stroke="currentColor" strokeWidth="1.2">
                  {radarRings.map(({ radius, opacity, dots, width }) => (
                    <circle key={radius} id={`hero-radar-track-${radius}`} className="hero-radar-ring" cx={RADAR_CENTER_X} cy={RADAR_CENTER_Y} r={radius} opacity={opacity} {...(dots ? radarDotPattern(radius, dots) : {})} strokeWidth={width} />
                  ))}
                </g>
                <g stroke="currentColor" strokeWidth="1.3" opacity="0.45">
                  <path className="hero-radar-axis" d={`${radarLine(-496, 496, 0)}${radarLine(-440, 440, 90)}`} />
                  {radarTicks.map(({ radius, angle }) => {
                    const { x, y } = radarPoint(radius, angle);
                    return <path key={`${radius}-${angle}`} d={`M${x - 7} ${y}h14`} />;
                  })}
                </g>
                <g className="hero-radar-sweep">
                  <circle cx={sweepDot.x} cy={sweepDot.y} r="42" fill="url(#hero-radar-flare)" />
                  <path d={`M${radarMove(RADAR_INNER_TRACK_RADIUS, RADAR_SWEEP_ANGLE)}L${radarMove(RADAR_TRACK_RADIUS, RADAR_SWEEP_ANGLE)}A${RADAR_TRACK_RADIUS} ${RADAR_TRACK_RADIUS} 0 0 1 ${radarMove(RADAR_TRACK_RADIUS, RADAR_SWEEP_ANGLE + 10)}L${radarMove(RADAR_INNER_TRACK_RADIUS, RADAR_SWEEP_ANGLE + 10)}A${RADAR_INNER_TRACK_RADIUS} ${RADAR_INNER_TRACK_RADIUS} 0 0 0 ${radarMove(RADAR_INNER_TRACK_RADIUS, RADAR_SWEEP_ANGLE)}Z`} fill="url(#hero-radar-sector)" />
                  <path d={radarLine(RADAR_INNER_TRACK_RADIUS, 388, RADAR_SWEEP_ANGLE)} stroke="currentColor" strokeWidth="6" opacity="0.8" filter="url(#hero-radar-glow)" />
                  <path d={radarLine(0, RADAR_TRACK_RADIUS, RADAR_SWEEP_ANGLE)} stroke="url(#hero-radar-ray)" strokeWidth="2" />
                  <circle cx={sweepDot.x} cy={sweepDot.y} r="8" fill="currentColor" filter="url(#hero-radar-glow)" />
                  <circle className="hero-radar-sweep-dot hero-radar-nodes" cx={sweepDot.x} cy={sweepDot.y} r="4" />
                </g>
                <g stroke="currentColor" strokeWidth="2" opacity="0.85">
                  {radarAccents.map(({ radius, start, end }) => <path key={`${radius}-${start}`} className="hero-radar-arc" data-radar-track={`hero-radar-track-${RADAR_TRACK_RADIUS}`} data-radar-offset={radius - RADAR_TRACK_RADIUS} d={radarArc(radius, start, end)} />)}
                </g>
                <g stroke="currentColor" strokeWidth="1.5" opacity="0.8">
                  {radarMarkers.map(({ x, y, width, height, opacity }, index) => <rect key={index} x={x - width / 2} y={y - height / 2} width={width} height={height} opacity={opacity} />)}
                </g>
                <g fill="currentColor" filter="url(#hero-radar-glow)">
                  {radarNodes.map(({ x, y, glow }, index) => <circle key={index} cx={x} cy={y} r={glow} />)}
                </g>
                <g className="hero-radar-nodes">
                  {radarNodes.filter(node => node.bright).map(({ x, y, radius }, index) => <circle key={index} cx={x} cy={y} r={radius} />)}
                </g>
                <g fill="currentColor" opacity="0.9">
                  {radarNodes.filter(node => !node.bright).map(({ x, y, radius }, index) => <circle key={index} cx={x} cy={y} r={radius} />)}
                  <circle cx={RADAR_CENTER_X} cy={RADAR_CENTER_Y - 393} r="2" />
                </g>
              </svg>
            </g>
          </svg>
        </div>

        {/* An opaque foreground composition preserves the photograph's original
            tint while physically covering every radar effect beneath the drone. */}
        <div className="hero-drone-layer" aria-hidden="true">
          <svg className="hero-drone-coordinates absolute inset-0 w-full h-full" viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid meet" focusable="false">
            <defs>
              <clipPath id="hero-drone-clip" clipPathUnits="objectBoundingBox">
                <path className="hero-drone-outline" transform="scale(0.000598086124401914 0.001062699256110521)" d={DRONE_OUTLINE} />
                <ellipse transform="scale(0.000598086124401914 0.001062699256110521)" cx="610" cy="201" rx="151" ry="23" />
                <ellipse transform="scale(0.000598086124401914 0.001062699256110521)" cx="898" cy="181" rx="134" ry="21" />
                <ellipse transform="scale(0.000598086124401914 0.001062699256110521)" cx="1058" cy="209" rx="145" ry="20" />
              </clipPath>
            </defs>
          </svg>
            <div className="hero-drone-surface">
              <img {...HERO_IMAGE} width={1672} height={941} alt="" fetchPriority="high" className="hero-drone-image w-full h-full object-contain opacity-55 dark:opacity-65" />
              <div className="hero-shade absolute inset-0 bg-gradient-to-b from-background/45 via-background/15 to-background" />
            </div>
        </div>

        <div className="hero-content relative z-10 w-full mx-auto flex flex-col items-center text-center">
          <div
            className="hero-copy"
          >
            <h1 className="hero-title font-heading font-bold mb-5">
              <span className="hero-title-line">
                SOLUCIONES{' '}<span className="hero-title-cyan">AÉREAS</span>
              </span>
              <span className="hero-title-line hero-title-second">INTELIGENTES</span>
            </h1>

            <div className="hero-actions flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <Link
                to="/contacto"
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 group"
              >
                Solicitar Servicio
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#servicios"
                className="inline-flex items-center justify-center gap-2 border border-border-strong text-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:border-primary/50 hover:text-primary transition-all duration-300"
              >
                Explorar Servicios
              </a>
            </div>

            <div className="hero-badges flex flex-wrap justify-center gap-4">
              {badges.map(({ icon: Icon, text }) => (
                <div key={text} className="inline-flex items-center gap-2 px-4 py-2 border border-border-strong bg-surface-subtle text-xs font-mono text-muted-foreground">
                  <Icon className="w-3.5 h-3.5 text-primary" />
                  {text}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          className="hero-scroll absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <ChevronDown className="w-4 h-4 text-primary/40 animate-bounce" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/40">Desplazar</span>
        </div>
      </div>
    </section>
  );
}
