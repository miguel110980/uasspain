UPDATE materiales_material
SET archivo_url = regexp_replace(archivo_url, '^/media/uploads/', '/api/media/uploads/')
WHERE archivo_url LIKE '/media/uploads/%';

UPDATE examenes_archivoexamen
SET archivo_url = regexp_replace(archivo_url, '^/media/uploads/', '/api/media/uploads/')
WHERE archivo_url LIKE '/media/uploads/%';
