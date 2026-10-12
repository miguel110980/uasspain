import {
  Shield, Siren, Radio, Camera, SprayCan, ScanLine, Thermometer, CheckCircle, ArrowRight, ChevronLeft,
  Sprout, Tractor, Leaf, Bug, Droplets, Map, Trees, Wheat, Search, LifeBuoy, Eye, ShieldCheck,
  Flame, FireExtinguisher, Moon, Crosshair, MapPin, Layers, Compass, Box, Scan, Mountain,
  Ruler, Globe, Factory, Building2, Zap, Sun, Wind, House, PanelsTopLeft, Cable, Route,
  TowerControl, Pipette, Anchor, Bird, Waves, Recycle, Cloud, Fish, Flower2, Heart,
  Image, Video, Clapperboard, Calendar, Megaphone, Plane, Bike, Film, Tv, Package,
  Truck, Navigation, Bot, TrafficCone, Construction, Ship, Satellite, Cpu, Radar,
} from 'lucide-react';

// Explicit imports keep the public bundle limited to this reviewed catalogue.
export const SERVICE_ICONS = {
  Shield, Siren, Radio, Camera, SprayCan, ScanLine, Thermometer, CheckCircle, ArrowRight, ChevronLeft,
  Sprout, Tractor, Leaf, Bug, Droplets, Map, Trees, Wheat, Search, LifeBuoy, Eye, ShieldCheck,
  Flame, FireExtinguisher, Moon, Crosshair, MapPin, Layers, Compass, Box, Scan, Mountain,
  Ruler, Globe, Factory, Building2, Zap, Sun, Wind, House, PanelsTopLeft, Cable, Route,
  TowerControl, Pipette, Anchor, Bird, Waves, Recycle, Cloud, Fish, Flower2, Heart,
  Image, Video, Clapperboard, Calendar, Megaphone, Plane, Bike, Film, Tv, Package,
  Truck, Navigation, Bot, TrafficCone, Construction, Ship, Satellite, Cpu, Radar,
};
export type ServiceIconId = keyof typeof SERVICE_ICONS;
export const serviceIcon = (id: string) => Object.hasOwn(SERVICE_ICONS, id) ? SERVICE_ICONS[id as ServiceIconId] : Shield;

export const SERVICE_ICON_GROUPS: { name: string; icons: { id: ServiceIconId; label: string }[] }[] = [
  { name: 'Agricultura', icons: [
    { id: 'SprayCan', label: 'Fumigación y pulverización' }, { id: 'Tractor', label: 'Agricultura de precisión' },
    { id: 'Sprout', label: 'Análisis de cultivos' }, { id: 'Bug', label: 'Control de plagas' },
    { id: 'Droplets', label: 'Riego' }, { id: 'Map', label: 'Cartografía agrícola' },
    { id: 'Trees', label: 'Inspección de plantaciones' }, { id: 'Wheat', label: 'Seguimiento de cosechas' },
  ] },
  { name: 'Emergencias y seguridad', icons: [
    { id: 'Siren', label: 'Emergencias' }, { id: 'Search', label: 'Búsqueda y rescate' },
    { id: 'LifeBuoy', label: 'Salvamento marítimo' }, { id: 'Eye', label: 'Vigilancia' },
    { id: 'Shield', label: 'Seguridad perimetral' }, { id: 'ShieldCheck', label: 'Protección Civil' },
    { id: 'Flame', label: 'Detección de incendios' }, { id: 'FireExtinguisher', label: 'Apoyo contra incendios' },
    { id: 'Moon', label: 'Operaciones nocturnas' }, { id: 'Thermometer', label: 'Cámaras térmicas' },
    { id: 'Crosshair', label: 'Localización de personas' },
  ] },
  { name: 'Topografía y cartografía', icons: [
    { id: 'Layers', label: 'Fotogrametría' }, { id: 'Compass', label: 'Topografía' },
    { id: 'MapPin', label: 'Georreferenciación' }, { id: 'Box', label: 'Modelos 3D' },
    { id: 'Scan', label: 'Escaneado' }, { id: 'Mountain', label: 'Inspección de terrenos' },
    { id: 'Ruler', label: 'Levantamientos' }, { id: 'Globe', label: 'Análisis geoespacial y cartografía' },
    { id: 'ScanLine', label: 'Escáner de superficie' }, { id: 'Satellite', label: 'Posicionamiento satélite' },
  ] },
  { name: 'Inspecciones técnicas', icons: [
    { id: 'Factory', label: 'Inspección industrial' }, { id: 'Building2', label: 'Infraestructuras' },
    { id: 'Zap', label: 'Líneas eléctricas' }, { id: 'Sun', label: 'Energía solar' },
    { id: 'Wind', label: 'Aerogeneradores' }, { id: 'House', label: 'Edificios y cubiertas' },
    { id: 'PanelsTopLeft', label: 'Paneles y cubiertas' }, { id: 'Cable', label: 'Puentes' },
    { id: 'Route', label: 'Carreteras' }, { id: 'TowerControl', label: 'Torres de telecomunicaciones' },
    { id: 'Pipette', label: 'Oleoductos y gasoductos' }, { id: 'Anchor', label: 'Instalaciones portuarias' },
  ] },
  { name: 'Medioambiente', icons: [
    { id: 'Leaf', label: 'Vigilancia forestal' }, { id: 'Bird', label: 'Fauna' },
    { id: 'Flower2', label: 'Flora' }, { id: 'Cloud', label: 'Contaminación y calidad ambiental' },
    { id: 'Waves', label: 'Seguimiento de costas' }, { id: 'Recycle', label: 'Control de vertidos' },
    { id: 'Heart', label: 'Conservación' }, { id: 'Fish', label: 'Hábitat marino' },
  ] },
  { name: 'Audiovisual', icons: [
    { id: 'Camera', label: 'Fotografía aérea' }, { id: 'Image', label: 'Imagen aérea' },
    { id: 'Video', label: 'Vídeo aéreo' }, { id: 'Clapperboard', label: 'Cine' },
    { id: 'Calendar', label: 'Eventos' }, { id: 'Megaphone', label: 'Publicidad' },
    { id: 'Plane', label: 'Turismo' }, { id: 'Bike', label: 'Seguimiento deportivo' },
    { id: 'Film', label: 'Producción audiovisual' }, { id: 'Tv', label: 'Retransmisiones' },
  ] },
  { name: 'Transporte y operaciones', icons: [
    { id: 'Package', label: 'Transporte de pequeñas cargas' }, { id: 'Truck', label: 'Logística' },
    { id: 'Navigation', label: 'Inspección de rutas' }, { id: 'Bot', label: 'Operaciones autónomas' },
    { id: 'TrafficCone', label: 'Control de tráfico' }, { id: 'Construction', label: 'Supervisión de obras' },
    { id: 'Ship', label: 'Operaciones marítimas' }, { id: 'Radio', label: 'Comunicaciones' },
    { id: 'Cpu', label: 'Control de vuelo' }, { id: 'Radar', label: 'Monitorización aérea' },
  ] },
  { name: 'Compatibilidad', icons: [
    { id: 'CheckCircle', label: 'Verificación' }, { id: 'ArrowRight', label: 'Acción' },
    { id: 'ChevronLeft', label: 'Navegación' },
  ] },
];
