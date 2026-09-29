import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export const publicService = {
  async getPublicaciones(limit = 6) {
    const res = await apiClient.get(endpoints.public.publicaciones, { params: { limit } });
    return res.data;
  },
};

export default publicService;
