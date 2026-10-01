import { cookies } from 'next/headers';

/** Nombre de quien revisa, recordado entre formularios. No es autenticación: no la hay. */
export const REVIEWER_COOKIE = 'revisor';

export const getReviewer = async (): Promise<string> => (await cookies()).get(REVIEWER_COOKIE)?.value ?? '';
