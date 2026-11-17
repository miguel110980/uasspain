import { describe, expect, it } from 'vitest';
import { mergePublicPublications, type BoePublication } from './publicPublications';
import type { BlogPost } from '@/services/contentService';

const boe: BoePublication = { id:'official', titulo:'BOE de ensayo', resumen:'Referencia oficial', url:'https://www.boe.es/diario_boe/', activo:true, fecha_publicacion:'2026-11-17', created_date:'2026-11-17T09:00:00Z' };
const now=new Date('2026-11-17T12:00:00Z');
describe('public BOE and existing blog feed',()=>{
  it('preserves blog content and official links without duplicate BOE records',()=>{
    const blog={id:'official',title:'Existing blog',body:'Original text',status:'published',created_at:'2026-11-16T12:00:00Z',published_at:'2026-11-16T12:00:00Z',images:[]} as BlogPost;
    const result=mergePublicPublications([blog],[boe,boe],now);
    expect(result).toHaveLength(2);
    expect(result[0].reference_url).toBe(boe.url);
    expect(result[1]).toEqual(blog);
  });
  it('does not expose inactive or future publications',()=>{
    expect(mergePublicPublications([],[{...boe,activo:false},{...boe,fecha_publicacion:'2026-11-18'}],now)).toEqual([]);
  });
  it('does not render an executable official link',()=>{
    expect(mergePublicPublications([],[{...boe,url:'javascript:alert(1)'}],now)[0].reference_url).toBeUndefined();
  });
  it('preserves the existing editorial blog order',()=>{
    const pinned={id:'pinned',title:'Pinned',body:'Original',status:'published',sort_order:-1,created_at:'2026-01-01T00:00:00Z',images:[]} as BlogPost;
    expect(mergePublicPublications([pinned],[boe],now)[0]).toBe(pinned);
  });
});
